import type { MCPAppConfig } from '../types';
import { verifyOAuthState, signAuthCode, getBaseUrl } from '../auth/jwt';
import { AuthError, ProviderError } from '../errors';

export function createCallbackHandler(config: MCPAppConfig) {
  return async function handler(req: any, res: any) {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    const code = req.query.code as string;
    const stateParam = req.query.state as string;
    const error = req.query.error as string;

    if (error) {
      res.setHeader('Content-Type', 'text/plain');
      return res.status(400).send(`OAuth error: ${error}`);
    }

    if (!code || !stateParam) {
      const err = new AuthError('invalid_request', 'Missing code or state parameter');
      return res.status(err.statusCode).json(err.toJSON());
    }

    const oauthState = await verifyOAuthState(stateParam, config);
    if (!oauthState) {
      const err = new AuthError('invalid_request', 'Invalid or expired state parameter');
      return res.status(err.statusCode).json(err.toJSON());
    }

    const baseUrl = getBaseUrl(config, req);
    const callbackUrl = `${baseUrl}/api/mcp/oauth/callback`;

    try {
      const tokens = await config.authProvider.exchangeCode(code, callbackUrl);

      // Domain validation
      if (config.allowedDomain && !tokens.email.endsWith(`@${config.allowedDomain}`)) {
        const redirectUrl = new URL(oauthState.redirect_uri);
        redirectUrl.searchParams.set('error', 'access_denied');
        redirectUrl.searchParams.set('error_description', `Only @${config.allowedDomain} accounts are allowed`);
        if (oauthState.state) redirectUrl.searchParams.set('state', oauthState.state);
        return res.redirect(302, redirectUrl.toString());
      }

      const authCode = await signAuthCode({
        email: tokens.email,
        name: tokens.name,
        client_id: oauthState.client_id,
        code_challenge: oauthState.code_challenge,
        redirect_uri: oauthState.redirect_uri,
        scope: oauthState.scope,
        provider_access_token: tokens.access_token,
        provider_refresh_token: tokens.refresh_token,
      }, config);

      const redirectUrl = new URL(oauthState.redirect_uri);
      redirectUrl.searchParams.set('code', authCode);
      if (oauthState.state) redirectUrl.searchParams.set('state', oauthState.state);
      return res.redirect(302, redirectUrl.toString());
    } catch (err) {
      const providerErr = new ProviderError(err instanceof Error ? err.message : String(err));
      console.error('[MCP OAuth Callback]', providerErr);
      return res.status(providerErr.statusCode).json(providerErr.toJSON());
    }
  };
}
