export interface AuthProviderTokens {
  /** Provider-specific access token */
  access_token?: string;
  /** Provider-specific refresh token */
  refresh_token?: string;
  /** User's email from the provider */
  email: string;
  /** User's display name */
  name: string;
}

export interface AuthProviderConfig {
  /** Unique identifier (e.g., 'google', 'microsoft', 'github') */
  id: string;
  /** Human-readable name */
  name: string;

  /**
   * Build the authorization URL to redirect the user's browser to.
   */
  getAuthorizationUrl(
    callbackUrl: string,
    state: string,
    scopes: string[],
    options?: Record<string, string>
  ): string;

  /**
   * Exchange the authorization code for tokens.
   */
  exchangeCode(
    code: string,
    callbackUrl: string
  ): Promise<AuthProviderTokens>;

  /**
   * Refresh an expired access token using a refresh token.
   */
  refreshAccessToken(
    refreshToken: string
  ): Promise<{ access_token: string } | undefined>;

  /**
   * Get the scopes needed for a given server slug.
   * Should always include base identity scopes.
   */
  getScopesForServer(serverSlug?: string): string[];
}
