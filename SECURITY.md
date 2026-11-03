# Security

Please report vulnerabilities through this repository's GitHub **Security → Report a vulnerability** feature when enabled. Do not include live credentials, customer information, usable coupon codes or private documents in public issues. If private reporting is unavailable, open a minimal public issue requesting a private contact without exploit details or personal data.

Never publish `.dev.vars`, `.secrets*.json`, local databases or exports. The demo bypass is restricted to loopback hosts. Production must retain Access JWT validation, Turnstile and signed Stripe webhooks.

See [architecture and security](docs/架构与安全.md) for the controls and their limits.
