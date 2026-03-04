import { describe, it, expect } from 'vitest';
import { createMCPApp } from '../src/vercel/create-app';
import type { MCPAppConfig, MCPServerDefinition } from '../src/types';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

function makeConfig(overrides: Partial<MCPAppConfig> = {}): MCPAppConfig {
  return {
    secret: 'test-secret-that-is-long-enough-for-hmac',
    authProvider: {
      id: 'test', name: 'Test',
      getAuthorizationUrl: () => '',
      exchangeCode: async () => ({ email: '', name: '', access_token: '', refresh_token: '' }),
      refreshAccessToken: async () => ({ access_token: '' }),
      getScopesForServer: () => [],
    },
    servers: [
      { slug: 'gmail', name: 'Gmail', createServer: () => ({} as Server) },
    ],
    baseUrl: 'https://example.com',
    ...overrides,
  };
}

// createMCPApp uses req.query.mcp as the catch-all path segments array
function mockReq(method: string, mcpSegments: string[], body?: any) {
  return {
    method,
    url: '/api/mcp/' + mcpSegments.join('/'),
    headers: { host: 'example.com', 'content-type': 'application/json' },
    query: { mcp: mcpSegments },
    body,
    on: (event: string, cb: Function) => {
      if (event === 'end') cb();
    },
  };
}

function mockRes() {
  const res: any = { statusCode: 0, body: null, redirectUrl: null, headers: {} as Record<string, string>, sent: null };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (data: any) => { res.body = data; return res; };
  res.send = (data: any) => { res.sent = data; return res; };
  res.redirect = (code: number, url: string) => { res.statusCode = code; res.redirectUrl = url; return res; };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  return res;
}

describe('createMCPApp routing', () => {
  it('routes well-known requests', async () => {
    const app = createMCPApp(makeConfig());
    const res = mockRes();
    await app(mockReq('GET', ['well-known', 'oauth-authorization-server']), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.issuer).toBe('https://example.com');
  });

  it('routes oauth/register', async () => {
    const app = createMCPApp(makeConfig());
    const res = mockRes();
    await app(mockReq('POST', ['oauth', 'register'], {
      redirect_uris: ['https://app.com/cb'],
    }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body.client_id).toBeTruthy();
  });

  it('routes oauth/token', async () => {
    const app = createMCPApp(makeConfig());
    const res = mockRes();
    await app(mockReq('POST', ['oauth', 'token'], {
      grant_type: 'authorization_code',
    }), res);
    // Should get 400 because no code/verifier, but it reached the handler
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('returns 404 for unknown paths', async () => {
    const app = createMCPApp(makeConfig());
    const res = mockRes();
    await app(mockReq('GET', ['unknown', 'path', 'here']), res);
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('routes to MCP server handler by slug', async () => {
    const app = createMCPApp(makeConfig());
    const res = mockRes();
    // Without auth, should get 401
    await app(mockReq('POST', ['gmail']), res);
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for unregistered server slug', async () => {
    const app = createMCPApp(makeConfig());
    const res = mockRes();
    await app(mockReq('POST', ['unknown']), res);
    expect(res.statusCode).toBe(404);
  });
});

describe('ensureBodyParsed', () => {
  it('parses JSON body from stream when body is undefined', async () => {
    const app = createMCPApp(makeConfig());
    const jsonBody = JSON.stringify({ redirect_uris: ['https://app.com/cb'] });
    const req: any = {
      method: 'POST',
      url: '/api/mcp/oauth/register',
      headers: { host: 'example.com', 'content-type': 'application/json' },
      query: { mcp: ['oauth', 'register'] },
      body: undefined,
      on: (event: string, cb: Function) => {
        if (event === 'data') cb(Buffer.from(jsonBody));
        if (event === 'end') cb();
      },
    };
    const res = mockRes();
    await app(req, res);
    expect(res.statusCode).toBe(201);
  });

  it('parses form-encoded body from stream', async () => {
    const app = createMCPApp(makeConfig());
    const formBody = 'grant_type=authorization_code&code=test&code_verifier=verifier';
    const req: any = {
      method: 'POST',
      url: '/api/mcp/oauth/token',
      headers: { host: 'example.com', 'content-type': 'application/x-www-form-urlencoded' },
      query: { mcp: ['oauth', 'token'] },
      body: undefined,
      on: (event: string, cb: Function) => {
        if (event === 'data') cb(Buffer.from(formBody));
        if (event === 'end') cb();
      },
    };
    const res = mockRes();
    await app(req, res);
    // Should reach the handler and fail with invalid_grant (not a parse error)
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('skips body parsing for non-POST methods', async () => {
    const app = createMCPApp(makeConfig());
    const res = mockRes();
    await app(mockReq('GET', ['oauth', 'callback']), res);
    // callback requires code/state, should get 400
    expect(res.statusCode).toBe(400);
  });
});
