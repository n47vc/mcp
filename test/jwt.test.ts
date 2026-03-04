import { describe, it, expect } from 'vitest';
import {
  signClientId, verifyClientId,
  signOAuthState, verifyOAuthState,
  signAuthCode, verifyAuthCode,
  signAccessToken, verifyAccessToken,
  signRefreshToken, verifyRefreshToken,
  verifyPKCE, getBaseUrl,
} from '../src/auth/jwt';
import type { MCPAppConfig } from '../src/types';
import { createHash } from 'crypto';

function makeConfig(overrides: Partial<MCPAppConfig> = {}): MCPAppConfig {
  return {
    secret: 'test-secret-that-is-long-enough-for-hmac',
    authProvider: {
      id: 'test',
      name: 'Test',
      getAuthorizationUrl: () => 'https://example.com/auth',
      exchangeCode: async () => ({ email: 'test@example.com', name: 'Test', access_token: 'at', refresh_token: 'rt' }),
      refreshAccessToken: async () => ({ access_token: 'new-at' }),
      getScopesForServer: () => [],
    },
    servers: [],
    ...overrides,
  };
}

// ---------- Client ID ----------

describe('signClientId / verifyClientId', () => {
  it('round-trips a client payload', async () => {
    const config = makeConfig();
    const token = await signClientId({ redirect_uris: ['https://example.com/cb'], client_name: 'My App' }, config);
    expect(typeof token).toBe('string');

    const payload = await verifyClientId(token, config);
    expect(payload).not.toBeNull();
    expect(payload!.redirect_uris).toEqual(['https://example.com/cb']);
    expect(payload!.client_name).toBe('My App');
  });

  it('returns null for a garbage token', async () => {
    const config = makeConfig();
    expect(await verifyClientId('not.a.jwt', config)).toBeNull();
  });

  it('returns null when signed with a different secret', async () => {
    const config1 = makeConfig({ secret: 'secret-one' });
    const config2 = makeConfig({ secret: 'secret-two' });
    const token = await signClientId({ redirect_uris: ['https://a.com'] }, config1);
    expect(await verifyClientId(token, config2)).toBeNull();
  });
});

// ---------- OAuth State ----------

describe('signOAuthState / verifyOAuthState', () => {
  it('round-trips an OAuth state payload', async () => {
    const config = makeConfig();
    const token = await signOAuthState({
      client_id: 'cid',
      redirect_uri: 'https://example.com/cb',
      code_challenge: 'challenge',
      state: 'user-state',
      scope: 'email profile',
    }, config);

    const payload = await verifyOAuthState(token, config);
    expect(payload).not.toBeNull();
    expect(payload!.client_id).toBe('cid');
    expect(payload!.redirect_uri).toBe('https://example.com/cb');
    expect(payload!.code_challenge).toBe('challenge');
    expect(payload!.state).toBe('user-state');
    expect(payload!.scope).toBe('email profile');
  });

  it('returns null for invalid token', async () => {
    expect(await verifyOAuthState('bad', makeConfig())).toBeNull();
  });
});

// ---------- Auth Code ----------

describe('signAuthCode / verifyAuthCode', () => {
  it('round-trips auth code with provider tokens encrypted', async () => {
    const config = makeConfig();
    const token = await signAuthCode({
      email: 'user@example.com',
      name: 'User',
      client_id: 'cid',
      code_challenge: 'ch',
      redirect_uri: 'https://example.com/cb',
      scope: 'openid email',
      provider_access_token: 'google-at',
      provider_refresh_token: 'google-rt',
    }, config);

    const payload = await verifyAuthCode(token, config);
    expect(payload).not.toBeNull();
    expect(payload!.email).toBe('user@example.com');
    expect(payload!.name).toBe('User');
    expect(payload!.scope).toBe('openid email');
    expect(payload!.provider_access_token).toBe('google-at');
    expect(payload!.provider_refresh_token).toBe('google-rt');
  });

  it('round-trips auth code without optional fields', async () => {
    const config = makeConfig();
    const token = await signAuthCode({
      email: 'user@example.com',
      name: 'User',
      client_id: 'cid',
      code_challenge: 'ch',
      redirect_uri: 'https://example.com/cb',
    }, config);

    const payload = await verifyAuthCode(token, config);
    expect(payload).not.toBeNull();
    expect(payload!.scope).toBeUndefined();
    expect(payload!.provider_access_token).toBeUndefined();
    expect(payload!.provider_refresh_token).toBeUndefined();
  });

  it('respects configurable lifetime', async () => {
    const config = makeConfig({ tokenLifetimes: { authCode: '1s' } });
    const token = await signAuthCode({
      email: 'user@example.com',
      name: 'User',
      client_id: 'cid',
      code_challenge: 'ch',
      redirect_uri: 'https://example.com/cb',
    }, config);

    // Should be valid immediately
    expect(await verifyAuthCode(token, config)).not.toBeNull();
  });
});

