# @n47vc/mcp

Deploy MCP servers to Vercel in minutes. Includes Gmail, Google Drive, and Apollo.io servers with pluggable OAuth authentication.

## Quick Start

### Option A: Fork & Deploy (fastest)

Fork this repo, then:

```bash
cd app
cp .env.example .env.local   # fill in your credentials
npm install
vercel deploy
```

See [app/.env.example](app/.env.example) for all configuration options.

### Option B: Install as npm package

1. Create a new Next.js project:

   ```bash
   npx create-next-app@latest my-mcp-servers --typescript
   cd my-mcp-servers
   npm install @n47vc/mcp
   ```

2. Create `pages/api/mcp/[...mcp].ts`:

   ```typescript
   import { createMCPApp, createGoogleAuthProvider, gmail, gdrive } from '@n47vc/mcp';

   export const config = { api: { bodyParser: false } };

   export default createMCPApp({
     secret: process.env.MCP_SECRET!,
     authProvider: createGoogleAuthProvider({
       clientId: process.env.GOOGLE_CLIENT_ID!,
       clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
     }),
     servers: [gmail, gdrive],
   });
   ```

3. Add well-known rewrites to `next.config.js`:

   ```javascript
   module.exports = {
     async rewrites() {
       return [
         { source: '/.well-known/:path*', destination: '/api/mcp/well-known/:path*' },
       ];
     },
   };
   ```

4. Set environment variables and deploy:

   ```bash
   vercel env add MCP_SECRET
   vercel env add GOOGLE_CLIENT_ID
   vercel env add GOOGLE_CLIENT_SECRET
   vercel deploy
   ```

## Available Servers

| Server | Import | Description | Extra Env Vars |
|--------|--------|-------------|----------------|
| Gmail | `gmail` | Read threads, compose drafts, send emails | — |
| Google Drive | `gdrive` | Search, read, and upload files | — |
| Apollo | `apollo` | Company enrichment, people search | `APOLLO_API_KEY` |

See each server's README for full tool documentation:
- [Gmail](src/servers/gmail/README.md)
- [Google Drive](src/servers/gdrive/README.md)
- [Apollo](src/servers/apollo/README.md)

## Configuration

### `createMCPApp(config)`

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `secret` | `string` | Yes | Secret for JWT signing and token encryption. Generate with `openssl rand -base64 32` |
| `authProvider` | `AuthProviderConfig` | Yes | OAuth provider (see below) |
| `servers` | `MCPServerDefinition[]` | Yes | Array of MCP servers to enable |
| `baseUrl` | `string` | No | Override auto-detected base URL |
| `allowedDomain` | `string` | No | Restrict to emails from this domain (e.g., `'mycompany.com'`) |
| `onToolCall` | `function` | No | Hook called on every tool invocation for logging/alerting |
| `tokenLifetimes` | `object` | No | Override token lifetimes (`accessToken`, `refreshToken`, `authCode` — jose duration strings like `'1h'`, `'90d'`, `'5m'`) |

### `createGoogleAuthProvider(options)`

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `clientId` | `string` | Yes | Google OAuth client ID |
| `clientSecret` | `string` | Yes | Google OAuth client secret |
| `allowedDomain` | `string` | No | Restrict Google login to this domain |
| `serverScopes` | `Record<string, string[]>` | No | Additional OAuth scopes per server slug |

All servers authenticate users via Google OAuth (openid + email + profile). Servers that need Google API access (Gmail, Drive) request additional scopes configured via `serverScopes`.

## Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use an existing one)
3. Enable the APIs you need:
   - **Gmail API** — if using the Gmail server
   - **Google Drive API** — if using the Google Drive server
   - **Google Docs API** — if using the Google Drive server
   - **Google Sheets API** — if using the Google Drive server
   - **Google Slides API** — if using the Google Drive server
4. Go to **Credentials** > **Create Credentials** > **OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Add authorized redirect URI: `https://your-domain.com/api/mcp/oauth/callback`
7. Copy the Client ID and Client Secret to your environment variables

## Auth Provider Interface

To add a new auth provider (e.g., Microsoft, GitHub), implement the `AuthProviderConfig` interface:

```typescript
interface AuthProviderConfig {
  id: string;
  name: string;
  getAuthorizationUrl(callbackUrl: string, state: string, scopes: string[]): string;
  exchangeCode(code: string, callbackUrl: string): Promise<AuthProviderTokens>;
  refreshAccessToken(refreshToken: string): Promise<{ access_token: string } | undefined>;
  getScopesForServer(serverSlug?: string): string[];
}
```

## Architecture

- **Stateless** — Each request creates a fresh MCP server instance. No session storage.
- **JWT-based tokens** — Access tokens (1h) and refresh tokens (90d) are signed JWTs with AES-256-GCM encrypted provider tokens. No database required.
- **PKCE** — OAuth authorization code flow with Proof Key for Code Exchange.
- **RFC 8414/9728** — Standard OAuth discovery endpoints for automatic client configuration.

### Known Limitations

- **Auth codes are replayable** — Authorization codes are stateless JWTs, so the same code can be exchanged multiple times within its 5-minute expiry window. RFC 6749 requires single-use auth codes, but enforcing this would require server-side storage. PKCE verification mitigates the risk since only the original client possesses the `code_verifier`.

## License

MIT
