import type { MCPAppConfig } from '../types';
import { verifyClientId, signOAuthState, getBaseUrl } from '../auth/jwt';

export function createAuthorizeHandler(config: MCPAppConfig) {
  return async function handler(req: any, res: any) {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    const params = req.method === 'POST' ? req.body : req.query;
    const clientId = params.client_id as string;
    const redirectUri = params.redirect_uri as string;
    const codeChallenge = params.code_challenge as string;
    const codeChallengeMethod = params.code_challenge_method as string;
    const state = params.state as string | undefined;
    const scope = params.scope as string | undefined;

    if (!clientId || !codeChallenge) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'client_id and code_challenge are required',
      });
    }

    if (codeChallengeMethod && codeChallengeMethod !== 'S256') {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Only S256 code_challenge_method is supported',
      });
    }

    const client = await verifyClientId(clientId, config);
    if (!client) {
      return res.status(400).json({ error: 'invalid_client', error_description: 'Invalid client_id' });
    }

    let finalRedirectUri = redirectUri;
    if (!finalRedirectUri && client.redirect_uris.length === 1) {
      finalRedirectUri = client.redirect_uris[0];
    }
    if (!finalRedirectUri || !client.redirect_uris.includes(finalRedirectUri)) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Invalid or missing redirect_uri' });
    }

    const oauthState = await signOAuthState({
      client_id: clientId,
      redirect_uri: finalRedirectUri,
      code_challenge: codeChallenge,
      state,
      scope,
    }, config);

    const baseUrl = getBaseUrl(config, req);
    const callbackUrl = `${baseUrl}/api/mcp/oauth/callback`;

    // Resolve scopes: base identity scopes + server-specific scopes from definition
    const serverSlug = params.server as string | undefined;
    const serverDef = serverSlug ? config.servers.find(s => s.slug === serverSlug) : undefined;
    const serverScopes = serverDef?.auth?.scopes || [];
    const scopes = [...config.authProvider.getBaseScopes(), ...serverScopes];

    // Redirect to auth provider
    const authUrl = config.authProvider.getAuthorizationUrl(callbackUrl, oauthState, scopes);
    return res.redirect(302, authUrl);
  };
}
