import type { MCPAppConfig } from '../types';
import { createMCPHandler } from '../handler';
import { createRegisterHandler } from '../oauth/register';
import { createAuthorizeHandler } from '../oauth/authorize';
import { createCallbackHandler } from '../oauth/callback';
import { createTokenHandler } from '../oauth/token';
import { createWellKnownHandler } from '../well-known';

export function createMCPApp(config: MCPAppConfig) {
  // Pre-build handlers
  const registerHandler = createRegisterHandler(config);
  const authorizeHandler = createAuthorizeHandler(config);
  const callbackHandler = createCallbackHandler(config);
  const tokenHandler = createTokenHandler(config);
  const wellKnownHandler = createWellKnownHandler(config);

  // Build MCP handlers for each registered server
  const mcpHandlers = new Map<string, ReturnType<typeof createMCPHandler>>();
  for (const server of config.servers) {
    mcpHandlers.set(server.slug, createMCPHandler(server.slug, server.createServer, config));
  }

  return async function handler(req: any, res: any) {
    // Extract path segments from catch-all route
    const segments: string[] = req.query.mcp || [];
    const path = segments.join('/');

    // Well-known routes (forwarded from /.well-known/ via next.config.js rewrites)
    if (path.startsWith('well-known/') || segments[0] === 'well-known') {
      // Pass remaining segments as path query for the well-known handler
      req.query.path = segments.slice(1); // Remove 'well-known' prefix
      return wellKnownHandler(req, res);
    }

    // OAuth routes
    if (path === 'oauth/register') return registerHandler(req, res);
    if (path === 'oauth/authorize') return authorizeHandler(req, res);
    if (path === 'oauth/callback') return callbackHandler(req, res);
    if (path === 'oauth/token') return tokenHandler(req, res);

    // MCP server routes — single segment = server slug
    if (segments.length === 1) {
      const slug = segments[0];
      const mcpHandler = mcpHandlers.get(slug);
      if (mcpHandler) return mcpHandler(req, res);
    }

    return res.status(404).json({ error: 'not_found' });
  };
}
