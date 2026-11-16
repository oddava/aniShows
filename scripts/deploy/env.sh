# shellcheck shell=bash
#
# Shared by deploy-prod.sh and scripts/deploy/compose.sh (source it from the
# repo root). Reads .env the way Compose does and derives everything that
# depends on CADDY_MODE, so a manual `docker compose` call never brings Caddy
# up in the wrong mode. Sets:
#   COMPOSE (array)        docker compose -f ... with the mode's override files
#   COMPOSE_PROFILES       bundled-db / analytics / tunnel (exported)
#   CADDY_* (exported)     site addresses, trusted peers, HSTS header
#   DOMAIN, ANALYTICS, TUNNEL_IN_STACK
# Never prints secrets.

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
            else
                val="${val%%[[:space:]]#*}"
                val="${val%"${val##*[![:space:]]}"}"
            fi
            if [[ "$val" == *'$'* ]]; then
                die "$file: $key contains '\$', which Compose would interpolate; wrap the value in single quotes"
            fi
            if [[ "$val" == *'\'* ]]; then
                die "$file: $key contains a backslash, which Compose unescapes in this form; wrap the value in single quotes"
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

# The image tags the last successful deploy-prod.sh run used (CI passes
# sha-<commit> tags through the shell, so .env alone would name a stale
# :latest). compose.sh and verify_backup.sh load this before .env, so manual
# commands run the deployed code: shell > deployed state > .env.
DEPLOYED_STATE_FILE="backups-data/deployed.env"
load_deployed_state() {
    load_env_file "$DEPLOYED_STATE_FILE"
}

is_true() { case "${1,,}" in 1|true|yes|on) return 0 ;; *) return 1 ;; esac; }

resolve_deploy_mode() {
    CADDY_MODE="${CADDY_MODE:-public}"
    case "$CADDY_MODE" in
        public|tunnel) ;;
        *) die "CADDY_MODE must be 'public' or 'tunnel' (got '$CADDY_MODE')" ;;
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
    [ -n "${CADDY_TRUSTED_PROXIES:-}" ] && TRUSTED_PROXIES_EXPLICIT=1
    export TRUSTED_PROXIES_EXPLICIT  # read by deploy-prod.sh
    export EDGE_SUBNET="${EDGE_SUBNET:-10.250.250.240/29}"
    if [ "$CADDY_MODE" = tunnel ]; then
        : "${CADDY_SITE_ADDRESS:=:80}"
        if [ "$TUNNEL_IN_STACK" = 1 ]; then
            # Only cloudflared and Caddy sit on the edge network: no other
            # container can set CF-Connecting-IP.
            : "${CADDY_TRUSTED_PROXIES:=${EDGE_SUBNET} ${loopback}}"
        else
            # A shared or host cloudflared: narrow this to its address/subnet.
            : "${CADDY_TRUSTED_PROXIES:=private_ranges}"
        fi
        if [ "$ANALYTICS" = 1 ]; then : "${CADDY_UMAMI_SITE_ADDRESS:=http://${UMAMI_DOMAIN:-umami.invalid}}"; fi
    else
        # As given (may list several hosts, e.g. "anishows.com, www.anishows.com").
        : "${CADDY_SITE_ADDRESS:=${DOMAIN_NAME:-localhost}}"
        : "${CADDY_TRUSTED_PROXIES:=${loopback}}"
        if [ "$ANALYTICS" = 1 ]; then : "${CADDY_UMAMI_SITE_ADDRESS:=${UMAMI_DOMAIN:-http://umami.invalid}}"; fi
    fi
    : "${CADDY_UMAMI_SITE_ADDRESS:=http://umami.invalid}"

    local hsts_seconds="${SECURE_HSTS_SECONDS:-31536000}" hsts
    [[ "$hsts_seconds" =~ ^[0-9]+$ ]] || die "SECURE_HSTS_SECONDS must be a whole number of seconds"
    hsts="max-age=${hsts_seconds}"
    is_true "${SECURE_HSTS_INCLUDE_SUBDOMAINS:-True}" && hsts+="; includeSubDomains"
    is_true "${SECURE_HSTS_PRELOAD:-True}" && hsts+="; preload"
    : "${CADDY_HSTS_HEADER:=$hsts}"
    export CADDY_SITE_ADDRESS CADDY_TRUSTED_PROXIES CADDY_UMAMI_SITE_ADDRESS CADDY_HSTS_HEADER
}
