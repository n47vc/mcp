import type { MCPAppConfig } from './types';
import { getBaseUrl } from './auth/jwt';

export function createWellKnownHandler(config: MCPAppConfig) {
  return async function handler(req: any, res: any) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    // Extract path segments - handle both query.path array and query.mcp array
    const pathSegments = (req.query.path || req.query.mcp || []) as string[];
    // Filter out 'well-known' prefix if present from catch-all routing
    const filtered = pathSegments.filter((s: string) => s !== 'well-known');
    const path = filtered.join('/');

    const baseUrl = getBaseUrl(config, req);
    const registeredServers = config.servers;

    // Per-server OAuth Protected Resource Metadata (RFC 9728)
    const serverSlugMatch = path.match(/^oauth-protected-resource\/api\/mcp\/(.+)$/);
    if (serverSlugMatch) {
      const slug = serverSlugMatch[1];
      const server = registeredServers.find(s => s.slug === slug);
      if (!server) return res.status(404).json({ error: 'not_found' });

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).json({
        resource: `${baseUrl}/api/mcp/${slug}`,
        authorization_servers: [`${baseUrl}/mcp/${slug}`],
        scopes_supported: [],
        resource_name: server.name,
      });
    }

    // Discovery: list all servers
    if (path === 'oauth-protected-resource') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).json({
        resources: registeredServers.map(s => ({
          resource: `${baseUrl}/api/mcp/${s.slug}`,
          resource_name: s.name,
          metadata_url: `${baseUrl}/.well-known/oauth-protected-resource/api/mcp/${s.slug}`,
        })),
        authorization_servers: [baseUrl],
      });
    }

    // Per-server OAuth Authorization Server Metadata (RFC 8414)
    const authServerSlugMatch = path.match(/^oauth-authorization-server\/mcp\/(.+)$/);
    if (authServerSlugMatch) {
      const slug = authServerSlugMatch[1];
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).json({
        issuer: `${baseUrl}/mcp/${slug}`,
        authorization_endpoint: `${baseUrl}/api/mcp/oauth/authorize?server=${slug}`,
        token_endpoint: `${baseUrl}/api/mcp/oauth/token`,
        registration_endpoint: `${baseUrl}/api/mcp/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: [],
      });
    }

    // Base OAuth Authorization Server Metadata
    if (path === 'oauth-authorization-server') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).json({
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/api/mcp/oauth/authorize`,
        token_endpoint: `${baseUrl}/api/mcp/oauth/token`,
        registration_endpoint: `${baseUrl}/api/mcp/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: [],
      });
    }

    return res.status(404).json({ error: 'not_found' });
  };
}
