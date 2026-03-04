# Changelog

## 0.3.0

### New Features

- **Tool lifecycle hooks** — `onToolCall` now supports returning a `CallToolResult` to block execution; new `onToolComplete` hook fires after execution and can override the response

### Breaking Changes

- `onToolCall` signature changed: now accepts `Promise<void | CallToolResult>` return type (previously `void` only). Existing fire-and-forget hooks remain compatible.

## 0.2.0

### New Features

- **Gmail label tools** — `gmail_list_labels`, `gmail_modify_message_labels`, `gmail_modify_thread_labels` for managing labels on emails and threads
- **Scopes from server definitions** — OAuth scopes are now read from `MCPServerDefinition.auth.scopes` automatically; removed `serverScopes` config from `createGoogleAuthProvider`

### Breaking Changes

- `AuthProviderConfig.getScopesForServer()` replaced with `getBaseScopes()` — custom auth providers must update their implementation
- `serverScopes` option removed from `createGoogleAuthProvider` (scopes now come from server definitions)

### Other

- Added `gmail.modify` scope to Gmail server for label management

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
