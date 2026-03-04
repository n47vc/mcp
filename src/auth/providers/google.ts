import type { AuthProviderConfig, AuthProviderTokens } from './index';

export interface GoogleAuthProviderOptions {
  clientId: string;
  clientSecret: string;
  /** Restrict to this email domain (e.g., 'mycompany.com') */
  allowedDomain?: string;
  /** Additional OAuth scopes per server slug */
  serverScopes?: Record<string, string[]>;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

const BASE_SCOPES = ['openid', 'email', 'profile'];

export function createGoogleAuthProvider(options: GoogleAuthProviderOptions): AuthProviderConfig {
  return {
    id: 'google',
    name: 'Google',

    getAuthorizationUrl(callbackUrl: string, state: string, scopes: string[]): string {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', options.clientId);
      url.searchParams.set('redirect_uri', callbackUrl);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', scopes.join(' '));
      url.searchParams.set('state', state);
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent');
      if (options.allowedDomain) {
        url.searchParams.set('hd', options.allowedDomain);
      }
      return url.toString();
    },

    async exchangeCode(code: string, callbackUrl: string): Promise<AuthProviderTokens> {
      const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: options.clientId,
          client_secret: options.clientSecret,
          redirect_uri: callbackUrl,
          grant_type: 'authorization_code',
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Google token exchange failed: ${err}`);
      }

      const tokens = await resp.json() as GoogleTokenResponse;

      // Decode ID token for user info
      const idToken = tokens.id_token;
      if (!idToken) {
        throw new Error('Google did not return an ID token');
      }
      const payloadSegment = idToken.split('.')[1];
      const payload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString());

      const email = payload.email as string;
      const name = (payload.name as string) || email;

      if (!email || !payload.email_verified) {
        throw new Error('Google account email is not verified');
      }

      // Domain validation
      if (options.allowedDomain && !email.endsWith(`@${options.allowedDomain}`)) {
        throw new Error(`Only @${options.allowedDomain} accounts are allowed`);
      }

      return {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        email,
        name,
      };
    },

    async refreshAccessToken(refreshToken: string): Promise<{ access_token: string } | undefined> {
      const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!resp.ok) return undefined;

      const tokens = await resp.json() as GoogleTokenResponse;
      return { access_token: tokens.access_token };
    },

    getScopesForServer(serverSlug?: string): string[] {
      const extra = serverSlug && options.serverScopes?.[serverSlug]
        ? options.serverScopes[serverSlug]
        : [];
      return [...BASE_SCOPES, ...extra];
    },
  };
}
