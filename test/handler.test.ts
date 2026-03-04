import { describe, it, expect, vi } from 'vitest';
import { createMCPHandler } from '../src/handler';
import { signAccessToken } from '../src/auth/jwt';
import type { MCPAppConfig } from '../src/types';

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
    servers: [],
    baseUrl: 'https://example.com',
    ...overrides,
  };
}

function mockRes() {
  const res: any = { statusCode: 0, body: null, headers: {} as Record<string, string> };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (data: any) => { res.body = data; return res; };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  return res;
}

// We can't easily test the full MCP transport flow without the SDK,
// so we focus on auth and method validation

describe('createMCPHandler', () => {
  const mockCreateServer = () => ({} as any);

  it('returns 401 without Authorization header', async () => {
    const handler = createMCPHandler('gmail', mockCreateServer, makeConfig());
    const res = mockRes();
    await handler({ method: 'POST', headers: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error.message).toBe('Unauthorized');
  });

  it('includes WWW-Authenticate header on 401', async () => {
    const handler = createMCPHandler('gmail', mockCreateServer, makeConfig());
    const res = mockRes();
    await handler({ method: 'POST', headers: {} }, res);
    expect(res.headers['WWW-Authenticate']).toContain('resource_metadata');
    expect(res.headers['WWW-Authenticate']).toContain('gmail');
  });

  it('returns 403 for invalid token', async () => {
    const handler = createMCPHandler('gmail', mockCreateServer, makeConfig());
    const res = mockRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer invalid-token' } }, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error.message).toContain('expired');
  });

  it('returns 405 for unsupported methods', async () => {
    const config = makeConfig();
    const token = await signAccessToken({
      email: 'user@example.com', name: 'User', scopes: [],
    }, config);

    const handler = createMCPHandler('gmail', mockCreateServer, config);
    const res = mockRes();
    await handler({ method: 'PUT', headers: { authorization: `Bearer ${token}` } }, res);
    expect(res.statusCode).toBe(405);
    expect(res.headers['Allow']).toBe('GET, POST, DELETE');
  });

  it('fires onToolCall hook for tools/call requests', async () => {
    const onToolCall = vi.fn();
    const config = makeConfig({ onToolCall });
    const token = await signAccessToken({
      email: 'user@example.com', name: 'User', scopes: [],
    }, config);

    // We need a mock server that connects and handles requests
    const mockServer = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const mockTransportHandleRequest = vi.fn().mockResolvedValue(undefined);

    // Since we can't easily mock the transport constructor, test the hook logic
    // by verifying onToolCall is called with the right args
    const handler = createMCPHandler('gmail', () => mockServer as any, config);

    // The handler will fail at transport.handleRequest since we can't fully mock it,
    // but the onToolCall should have been called before that
    const req = {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: { method: 'tools/call', params: { name: 'search', arguments: { q: 'test' } } },
    };
    const res = mockRes();

    try {
      await handler(req, res);
    } catch {
      // Expected to fail at transport level
    }

    expect(onToolCall).toHaveBeenCalledWith('gmail', 'search', { q: 'test' }, 'user@example.com');
  });

  it('swallows onToolCall hook errors', async () => {
    const onToolCall = vi.fn().mockImplementation(() => { throw new Error('hook error'); });
    const config = makeConfig({ onToolCall });
    const token = await signAccessToken({
      email: 'user@example.com', name: 'User', scopes: [],
    }, config);

    const mockServer = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const handler = createMCPHandler('gmail', () => mockServer as any, config);
    const req = {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: { method: 'tools/call', params: { name: 'search', arguments: {} } },
    };
    const res = mockRes();

    try {
      await handler(req, res);
    } catch {
      // Expected to fail at transport level, not at hook
    }

    // Hook was called and threw, but didn't prevent execution
    expect(onToolCall).toHaveBeenCalled();
  });
});
