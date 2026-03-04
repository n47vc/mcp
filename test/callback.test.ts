import { describe, it, expect, vi } from 'vitest';
import { createCallbackHandler } from '../src/oauth/callback';
import { signOAuthState, verifyAuthCode } from '../src/auth/jwt';
import type { MCPAppConfig } from '../src/types';

function makeConfig(overrides: Partial<MCPAppConfig> = {}): MCPAppConfig {
  return {
    secret: 'test-secret-that-is-long-enough-for-hmac',
    authProvider: {
      id: 'test', name: 'Test',
      getAuthorizationUrl: () => '',
      exchangeCode: async () => ({
        email: 'user@example.com',
        name: 'Test User',
        access_token: 'provider-at',
        refresh_token: 'provider-rt',
      }),
      refreshAccessToken: async () => ({ access_token: '' }),
      getBaseScopes: () => [],
    },
    servers: [],
    ...overrides,
  };
}

function mockReq(method: string, query: any = {}) {
  return { method, query, headers: { host: 'localhost:3000' } };
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

describe('createCallbackHandler', () => {
  it('rejects non-GET methods', async () => {
    const handler = createCallbackHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('POST'), res);
    expect(res.statusCode).toBe(405);
  });

  it('returns error when OAuth error param is present', async () => {
    const handler = createCallbackHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('GET', { error: 'access_denied' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.headers['Content-Type']).toBe('text/plain');
    expect(res.sent).toContain('access_denied');
  });

  it('requires code and state params', async () => {
    const handler = createCallbackHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('GET', {}), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('rejects invalid state token', async () => {
    const handler = createCallbackHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('GET', { code: 'auth-code', state: 'invalid' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('redirects with auth code on success', async () => {
    const config = makeConfig();
    const state = await signOAuthState({
      client_id: 'cid',
      redirect_uri: 'https://app.com/cb',
      code_challenge: 'challenge',
      state: 'user-state',
      scope: 'email',
    }, config);

    const handler = createCallbackHandler(config);
    const res = mockRes();
    await handler(mockReq('GET', { code: 'provider-code', state }), res);

    expect(res.statusCode).toBe(302);
    expect(res.redirectUrl).toBeTruthy();

    const url = new URL(res.redirectUrl);
    expect(url.origin).toBe('https://app.com');
    expect(url.searchParams.get('state')).toBe('user-state');

    // Verify the auth code is valid
    const authCode = url.searchParams.get('code')!;
    const verified = await verifyAuthCode(authCode, config);
    expect(verified).not.toBeNull();
    expect(verified!.email).toBe('user@example.com');
    expect(verified!.scope).toBe('email');
    expect(verified!.provider_access_token).toBe('provider-at');
    expect(verified!.provider_refresh_token).toBe('provider-rt');
  });

  it('redirects with error when domain is restricted', async () => {
    const config = makeConfig({ allowedDomain: 'company.com' });
    const state = await signOAuthState({
      client_id: 'cid',
      redirect_uri: 'https://app.com/cb',
      code_challenge: 'challenge',
      state: 'user-state',
    }, config);

    const handler = createCallbackHandler(config);
    const res = mockRes();
    await handler(mockReq('GET', { code: 'provider-code', state }), res);

    expect(res.statusCode).toBe(302);
    const url = new URL(res.redirectUrl);
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('user-state');
  });

  it('returns provider error when exchangeCode fails', async () => {
    const config = makeConfig({
      authProvider: {
        id: 'test', name: 'Test',
        getAuthorizationUrl: () => '',
        exchangeCode: async () => { throw new Error('Google API error'); },
        refreshAccessToken: async () => ({ access_token: '' }),
        getBaseScopes: () => [],
      },
    });

    const state = await signOAuthState({
      client_id: 'cid',
      redirect_uri: 'https://app.com/cb',
      code_challenge: 'challenge',
    }, config);

    const handler = createCallbackHandler(config);
    const res = mockRes();
    await handler(mockReq('GET', { code: 'bad-code', state }), res);

    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe('provider_error');
  });
});
