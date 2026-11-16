# shellcheck shell=bash
#
# Shared by deploy-prod.sh and scripts/deploy/compose.sh (source it from the
# repo root). Reads .env the way Compose does and derives everything that
# depends on CADDY_MODE, so a manual `docker compose` call never brings Caddy
# up in the wrong mode. Sets:
#   COMPOSE (array)        docker compose -f ... with the mode's override files
#   COMPOSE_PROFILES       bundled-db / analytics / tunnel (exported)
#   CADDY_* (exported)     site addresses, trusted peers, client-IP header, HSTS header
#   DOMAIN, ANALYTICS, TUNNEL_IN_STACK
# and edge_config_problems() lists what the edge still lacks (deploy-prod.sh
# refuses to start on any of them). Never prints secrets.

if ! declare -F die >/dev/null; then
    die() { echo "Error: $*" >&2; exit 1; }
fi
if ! declare -F warn >/dev/null; then
    warn() { echo "Warning: $*" >&2; }
fi

# .env: parsed, never sourced (a sourced file runs code, and a value with a
# space such as ADMIN_ALLOW_CIDRS would break it). Compose's rules: KEY=VALUE,
# optional quotes, "# comment" after an unquoted value, the shell env wins.
# Compose interpolates "$" in unquoted and double-quoted values; this parser
# does not, so such values are refused (single-quote them, they are literal
# for both).
load_env_file() {
    local file="$1" line key val
    [ -f "$file" ] || return 0
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
        if ! [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
            warn "ignoring a malformed line in $file"
            continue
        fi
        key="${BASH_REMATCH[2]}"
        val="${BASH_REMATCH[3]}"
        if [[ "$val" =~ ^\'(.*)\'[[:space:]]*(#.*)?$ ]]; then
            val="${BASH_REMATCH[1]}"
        else
            if [[ "$val" =~ ^\"(.*)\"[[:space:]]*(#.*)?$ ]]; then
                val="${BASH_REMATCH[1]}"
                if [[ "$val" == *'\'* ]]; then
                    die "$file: $key contains a backslash inside double quotes, which Compose unescapes; wrap the value in single quotes"
                fi
            else
                val="${val%%[[:space:]]#*}"
                val="${val%"${val##*[![:space:]]}"}"
            fi
            if [[ "$val" == *'$'* ]]; then
                die "$file: $key contains '\$', which Compose would interpolate; wrap the value in single quotes"
            fi
        fi
        if [ -z "${!key+x}" ]; then
            export "$key=$val"
        fi
    done <"$file"
}

# Template placeholders and the well-known defaults of the stack's images.
is_placeholder_value() {
    case "${1,,}" in
        ""|1|postgres|minioadmin|redispassword123|umami|admin|password|secret) return 0 ;;
        change_me*|change-me*|changeme*|replace*|django-insecure*|"<"*) return 0 ;;
        *) return 1 ;;
    esac
}

# The release the last successful deploy-prod.sh run left live (CI passes
# sha-<commit> tags through the shell, so .env alone would name a stale
# :latest): its image tags and ids, and the previous release's ids.
# deploy-prod.sh, compose.sh and verify_backup.sh take the tags from it before
# .env: shell > deployed state > .env. Only these keys are read, each
# validated, so nothing else in the file (it sits in the backups mount) can
# change a setting.
DEPLOYED_STATE_FILE="backups-data/deployed.env"

# state_value KEY: the validated value from the deployed-state file, or "".
state_value() {
    local key="$1" value pattern
    case "$key" in
        BACKEND_TAG|FRONTEND_TAG) pattern='^[A-Za-z0-9_.-]{1,128}$' ;;
        BACKEND_IMAGE_ID|FRONTEND_IMAGE_ID|PREVIOUS_BACKEND_IMAGE_ID|PREVIOUS_FRONTEND_IMAGE_ID)
            pattern='^sha256:[0-9a-f]{64}$' ;;
        *) return 0 ;;
    esac
    value="$(grep -m1 "^${key}=" "$DEPLOYED_STATE_FILE" 2>/dev/null | cut -d= -f2- || true)"
    if [[ "$value" =~ $pattern ]]; then
        printf '%s' "$value"
    fi
}

load_deployed_state() {
    local key value
    for key in BACKEND_TAG FRONTEND_TAG; do
        value="$(state_value "$key")"
        if [ -n "$value" ] && [ -z "${!key:-}" ]; then
            export "$key=$value"
        fi
    done
}

is_true() { case "${1,,}" in 1|true|yes|on) return 0 ;; *) return 1 ;; esac; }

