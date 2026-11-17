# Behind Cloudflare Tunnel: the proxy chain (optional mode)

The default edge is **proxy mode** (`CADDY_MODE=proxy`): the host's existing reverse proxy
terminates TLS and forwards to Caddy; see [DEPLOY.md](DEPLOY.md). This page covers the optional
Cloudflare Tunnel mode, and compares it with public mode:

| | `public` (the old layout) | `tunnel` (optional) |
|---|---|---|
| Who reaches Caddy | the internet, on host ports 80/443 | only `cloudflared`, over a Docker network |
| Host ports | 80, 443 (`infra/compose/public-ports.yml`) | none |
| TLS / ACME | Caddy (Let's Encrypt / ZeroSSL) | Cloudflare edge; Caddy serves plain HTTP on `:80` |
| `CADDY_SITE_ADDRESS` | the domain | `:80` |
| `CADDY_TRUSTED_PROXIES` | `127.0.0.1/8 ::1/128` | `EDGE_SUBNET` + loopback (in-stack cloudflared) |

`scripts/deploy/env.sh` derives the `CADDY_*` values from `CADDY_MODE` (unless set explicitly) for
both `deploy-prod.sh` and `scripts/deploy/compose.sh`. Use the wrapper for manual compose commands.
Caddy stays in both modes. It holds the routing, the read-only MinIO media proxy, the SPA fallback,
the CSP, crawler share previews and the D-9 operator gate, and cloudflared can do none of those.

## The chain

```
browser ──https──▶ Cloudflare edge ──tunnel──▶ cloudflared ──http──▶ Caddy :80 ──http──▶ web:8000 (Django)
                    sets CF-Connecting-IP,       (container)          trusts cloudflared,   trusts exactly one
                    X-Forwarded-Proto: https                           sends ONE XFF entry   proxy hop (Caddy)
```

1. **Cloudflare** sets `CF-Connecting-IP` to the visitor's address and `X-Forwarded-Proto` to the
   scheme the visitor used. It overwrites any `CF-Connecting-IP` the visitor sends.
2. **Caddy** trusts client-IP headers only from `CADDY_TRUSTED_PROXIES` (global `servers` options).
   cloudflared runs on a dedicated `edge` network (`EDGE_SUBNET`, default `10.250.250.240/29`) that only
   it and Caddy join, and only that subnet (plus Caddy's own loopback) is trusted. So `{client_ip}` is
   `CF-Connecting-IP` for tunnel traffic, and no other container (web, celery, other projects) can
   forge it. In public mode only loopback is trusted, so `{client_ip}` is the TCP peer.
   Every `reverse_proxy` to Django imports the `(django)` snippet:
   `header_up X-Forwarded-For {client_ip}`. This **replaces** the header with a single entry.
   `X-Forwarded-Proto` is Caddy's default: from a trusted peer it passes through (Cloudflare's
   `https`); otherwise it is Caddy's own scheme.
3. **Django** keeps its contract unchanged in both modes:
   - `REST_FRAMEWORK["NUM_PROXIES"] = 1` (`DRF_NUM_PROXIES`): throttles key on the last (only) XFF entry.
   - `apps.core.utils.get_client_ip` believes XFF only from `TRUSTED_PROXY_CIDRS` (the Docker ranges).
   - `SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")`. Behind the tunnel the header is
     `https`, so `SECURE_SSL_REDIRECT` never loops. Health paths are exempt.

So every client gets its own login/register/anonymous throttle bucket, and G1's throttles, G5's
view counting and G6's audit IPs need no change. Pinned by `apps/core/tests/test_proxy_chain.py`.

**Why not trust Cloudflare's IP ranges in Django instead?** Behind a tunnel, Django never sees
Cloudflare's addresses, only cloudflared's container. A second trusted hop would also mean
`NUM_PROXIES=2`, which a visitor can defeat by prepending a fake entry whenever the first hop is
skipped. One hop, one entry, set by Caddy, has no such case.

## What a client can and cannot forge

| Header sent by a visitor | Effect |
|---|---|
| any header, from another container on our default network | none: it is not on the edge network, so not a trusted peer |
| `X-Forwarded-For: 1.2.3.4` | none: Caddy replaces XFF with `{client_ip}` |
| `CF-Connecting-IP: 1.2.3.4` | none: Cloudflare overwrites it at the edge; in public mode Caddy ignores it (untrusted peer) |
| `X-Forwarded-Proto: https` (public mode) | none: an untrusted peer's value is replaced by Caddy's scheme |
| `Host: localhost` | not routed: Cloudflare routes by hostname; public-mode Caddy serves only its domain |

With the in-stack cloudflared, only the edge subnet is trusted. With a shared or host cloudflared
(`TUNNEL_EXTERNAL=1`) `deploy-prod.sh` requires `CADDY_TRUSTED_PROXIES` explicitly: the cloudflared
container's fixed address (give it one with `ipv4_address` in its own compose), or, for a host
service, the Docker gateway of the network Caddy's published port uses
(`docker network inspect <project>_default`, as a `/32`), each plus `127.0.0.1/8 ::1/128`. Any trusted peer can
choose the client IP (throttles, D-9). The D-9 gate's loopback exemption is matched on the TCP peer
(`remote_ip`), so no header can claim it.

## Ways to run cloudflared

| Setup | `.env` | Tunnel service URL |
|---|---|---|
| In this stack (default) | `TUNNEL_TOKEN=…` | `http://caddy:80` |
| A cloudflared container shared with other projects | `TUNNEL_EXTERNAL=1`, `COMPOSE_EXTRA_FILES="infra/compose/shared-tunnel-network.yml"`, `TUNNEL_NETWORK=<its network>` | `http://anishows-caddy:80` |
| cloudflared on the host (systemd) | `TUNNEL_EXTERNAL=1`, `COMPOSE_EXTRA_FILES="infra/compose/loopback-port.yml"`, `CADDY_LOOPBACK_PORT=8080` | `http://127.0.0.1:8080`; traffic reaches Caddy from the Docker gateway: set `CADDY_TRUSTED_PROXIES="<gateway>/32 127.0.0.1/8 ::1/128"` |

For a remotely managed tunnel, the hostnames live in the Cloudflare dashboard: `anishows.com` (and
`www.anishows.com` if used) → the service URL above. `infra/cloudflared/config.example.yml` is the
locally managed equivalent. WebSockets (`/ws/*`) work through tunnels with no extra setting.

## Verify on the box (risk R-a: header behaviour is from documentation)

Run these once on the first staging deploy, before trusting the throttles:

```bash
# 1. No redirect loop, HSTS present, request id echoed (CF-Ray):
curl -sI https://anishows.com/api/v1/health/ | grep -iE '^HTTP|strict-transport|x-request-id'
# expect: HTTP/2 200, the HSTS header, x-request-id = the CF-Ray of the response

# 2. Django sees https (an API route, not exempt from the redirect):
curl -s -o /dev/null -w '%{http_code}\n' https://anishows.com/api/v1/genres/      # 200, not 301

# 3. The client IP is the visitor, not cloudflared: log in wrongly 6 times from phone A
#    (mobile data), then once from desktop B. A gets 429 on the 6th, B still gets 401.

# 4. The app's view of the chain, from Caddy's own logs (one line per request):
scripts/deploy/compose.sh exec caddy tail -n 3 /var/log/caddy/access.log \
  | grep -o '"client_ip":"[^"]*"'                                                   # the visitor's IP
```

If step 2 returns 301, cloudflared is not sending `X-Forwarded-Proto` (or Caddy does not trust its
peer): check `CADDY_TRUSTED_PROXIES` against `docker network inspect`. If step 3 shares a bucket,
the same check applies to `CF-Connecting-IP`.

The same checks run in the local dry run with a stand-in for cloudflared (a container on the network
sending `CF-Connecting-IP` and `X-Forwarded-Proto`). Results are in the G7 hand-off report.
