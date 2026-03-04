import type { MCPAppConfig } from '../types';
import { verifyOAuthState, signAuthCode, getBaseUrl } from '../auth/jwt';

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
      return res.status(400).json({ error: 'Missing code or state parameter' });
    }

    const oauthState = await verifyOAuthState(stateParam, config);
    if (!oauthState) {
      return res.status(400).json({ error: 'Invalid or expired state parameter' });
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
        provider_refresh_token: tokens.refresh_token,
      }, config);

      const redirectUrl = new URL(oauthState.redirect_uri);
      redirectUrl.searchParams.set('code', authCode);
      if (oauthState.state) redirectUrl.searchParams.set('state', oauthState.state);
      return res.redirect(302, redirectUrl.toString());
    } catch (err) {
      console.error('[MCP OAuth Callback] Error:', err);
      return res.status(500).send('Failed to exchange code with auth provider');
    }
  };
}
