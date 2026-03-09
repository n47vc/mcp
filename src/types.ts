import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AuthProviderConfig } from './auth/providers';

export interface MCPUserContext {
  email: string;
  name: string;
  /** Provider-specific access token (e.g., Google OAuth token for Gmail/Drive servers) */
  provider_access_token?: string;
  /** Restrict recipients to this domain (e.g., 'mycompany.com') */
  allowedDomain?: string;
}

export interface MCPServerDefinition {
  slug: string;
  name: string;
  icon?: string;
  createServer: (context?: MCPUserContext) => Server;
  /** Auth requirements for this server */
  auth?: {
    /** Additional provider-specific OAuth scopes needed (e.g., gmail.readonly) */
    scopes?: string[];
  };
}

export interface MCPAppConfig {
  /** Secret for JWT signing and token encryption. Generate with: openssl rand -base64 32 */
  secret: string;
  /** OAuth auth provider (e.g., Google) */
  authProvider: AuthProviderConfig;
  /** MCP servers to enable */
  servers: MCPServerDefinition[];
  /** Override auto-detected base URL */
  baseUrl?: string;
  /** Restrict to emails from this domain (e.g., 'mycompany.com') */
  allowedDomain?: string;
  /** Hook fired before a tool executes. Return a CallToolResult to block execution and use that as the response. */
  onToolCall?: (
    server: string,
    tool: string,
    args: unknown,
    email?: string,
  ) => void | CallToolResult | Promise<void | CallToolResult>;
  /** Hook fired after a tool executes. Return a CallToolResult to override the response. */
  onToolComplete?: (
    server: string,
    tool: string,
    args: unknown,
    result: CallToolResult | undefined,
    error: unknown,
    email?: string,
  ) => void | CallToolResult | Promise<void | CallToolResult>;
  /** Token lifetime overrides */
  tokenLifetimes?: {
    /** Access token lifetime (jose duration string, e.g. '1h'). Default: '1h' */
    accessToken?: string;
    /** Refresh token lifetime (jose duration string, e.g. '90d'). Default: '90d' */
    refreshToken?: string;
    /** Auth code lifetime (jose duration string, e.g. '5m'). Default: '5m' */
    authCode?: string;
  };
}

// Re-export auth provider types
export type { AuthProviderConfig, AuthProviderTokens } from './auth/providers';