resolve_deploy_mode() {
    # proxy (default): an existing reverse proxy on the host terminates TLS
    # and forwards to Caddy. public: Caddy owns 80/443 + ACME. tunnel:
    # Cloudflare Tunnel. docs/deploy/DEPLOY.md.
    CADDY_MODE="${CADDY_MODE:-proxy}"
    case "$CADDY_MODE" in
        proxy|public|tunnel) ;;
        *) die "CADDY_MODE must be 'proxy', 'public' or 'tunnel' (got '$CADDY_MODE')" ;;
    esac
    export CADDY_MODE

    DOMAIN="${DOMAIN_NAME:-localhost}"
    DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"
    DOMAIN="${DOMAIN%%,*}"; DOMAIN="${DOMAIN%% *}"; DOMAIN="${DOMAIN%%/*}"; DOMAIN="${DOMAIN%%:*}"
    [ -z "$DOMAIN" ] && DOMAIN=localhost

    DB_HOST="${DB_HOST:-db}"
    export DB_HOST

    case "${ANALYTICS_ENABLED:-auto}" in
        auto) if [ -n "${UMAMI_DOMAIN:-}" ]; then ANALYTICS=1; else ANALYTICS=0; fi ;;
        1|true|yes|on) ANALYTICS=1 ;;
        *) ANALYTICS=0 ;;
    esac

    local -a profiles=()
    [ "$DB_HOST" = db ] && profiles+=(bundled-db)
    [ "$ANALYTICS" = 1 ] && profiles+=(analytics)
    TUNNEL_IN_STACK=0
    if [ "$CADDY_MODE" = tunnel ] && [ "${TUNNEL_EXTERNAL:-0}" != 1 ]; then
        profiles+=(tunnel)
        TUNNEL_IN_STACK=1
    fi
    COMPOSE_PROFILES="$(IFS=,; echo "${profiles[*]-}")"
    export COMPOSE_PROFILES

    COMPOSE=(docker compose -f docker-compose.prod.yml)
    [ "$CADDY_MODE" = public ] && COMPOSE+=(-f infra/compose/public-ports.yml)
    # Proxy mode: Caddy on the host's loopback for the host's proxy, unless
    # the proxy reaches it over a Docker network instead
    # (CADDY_PROXY_PUBLISH=0 + infra/compose/shared-proxy-network.yml).
    if [ "$CADDY_MODE" = proxy ] && [ "${CADDY_PROXY_PUBLISH:-1}" != 0 ]; then
        COMPOSE+=(-f infra/compose/proxy-port.yml)
    fi
    local extra
    for extra in ${COMPOSE_EXTRA_FILES:-}; do
        [ -f "$extra" ] || die "COMPOSE_EXTRA_FILES: $extra not found"
        COMPOSE+=(-f "$extra")
    done

    # Caddy's site addresses and trusted peers follow the mode unless set.
    # Loopback is always trusted: only Caddy's own container (smoke tests).
    local loopback="127.0.0.1/8 ::1/128"
    # Set before any default below: was the trust list chosen by the operator?
    TRUSTED_PROXIES_EXPLICIT=0
    # The template's "<...>" placeholder counts as unset (Caddy cannot parse it).
    if [[ "${CADDY_TRUSTED_PROXIES:-}" == *"<"* ]]; then
        unset CADDY_TRUSTED_PROXIES
    fi
    [ -n "${CADDY_TRUSTED_PROXIES:-}" ] && TRUSTED_PROXIES_EXPLICIT=1
    export TRUSTED_PROXIES_EXPLICIT  # read by deploy-prod.sh
    export EDGE_SUBNET="${EDGE_SUBNET:-10.250.250.240/29}"
    export APP_SUBNET="${APP_SUBNET:-10.250.250.0/25}"
    case "$CADDY_MODE" in
        proxy)
            # Plain HTTP behind the host's proxy (it holds the certificates).
            # Trusted peers: the operator's explicit list only (that proxy's
            # address as Caddy sees it), so no other client can choose its IP
            # or claim https; edge_config_problems() refuses an empty one.
            : "${CADDY_SITE_ADDRESS:=:80}"
            : "${CADDY_CLIENT_IP_HEADERS:=X-Forwarded-For}"
            if [ "$ANALYTICS" = 1 ]; then : "${CADDY_UMAMI_SITE_ADDRESS:=http://${UMAMI_DOMAIN:-umami.invalid}}"; fi
            ;;
        tunnel)
            : "${CADDY_SITE_ADDRESS:=:80}"
            : "${CADDY_CLIENT_IP_HEADERS:=CF-Connecting-IP}"
            if [ "$TUNNEL_IN_STACK" = 1 ]; then
                # Only cloudflared and Caddy sit on the edge network: no other
                # container can set CF-Connecting-IP.
                : "${CADDY_TRUSTED_PROXIES:=${EDGE_SUBNET} ${loopback}}"
            fi
            # A shared or host cloudflared: no default; its address is required.
            if [ "$ANALYTICS" = 1 ]; then : "${CADDY_UMAMI_SITE_ADDRESS:=http://${UMAMI_DOMAIN:-umami.invalid}}"; fi
            ;;
        public)
            # As given (may list several hosts, e.g. "anishows.com, www.anishows.com").
            : "${CADDY_SITE_ADDRESS:=${DOMAIN_NAME:-localhost}}"
            : "${CADDY_TRUSTED_PROXIES:=${loopback}}"
            : "${CADDY_CLIENT_IP_HEADERS:=X-Forwarded-For}"
            if [ "$ANALYTICS" = 1 ]; then : "${CADDY_UMAMI_SITE_ADDRESS:=${UMAMI_DOMAIN:-http://umami.invalid}}"; fi
            ;;
    esac
    : "${CADDY_UMAMI_SITE_ADDRESS:=http://umami.invalid}"

    local hsts_seconds="${SECURE_HSTS_SECONDS:-31536000}" hsts
    [[ "$hsts_seconds" =~ ^[0-9]+$ ]] || die "SECURE_HSTS_SECONDS must be a whole number of seconds"
    hsts="max-age=${hsts_seconds}"
    is_true "${SECURE_HSTS_INCLUDE_SUBDOMAINS:-False}" && hsts+="; includeSubDomains"
    is_true "${SECURE_HSTS_PRELOAD:-False}" && hsts+="; preload"
    : "${CADDY_HSTS_HEADER:=$hsts}"
    # Empty means "only Caddy's own loopback" (deploy smoke tests): the D-9
    # operator routes are closed to everyone else until it is set.
    # 100::/64 is the RFC 6666 discard prefix: it matches no real client.
    : "${ADMIN_ALLOW_CIDRS:=100::/64}"
    export CADDY_SITE_ADDRESS CADDY_TRUSTED_PROXIES CADDY_UMAMI_SITE_ADDRESS CADDY_HSTS_HEADER
    export CADDY_CLIENT_IP_HEADERS ADMIN_ALLOW_CIDRS
}

