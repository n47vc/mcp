import { describe, it, expect, vi } from 'vitest';
import { createTokenHandler } from '../src/oauth/token';
import { signAuthCode, signRefreshToken, verifyAccessToken, verifyRefreshToken } from '../src/auth/jwt';
import type { MCPAppConfig } from '../src/types';
import { createHash } from 'crypto';

function makeConfig(overrides: Partial<MCPAppConfig> = {}): MCPAppConfig {
  return {
    secret: 'test-secret-that-is-long-enough-for-hmac',
    authProvider: {
      id: 'test', name: 'Test',
      getAuthorizationUrl: () => '',
      exchangeCode: async () => ({ email: '', name: '', access_token: '', refresh_token: '' }),
      refreshAccessToken: async () => ({ access_token: 'refreshed-at' }),
      getBaseScopes: () => [],
    },
    servers: [],
    ...overrides,
  };
}

function mockReq(method: string, body: any) {
  return { method, body, headers: {} };
}

function mockRes() {
  const res: any = { statusCode: 0, body: null, headers: {} as Record<string, string> };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (data: any) => { res.body = data; return res; };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  return res;
}

describe('createTokenHandler', () => {
  it('rejects non-POST methods', async () => {
    const handler = createTokenHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('GET', {}), res);
    expect(res.statusCode).toBe(405);
  });

  it('rejects unsupported grant_type', async () => {
    const handler = createTokenHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('POST', { grant_type: 'client_credentials' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('unsupported_grant_type');
  });

  it('sets Cache-Control: no-store header', async () => {
    const handler = createTokenHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('POST', { grant_type: 'authorization_code' }), res);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });
});

describe('authorization_code grant', () => {
  it('requires code and code_verifier', async () => {
    const handler = createTokenHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('POST', { grant_type: 'authorization_code' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('rejects invalid auth code', async () => {
    const handler = createTokenHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('POST', {
      grant_type: 'authorization_code',
      code: 'invalid-code',
      code_verifier: 'verifier',
    }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('rejects PKCE verification failure', async () => {
    const config = makeConfig();
    const codeChallenge = createHash('sha256').update('correct-verifier').digest('base64url');
    const code = await signAuthCode({
      email: 'user@example.com',
      name: 'User',
      client_id: 'cid',
      code_challenge: codeChallenge,
      redirect_uri: 'https://example.com/cb',
    }, config);

    const handler = createTokenHandler(config);
    const res = mockRes();
    await handler(mockReq('POST', {
      grant_type: 'authorization_code',
      code,
      code_verifier: 'wrong-verifier',
    }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error_description).toContain('PKCE');
  });

  it('rejects client_id mismatch', async () => {
    const config = makeConfig();
    const verifier = 'test-verifier';
    const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
    const code = await signAuthCode({
      email: 'user@example.com',
      name: 'User',
      client_id: 'correct-client',
      code_challenge: codeChallenge,
      redirect_uri: 'https://example.com/cb',
    }, config);

    const handler = createTokenHandler(config);
    const res = mockRes();
    await handler(mockReq('POST', {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: 'wrong-client',
    }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error_description).toContain('client_id');
  });

  it('rejects redirect_uri mismatch', async () => {
    const config = makeConfig();
    const verifier = 'test-verifier';
    const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
    const code = await signAuthCode({
      email: 'user@example.com',
      name: 'User',
      client_id: 'cid',
      code_challenge: codeChallenge,
      redirect_uri: 'https://example.com/cb',
    }, config);

    const handler = createTokenHandler(config);
    const res = mockRes();
    await handler(mockReq('POST', {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: 'https://evil.com/cb',
    }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error_description).toContain('redirect_uri');
  });

  it('exchanges a valid auth code for tokens', async () => {
    const config = makeConfig();
    const verifier = 'test-code-verifier-string';
    const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
    const code = await signAuthCode({
      email: 'user@example.com',
      name: 'User',
      client_id: 'cid',
      code_challenge: codeChallenge,
      redirect_uri: 'https://example.com/cb',
      scope: 'email profile',
      provider_access_token: 'google-at',
      provider_refresh_token: 'google-rt',
    }, config);

    const handler = createTokenHandler(config);
    const res = mockRes();
    await handler(mockReq('POST', {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.refresh_token).toBeTruthy();
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.expires_in).toBe(3600);
    expect(res.body.scope).toBe('email profile');

    // Verify the access token contains the right data
    const at = await verifyAccessToken(res.body.access_token, config);
    expect(at).not.toBeNull();
    expect(at!.email).toBe('user@example.com');
    expect(at!.scopes).toEqual(['email', 'profile']);
    expect(at!.provider_access_token).toBe('google-at');
  });

  it('uses configured token lifetime in expires_in', async () => {
    const config = makeConfig({ tokenLifetimes: { accessToken: '30m' } });
    const verifier = 'test-verifier';
    const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
    const code = await signAuthCode({
      email: 'user@example.com',
      name: 'User',
      client_id: 'cid',
      code_challenge: codeChallenge,
      redirect_uri: 'https://example.com/cb',
    }, config);

    const handler = createTokenHandler(config);
    const res = mockRes();
    await handler(mockReq('POST', {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.expires_in).toBe(1800); // 30 * 60
  });
});

describe('refresh_token grant', () => {
  it('requires refresh_token parameter', async () => {
    const handler = createTokenHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('POST', { grant_type: 'refresh_token' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('rejects invalid refresh token', async () => {
    const handler = createTokenHandler(makeConfig());
    const res = mockRes();
    await handler(mockReq('POST', {
      grant_type: 'refresh_token',
      refresh_token: 'invalid',
    }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('refreshes a valid token', async () => {
    const config = makeConfig();
    const rt = await signRefreshToken({
      email: 'user@example.com',
      name: 'User',
      scopes: ['email'],
      provider_refresh_token: 'google-rt',
    }, config);

    const handler = createTokenHandler(config);
    const res = mockRes();
    await handler(mockReq('POST', {
      grant_type: 'refresh_token',
      refresh_token: rt,
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.refresh_token).toBeTruthy();
    expect(res.body.scope).toBe('email');

    // Verify the new access token
    const at = await verifyAccessToken(res.body.access_token, config);
    expect(at).not.toBeNull();
    expect(at!.email).toBe('user@example.com');
    expect(at!.provider_access_token).toBe('refreshed-at');
  });

  it('handles provider refresh failure gracefully', async () => {
    const config = makeConfig({
      authProvider: {
        id: 'test', name: 'Test',
        getAuthorizationUrl: () => '',
        exchangeCode: async () => ({ email: '', name: '', access_token: '', refresh_token: '' }),
        refreshAccessToken: async () => { throw new Error('Provider down'); },
        getBaseScopes: () => [],
      },
    });

    const rt = await signRefreshToken({
      email: 'user@example.com',
      name: 'User',
      scopes: [],
      provider_refresh_token: 'google-rt',
    }, config);

    const handler = createTokenHandler(config);
    const res = mockRes();
    await handler(mockReq('POST', {
      grant_type: 'refresh_token',
      refresh_token: rt,
    }), res);

    // Should still succeed, just without provider token
    expect(res.statusCode).toBe(200);
    expect(res.body.access_token).toBeTruthy();
  });
});
