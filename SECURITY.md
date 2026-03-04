# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it privately by emailing **security@n47.vc** (or open a [GitHub Security Advisory](https://docs.github.com/en/code-security/security-advisories)).

Please **do not** open a public issue for security vulnerabilities.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Security Design

- **JWT signing** — All tokens are signed with HS256 using the `secret` from your config.
- **AES-256-GCM encryption** — Provider tokens (Google OAuth tokens) are encrypted before embedding in JWTs.
- **PKCE (S256)** — Authorization code flow requires Proof Key for Code Exchange; plain code challenges are rejected.
- **Domain restriction** — Optional `allowedDomain` config restricts authentication to a single email domain.
- **No server-side state** — No database or session store is required, reducing the attack surface.

## Known Limitations

- Authorization codes are stateless JWTs and can be replayed within their expiry window (default 5 minutes). PKCE verification mitigates this since only the original client has the `code_verifier`.
