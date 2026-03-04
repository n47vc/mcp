import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { MCPUserContext, MCPAppConfig } from './types';
import { verifyAccessToken, getBaseUrl } from './auth/jwt';

export function createMCPHandler(
  serverSlug: string,
  createServer: (context?: MCPUserContext) => Server,
  config: MCPAppConfig
) {
  return async function handler(req: any, res: any) {
    // Auth check
    const authHeader = req.headers?.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      const baseUrl = getBaseUrl(config, req);
      const resourceMetadataUrl = `${baseUrl}/.well-known/oauth-protected-resource/api/mcp/${serverSlug}`;
      res.setHeader(
        'WWW-Authenticate',
        `Bearer resource_metadata="${resourceMetadataUrl}"`
      );
      return res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized' },
        id: null,
      });
    }

    const token = authHeader.slice(7);
    const user = await verifyAccessToken(token, config);
    if (!user) {
      return res.status(403).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Invalid or expired token' },
        id: null,
      });
    }

    // Method validation
    if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') {
      res.setHeader('Allow', 'GET, POST, DELETE');
      return res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Method not allowed' },
        id: null,
      });
    }

    // Create stateless MCP transport + server per request
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    const userContext: MCPUserContext = {
      email: user.email,
      name: user.name,
      provider_access_token: user.provider_access_token,
    };

    const server = createServer(userContext);
    await server.connect(transport);

    try {
      await transport.handleRequest(req, res);
    } finally {
      await server.close();
      await transport.close();
    }
  };
}
