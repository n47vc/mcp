import type { MCPAppConfig } from '../types';
import { signClientId, generateRandomString } from '../auth/jwt';

export function createRegisterHandler(config: MCPAppConfig) {
  return async function handler(req: any, res: any) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    try {
      const body = req.body;
      const redirectUris = body.redirect_uris;
      if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
        return res.status(400).json({
          error: 'invalid_client_metadata',
          error_description: 'redirect_uris is required',
        });
      }

      const clientId = await signClientId({ redirect_uris: redirectUris, client_name: body.client_name }, config);
      const clientSecret = generateRandomString(48);
      const now = Math.floor(Date.now() / 1000);

      return res.status(201).json({
        client_id: clientId,
        client_secret: clientSecret,
        client_id_issued_at: now,
        client_secret_expires_at: now + 365 * 24 * 60 * 60,
        redirect_uris: redirectUris,
        token_endpoint_auth_method: body.token_endpoint_auth_method || 'client_secret_post',
        grant_types: body.grant_types || ['authorization_code', 'refresh_token'],
        response_types: body.response_types || ['code'],
        client_name: body.client_name,
        scope: body.scope,
      });
    } catch (error) {
      console.error('[MCP OAuth Register] Error:', error);
      return res.status(500).json({ error: 'server_error', error_description: 'Internal server error' });
    }
  };
}