# cidr_is_wide CIDR: true for a range that covers a large part of the internet
# (an IPv4 prefix shorter than /8, an IPv6 prefix shorter than /16, or Caddy's
# private_ranges shorthand, which spans every Docker network on the host).
cidr_is_wide() {
    local cidr="${1,,}" prefix
    case "$cidr" in
        private_ranges) return 0 ;;
        */*) prefix="${cidr##*/}" ;;
        *) return 1 ;;
    esac
    [[ "$prefix" =~ ^[0-9]+$ ]] || return 0
    if [[ "$cidr" == *:* ]]; then
        [ "$prefix" -lt 16 ]
    else
        [ "$prefix" -lt 8 ]
    fi
}

# edge_config_problems: one line per missing or unsafe edge setting (none
# when the edge is fully configured). Run after resolve_deploy_mode.
#   - TRUSTED_PROXY_CIDRS (Django's trusted peers, comma-separated): required
#     in every mode, never wide. Without it every request looks like Caddy's
#     own address (one throttle bucket for the whole site).
#   - CADDY_TRUSTED_PROXIES: required in proxy mode and for an external
#     cloudflared; never wide. Without it Django sees http behind the proxy
#     (redirect loop) and every client shares one address.
#   - ADMIN_ALLOW_CIDRS: never wide, unless ALLOW_WIDE_ADMIN_CIDRS=1.
edge_config_problems() {
    local cidr
    if is_placeholder_value "${TRUSTED_PROXY_CIDRS:-}"; then
        echo "TRUSTED_PROXY_CIDRS is unset: set it to Caddy's network, APP_SUBNET (${APP_SUBNET})"
    else
        for cidr in ${TRUSTED_PROXY_CIDRS//,/ }; do
            if cidr_is_wide "$cidr"; then
                echo "TRUSTED_PROXY_CIDRS lists ${cidr}, which is far wider than Caddy's network (APP_SUBNET ${APP_SUBNET})"
            fi
        done
    fi
    if [ "$CADDY_MODE" = proxy ] && [ "$TRUSTED_PROXIES_EXPLICIT" != 1 ]; then
        echo "CADDY_MODE=proxy needs CADDY_TRUSTED_PROXIES: the existing reverse proxy's address as Caddy sees it (docs/deploy/DEPLOY.md)"
    fi
    if [ "$CADDY_MODE" = tunnel ] && [ "$TUNNEL_IN_STACK" != 1 ] && [ "$TRUSTED_PROXIES_EXPLICIT" != 1 ]; then
        echo "TUNNEL_EXTERNAL=1 needs CADDY_TRUSTED_PROXIES set to that cloudflared's address or subnet (plus 127.0.0.1/8 ::1/128); see docs/deploy/tunnel.md"
    fi
    if [ "$TRUSTED_PROXIES_EXPLICIT" = 1 ]; then
        for cidr in ${CADDY_TRUSTED_PROXIES}; do
            if cidr_is_wide "$cidr"; then
                echo "CADDY_TRUSTED_PROXIES lists ${cidr}: list only the proxy's own address or subnet"
            fi
        done
    fi
    if [ "${ALLOW_WIDE_ADMIN_CIDRS:-0}" != 1 ]; then
        for cidr in ${ADMIN_ALLOW_CIDRS}; do
            if cidr_is_wide "$cidr"; then
                echo "ADMIN_ALLOW_CIDRS lists ${cidr}, which opens /django-admin, /metrics and readiness to the internet (set ALLOW_WIDE_ADMIN_CIDRS=1 to accept that)"
            fi
        done
    fi
}
