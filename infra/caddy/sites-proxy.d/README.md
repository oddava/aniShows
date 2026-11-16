Extra Caddy sites for proxy mode (`CADDY_MODE=proxy`, the default): any `*.caddy` file here is
imported after the application site. Empty on purpose: the host's existing reverse proxy routes the
owner's other sites itself. Use `http://<host>` site addresses here, so Caddy runs no ACME.
