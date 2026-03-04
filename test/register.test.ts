import { describe, it, expect } from 'vitest';
import { createRegisterHandler } from '../src/oauth/register';
import { verifyClientId } from '../src/auth/jwt';
import type { MCPAppConfig } from '../src/types';

function makeConfig(): MCPAppConfig {
  return {
    secret: 'test-secret-that-is-long-enough-for-hmac',
    authProvider: {
      id: 'test', name: 'Test',
      getAuthorizationUrl: () => '',
      exchangeCode: async () => ({ email: '', name: '', access_token: '', refresh_token: '' }),
      refreshAccessToken: async () => ({ access_token: '' }),
      getBaseScopes: () => [],
    },
    servers: [],
  };
}

function mockReq(method: string, body: any) {
  return { method, body };
}

function mockRes() {
  const res: any = { statusCode: 0, body: null, headers: {} as Record<string, string> };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (data: any) => { res.body = data; return res; };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  return res;
}

describe('createRegisterHandler', () => {
  it('rejects non-POST methods', async () => {
    const handler = createRegisterHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('GET', {}), res);
    expect(res.statusCode).toBe(405);
  });

  it('requires redirect_uris array', async () => {
    const handler = createRegisterHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('POST', {}), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_client_metadata');
  });

  it('rejects empty redirect_uris array', async () => {
    const handler = createRegisterHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('POST', { redirect_uris: [] }), res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects non-URL redirect_uris', async () => {
    const handler = createRegisterHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('POST', { redirect_uris: ['not-a-url'] }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error_description).toContain('Invalid redirect_uri');
  });

  it('rejects non-http/https redirect_uris', async () => {
    const handler = createRegisterHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('POST', { redirect_uris: ['ftp://example.com/cb'] }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error_description).toContain('Invalid redirect_uri');
  });

  it('rejects non-string redirect_uris entries', async () => {
    const handler = createRegisterHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('POST', { redirect_uris: [123] }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error_description).toContain('must be a string');
  });

  it('registers a client with valid redirect_uris', async () => {
    const config = makeConfig();
    const handler = createRegisterHandler(config);
    const res = mockRes();
    await handler(mockReq('POST', {
      redirect_uris: ['https://myapp.com/callback'],
      client_name: 'My App',
    }), res);

    expect(res.statusCode).toBe(201);
    expect(res.body.client_id).toBeTruthy();
    expect(res.body.redirect_uris).toEqual(['https://myapp.com/callback']);
    expect(res.body.client_name).toBe('My App');
    expect(res.body.token_endpoint_auth_method).toBe('none');
    expect(res.body.client_id_issued_at).toBeGreaterThan(0);

    // The client_id should be a valid JWT
    const verified = await verifyClientId(res.body.client_id, config);
    expect(verified).not.toBeNull();
    expect(verified!.redirect_uris).toEqual(['https://myapp.com/callback']);
  });

  it('accepts multiple redirect_uris', async () => {
    const handler = createRegisterHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('POST', {
      redirect_uris: ['https://a.com/cb', 'http://localhost:3000/cb'],
    }), res);

    expect(res.statusCode).toBe(201);
    expect(res.body.redirect_uris).toHaveLength(2);
  });
});
