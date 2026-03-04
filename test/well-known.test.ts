import { describe, it, expect } from 'vitest';
import { createWellKnownHandler } from '../src/well-known';
import type { MCPAppConfig, MCPServerDefinition } from '../src/types';

const fakeServer = { slug: 'gmail', name: 'Gmail' } as MCPServerDefinition;

function makeConfig(servers: MCPServerDefinition[] = [fakeServer]): MCPAppConfig {
  return {
    secret: 'test-secret',
    authProvider: {
      id: 'test', name: 'Test',
      getAuthorizationUrl: () => '',
      exchangeCode: async () => ({ email: '', name: '', access_token: '', refresh_token: '' }),
      refreshAccessToken: async () => ({ access_token: '' }),
      getScopesForServer: () => [],
    },
    servers,
    baseUrl: 'https://example.com',
  };
}

// The well-known handler expects req.query.path as an array of path segments
// (set by createMCPApp after stripping 'well-known' prefix)
function mockReq(method: string, pathSegments: string[]) {
  return { method, query: { path: pathSegments }, headers: { host: 'example.com' } };
}

function mockRes() {
  const res: any = { statusCode: 0, body: null, headers: {} as Record<string, string> };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (data: any) => { res.body = data; return res; };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  return res;
}

describe('createWellKnownHandler', () => {
  it('rejects non-GET methods', async () => {
    const handler = createWellKnownHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('POST', ['oauth-protected-resource']), res);
    expect(res.statusCode).toBe(405);
  });

  it('serves oauth-protected-resource discovery', async () => {
    const handler = createWellKnownHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('GET', ['oauth-protected-resource']), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.resources).toHaveLength(1);
    expect(res.body.resources[0].resource).toBe('https://example.com/api/mcp/gmail');
    expect(res.body.authorization_servers).toEqual(['https://example.com']);
  });

  it('serves per-server oauth-protected-resource metadata', async () => {
    const handler = createWellKnownHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('GET', ['oauth-protected-resource', 'api', 'mcp', 'gmail']), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.resource).toBe('https://example.com/api/mcp/gmail');
    expect(res.body.resource_name).toBe('Gmail');
  });

  it('returns 404 for unknown server slug', async () => {
    const handler = createWellKnownHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('GET', ['oauth-protected-resource', 'api', 'mcp', 'unknown']), res);
    expect(res.statusCode).toBe(404);
  });

  it('serves oauth-authorization-server metadata', async () => {
    const handler = createWellKnownHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('GET', ['oauth-authorization-server']), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.issuer).toBe('https://example.com');
    expect(res.body.authorization_endpoint).toBe('https://example.com/api/mcp/oauth/authorize');
    expect(res.body.token_endpoint).toBe('https://example.com/api/mcp/oauth/token');
    expect(res.body.registration_endpoint).toBe('https://example.com/api/mcp/oauth/register');
    expect(res.body.response_types_supported).toEqual(['code']);
    expect(res.body.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    expect(res.body.token_endpoint_auth_methods_supported).toEqual(['none']);
    expect(res.body.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('serves per-server oauth-authorization-server metadata', async () => {
    const handler = createWellKnownHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('GET', ['oauth-authorization-server', 'mcp', 'gmail']), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.issuer).toBe('https://example.com/mcp/gmail');
    expect(res.body.token_endpoint_auth_methods_supported).toEqual(['none']);
  });

  it('returns 404 for unrecognized well-known paths', async () => {
    const handler = createWellKnownHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('GET', ['something-else']), res);
    expect(res.statusCode).toBe(404);
  });
});