// ---------- Access Token ----------

describe('signAccessToken / verifyAccessToken', () => {
  it('round-trips an access token with encrypted provider token', async () => {
    const config = makeConfig();
    const token = await signAccessToken({
      email: 'user@example.com',
      name: 'User',
      scopes: ['email', 'profile'],
      provider_access_token: 'google-at',
    }, config);

    const payload = await verifyAccessToken(token, config);
    expect(payload).not.toBeNull();
    expect(payload!.email).toBe('user@example.com');
    expect(payload!.name).toBe('User');
    expect(payload!.scopes).toEqual(['email', 'profile']);
    expect(payload!.provider_access_token).toBe('google-at');
  });

  it('returns null for invalid token', async () => {
    expect(await verifyAccessToken('bad', makeConfig())).toBeNull();
  });

  it('enforces allowedDomain', async () => {
    const config = makeConfig({ allowedDomain: 'company.com' });
    const token = await signAccessToken({
      email: 'user@other.com',
      name: 'User',
      scopes: [],
    }, config);

    expect(await verifyAccessToken(token, config)).toBeNull();
  });

  it('allows matching domain', async () => {
    const config = makeConfig({ allowedDomain: 'company.com' });
    const token = await signAccessToken({
      email: 'user@company.com',
      name: 'User',
      scopes: [],
    }, config);

    expect(await verifyAccessToken(token, config)).not.toBeNull();
  });

  it('respects configurable lifetime', async () => {
    const config = makeConfig({ tokenLifetimes: { accessToken: '2h' } });
    const token = await signAccessToken({
      email: 'user@example.com',
      name: 'User',
      scopes: [],
    }, config);
    expect(await verifyAccessToken(token, config)).not.toBeNull();
  });
});

// ---------- Refresh Token ----------

describe('signRefreshToken / verifyRefreshToken', () => {
  it('round-trips a refresh token with encrypted provider token', async () => {
    const config = makeConfig();
    const token = await signRefreshToken({
      email: 'user@example.com',
      name: 'User',
      scopes: ['email'],
      provider_refresh_token: 'google-rt',
    }, config);

    const payload = await verifyRefreshToken(token, config);
    expect(payload).not.toBeNull();
    expect(payload!.email).toBe('user@example.com');
    expect(payload!.scopes).toEqual(['email']);
    expect(payload!.provider_refresh_token).toBe('google-rt');
  });

  it('returns null for invalid token', async () => {
    expect(await verifyRefreshToken('bad', makeConfig())).toBeNull();
  });

  it('enforces allowedDomain', async () => {
    const config = makeConfig({ allowedDomain: 'company.com' });
    const token = await signRefreshToken({
      email: 'user@other.com',
      name: 'User',
      scopes: [],
    }, config);

    expect(await verifyRefreshToken(token, config)).toBeNull();
  });
});

// ---------- PKCE ----------

describe('verifyPKCE', () => {
  it('validates a correct S256 code_verifier', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(verifyPKCE(verifier, challenge)).toBe(true);
  });

  it('rejects an incorrect code_verifier', () => {
    const challenge = createHash('sha256').update('correct-verifier').digest('base64url');
    expect(verifyPKCE('wrong-verifier', challenge)).toBe(false);
  });

  it('handles trailing padding in challenge', () => {
    const verifier = 'test-verifier';
    const hash = createHash('sha256').update(verifier).digest('base64url');
    // Add trailing = padding that some clients might include
    expect(verifyPKCE(verifier, hash + '=')).toBe(true);
  });
});

// ---------- getBaseUrl ----------

describe('getBaseUrl', () => {
  it('uses config.baseUrl when set', () => {
    const config = makeConfig({ baseUrl: 'https://my-app.vercel.app' });
    expect(getBaseUrl(config)).toBe('https://my-app.vercel.app');
  });

  it('derives URL from request headers', () => {
    const config = makeConfig();
    const req = { headers: { host: 'example.com', 'x-forwarded-proto': 'https' } };
    expect(getBaseUrl(config, req)).toBe('https://example.com');
  });

  it('defaults to http when x-forwarded-proto is missing', () => {
    const config = makeConfig();
    const req = { headers: { host: 'localhost:3000' } };
    expect(getBaseUrl(config, req)).toBe('http://localhost:3000');
  });

  it('falls back to localhost when no request or config', () => {
    const config = makeConfig();
    expect(getBaseUrl(config)).toBe('http://localhost:3000');
  });

  it('prefers config.baseUrl over request headers', () => {
    const config = makeConfig({ baseUrl: 'https://custom.com' });
    const req = { headers: { host: 'other.com', 'x-forwarded-proto': 'https' } };
    expect(getBaseUrl(config, req)).toBe('https://custom.com');
  });
});
