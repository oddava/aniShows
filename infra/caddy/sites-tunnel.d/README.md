Extra Caddy sites for tunnel mode (`CADDY_MODE=tunnel`): any `*.caddy` file here is imported
after the application site. Empty on purpose: cloudflared routes other projects on the host itself.
Use `http://<host>` site addresses here, so Caddy runs no ACME.
