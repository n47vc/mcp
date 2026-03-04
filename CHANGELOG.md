# Changelog

## 0.1.0

Initial release.

- Gmail, Google Drive, and Apollo.io MCP servers
- Google OAuth provider with PKCE
- Stateless JWT-based token management with AES-256-GCM encrypted provider tokens
- Vercel / Next.js Pages Router adapter (`createMCPApp`)
- RFC 8414 / 9728 OAuth discovery endpoints
- Configurable token lifetimes
- `onToolCall` hook for logging / alerting
- Structured error types (`MCPError`, `AuthError`, `ProviderError`)
