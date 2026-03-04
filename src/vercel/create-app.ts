import type { MCPAppConfig } from '../types';
import { createMCPHandler } from '../handler';
import { createRegisterHandler } from '../oauth/register';
import { createAuthorizeHandler } from '../oauth/authorize';
import { createCallbackHandler } from '../oauth/callback';
import { createTokenHandler } from '../oauth/token';
import { createWellKnownHandler } from '../well-known';

/**
 * Read and parse the request body when Next.js bodyParser is disabled.
 * Handles JSON and application/x-www-form-urlencoded content types.
 */
async function ensureBodyParsed(req: any): Promise<void> {
  if (req.body !== undefined && req.body !== null) return;
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') return;

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', resolve);
    req.on('error', reject);
  });
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) { req.body = {}; return; }

  const contentType = (req.headers?.['content-type'] || '') as string;
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw);
    const result: Record<string, string> = {};
    params.forEach((value, key) => { result[key] = value; });
    req.body = result;
  } else {
    try { req.body = JSON.parse(raw); } catch { req.body = raw; }
  }
}

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

    // OAuth routes — parse body for POST endpoints (needed when bodyParser is disabled)
    if (path === 'oauth/register' || path === 'oauth/token') {
      await ensureBodyParsed(req);
    }
    if (path === 'oauth/register') return registerHandler(req, res);
    if (path === 'oauth/authorize') return authorizeHandler(req, res);
    if (path === 'oauth/callback') return callbackHandler(req, res);
    if (path === 'oauth/token') return tokenHandler(req, res);

    // MCP server routes — parse body for onToolCall hook
    if (segments.length === 1) {
      const slug = segments[0];
      const mcpHandler = mcpHandlers.get(slug);
      if (mcpHandler) {
        if (config.onToolCall && req.method === 'POST') {
          await ensureBodyParsed(req);
        }
        return mcpHandler(req, res);
      }
    }

    return res.status(404).json({ error: 'not_found' });
  };
}
