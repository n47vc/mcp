import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { AuthProviderConfig } from './auth/providers';

export interface MCPUserContext {
  email: string;
  name: string;
  /** Provider-specific access token (e.g., Google OAuth token for Gmail/Drive servers) */
  provider_access_token?: string;
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
  /** Hook called on every tool invocation for logging/alerting */
  onToolCall?: (server: string, tool: string, args: unknown, email?: string) => void;
}

// Re-export auth provider types
export type { AuthProviderConfig, AuthProviderTokens } from './auth/providers';
