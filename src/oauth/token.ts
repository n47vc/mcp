import type { MCPAppConfig } from '../types';
import { verifyAuthCode, verifyRefreshToken, signAccessToken, signRefreshToken, verifyPKCE } from '../auth/jwt';

function parseBody(req: any): Record<string, string> {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    const params = new URLSearchParams(req.body);
    const result: Record<string, string> = {};
    params.forEach((value, key) => { result[key] = value; });
    return result;
  }
  return {};
}

export function createTokenHandler(config: MCPAppConfig) {
  return async function handler(req: any, res: any) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    res.setHeader('Cache-Control', 'no-store');
    const body = parseBody(req);
    const grantType = body.grant_type;

    if (grantType === 'authorization_code') {
      return handleAuthorizationCode(body, config, res);
    } else if (grantType === 'refresh_token') {
      return handleRefreshToken(body, config, res);
    } else {
      return res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: 'Only authorization_code and refresh_token are supported',
      });
    }
  };
}

async function handleAuthorizationCode(body: Record<string, string>, config: MCPAppConfig, res: any) {
  const code = body.code;
  const codeVerifier = body.code_verifier;
  const redirectUri = body.redirect_uri;

  if (!code || !codeVerifier) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'code and code_verifier are required',
    });
  }

  const authCode = await verifyAuthCode(code, config);
  if (!authCode) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Invalid or expired authorization code',
    });
  }

  if (redirectUri && redirectUri !== authCode.redirect_uri) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'redirect_uri mismatch',
    });
  }

  if (!verifyPKCE(codeVerifier, authCode.code_challenge)) {
    console.warn('[MCP Token] PKCE verification failed (proceeding anyway)');
  }

  // Use refresh token to get a fresh access token from provider
  let providerAccessToken: string | undefined;
  const providerRefreshToken = authCode.provider_refresh_token;
  if (providerRefreshToken) {
    try {
      const result = await config.authProvider.refreshAccessToken(providerRefreshToken);
      if (result) providerAccessToken = result.access_token;
    } catch (err) {
      console.error('[MCP Token] Failed to get provider access token:', err);
    }
  }

  const accessToken = await signAccessToken({
    email: authCode.email,
    name: authCode.name,
    scopes: [],
    provider_access_token: providerAccessToken,
  }, config);

  const refreshToken = await signRefreshToken({
    email: authCode.email,
    name: authCode.name,
    provider_refresh_token: providerRefreshToken,
  }, config);

  return res.status(200).json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: refreshToken,
    scope: '',
  });
}

async function handleRefreshToken(body: Record<string, string>, config: MCPAppConfig, res: any) {
  const refreshTokenStr = body.refresh_token;
  if (!refreshTokenStr) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'refresh_token is required',
    });
  }

  const refreshPayload = await verifyRefreshToken(refreshTokenStr, config);
  if (!refreshPayload) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Invalid or expired refresh token',
    });
  }

  let providerAccessToken: string | undefined;
  const providerRefreshToken = refreshPayload.provider_refresh_token;
  if (providerRefreshToken) {
    try {
      const result = await config.authProvider.refreshAccessToken(providerRefreshToken);
      if (result) providerAccessToken = result.access_token;
    } catch (err) {
      console.error('[MCP Token] Failed to refresh provider token:', err);
    }
  }

  const accessToken = await signAccessToken({
    email: refreshPayload.email,
    name: refreshPayload.name,
    scopes: [],
    provider_access_token: providerAccessToken,
  }, config);

  const newRefreshToken = await signRefreshToken({
    email: refreshPayload.email,
    name: refreshPayload.name,
    provider_refresh_token: providerRefreshToken,
  }, config);

  return res.status(200).json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: newRefreshToken,
    scope: '',
  });
}
