import { describe, it, expect } from 'vitest';
import { createAuthorizeHandler } from '../src/oauth/authorize';
import { signClientId } from '../src/auth/jwt';
import type { MCPAppConfig } from '../src/types';

function makeConfig(): MCPAppConfig {
  return {
    secret: 'test-secret-that-is-long-enough-for-hmac',
    authProvider: {
      id: 'test', name: 'Test',
      getAuthorizationUrl: (callbackUrl: string, state: string, scopes: string[]) =>
        `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&redirect_uri=${callbackUrl}&scope=${scopes.join('+')}`,
      exchangeCode: async () => ({ email: '', name: '', access_token: '', refresh_token: '' }),
      refreshAccessToken: async () => ({ access_token: '' }),
      getBaseScopes: () => ['openid', 'email'],
    },
    servers: [],
  };
}

function mockReq(method: string, query: any = {}, body: any = {}) {
  return { method, query, body, headers: { host: 'localhost:3000' } };
}

function mockRes() {
  const res: any = { statusCode: 0, body: null, redirectUrl: null, headers: {} as Record<string, string> };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (data: any) => { res.body = data; return res; };
  res.redirect = (code: number, url: string) => { res.statusCode = code; res.redirectUrl = url; return res; };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  return res;
}

describe('createAuthorizeHandler', () => {
  it('rejects unsupported methods', async () => {
    const handler = createAuthorizeHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('DELETE'), res);
    expect(res.statusCode).toBe(405);
  });

  it('requires client_id and code_challenge', async () => {
    const handler = createAuthorizeHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('GET', { client_id: 'cid' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('rejects non-S256 code_challenge_method', async () => {
    const handler = createAuthorizeHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('GET', {
      client_id: 'cid',
      code_challenge: 'ch',
      code_challenge_method: 'plain',
    }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error_description).toContain('S256');
  });

  it('rejects invalid client_id', async () => {
    const handler = createAuthorizeHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('GET', {
      client_id: 'not-a-valid-jwt',
      code_challenge: 'ch',
    }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_client');
  });

  it('rejects redirect_uri not in registered list', async () => {
    const config = makeConfig();
    const clientId = await signClientId({ redirect_uris: ['https://app.com/cb'] }, config);
    const handler = createAuthorizeHandler(config);
    const res = mockRes();
    await handler(mockReq('GET', {
      client_id: clientId,
      code_challenge: 'ch',
      redirect_uri: 'https://evil.com/cb',
    }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error_description).toContain('redirect_uri');
  });

  it('redirects to auth provider with valid params', async () => {
    const config = makeConfig();
    const clientId = await signClientId({ redirect_uris: ['https://app.com/cb'] }, config);
    const handler = createAuthorizeHandler(config);
    const res = mockRes();
    await handler(mockReq('GET', {
      client_id: clientId,
      code_challenge: 'my-challenge',
      redirect_uri: 'https://app.com/cb',
      state: 'user-state',
    }), res);

    expect(res.statusCode).toBe(302);
    expect(res.redirectUrl).toContain('accounts.google.com');
  });

  it('auto-selects redirect_uri when only one is registered', async () => {
    const config = makeConfig();
    const clientId = await signClientId({ redirect_uris: ['https://app.com/cb'] }, config);
    const handler = createAuthorizeHandler(config);
    const res = mockRes();
    await handler(mockReq('GET', {
      client_id: clientId,
      code_challenge: 'my-challenge',
    }), res);

    expect(res.statusCode).toBe(302);
  });

  it('includes server-defined scopes in auth URL', async () => {
    const config: MCPAppConfig = {
      ...makeConfig(),
      servers: [{
        slug: 'gmail',
        name: 'Gmail',
        createServer: () => ({} as any),
        auth: { scopes: ['https://www.googleapis.com/auth/gmail.readonly'] },
      }],
    };
    const clientId = await signClientId({ redirect_uris: ['https://app.com/cb'] }, config);
    const handler = createAuthorizeHandler(config);
    const res = mockRes();
    await handler(mockReq('GET', {
      client_id: clientId,
      code_challenge: 'my-challenge',
      redirect_uri: 'https://app.com/cb',
      server: 'gmail',
    }), res);

    expect(res.statusCode).toBe(302);
    expect(res.redirectUrl).toContain('gmail.readonly');
    expect(res.redirectUrl).toContain('openid');
  });

  it('uses only base scopes when no server slug provided', async () => {
    const config: MCPAppConfig = {
      ...makeConfig(),
      servers: [{
        slug: 'gmail',
        name: 'Gmail',
        createServer: () => ({} as any),
        auth: { scopes: ['https://www.googleapis.com/auth/gmail.readonly'] },
      }],
    };
    const clientId = await signClientId({ redirect_uris: ['https://app.com/cb'] }, config);
    const handler = createAuthorizeHandler(config);
    const res = mockRes();
    await handler(mockReq('GET', {
      client_id: clientId,
      code_challenge: 'my-challenge',
      redirect_uri: 'https://app.com/cb',
    }), res);

    expect(res.statusCode).toBe(302);
    expect(res.redirectUrl).not.toContain('gmail.readonly');
    expect(res.redirectUrl).toContain('openid');
  });

  it('works with POST method (body params)', async () => {
    const config = makeConfig();
    const clientId = await signClientId({ redirect_uris: ['https://app.com/cb'] }, config);
    const handler = createAuthorizeHandler(config);
    const res = mockRes();
    await handler(mockReq('POST', {}, {
      client_id: clientId,
      code_challenge: 'my-challenge',
      redirect_uri: 'https://app.com/cb',
    }), res);

    expect(res.statusCode).toBe(302);
  });
});
