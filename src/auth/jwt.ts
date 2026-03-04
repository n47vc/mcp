import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import type { MCPAppConfig } from '../types';

const MCP_ISSUER = 'n47-mcp';

function getSigningKey(config: MCPAppConfig): Uint8Array {
  return new TextEncoder().encode(config.secret);
}

// ---------- AES-256-GCM Encryption ----------

function getEncryptionKey(config: MCPAppConfig): Buffer {
  return createHash('sha256').update(`encrypt:${config.secret}`).digest();
}

function encryptToken(plaintext: string, config: MCPAppConfig): string {
  const key = getEncryptionKey(config);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString('base64url');
}

function decryptToken(ciphertext: string, config: MCPAppConfig): string {
  const key = getEncryptionKey(config);
  const data = Buffer.from(ciphertext, 'base64url');
  const iv = data.subarray(0, 12);
  const tag = data.subarray(data.length - 16);
  const encrypted = data.subarray(12, data.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function encryptOptional(value: string | undefined, config: MCPAppConfig): string | undefined {
  return value ? encryptToken(value, config) : undefined;
}

function decryptOptional(value: string | undefined, config: MCPAppConfig): string | undefined {
  if (!value) return undefined;
  try {
    return decryptToken(value, config);
  } catch {
    return undefined;
  }
}

// ---------- Client Registration ----------

interface ClientPayload {
  redirect_uris: string[];
  client_name?: string;
}

export async function signClientId(payload: ClientPayload, config: MCPAppConfig): Promise<string> {
  return new SignJWT({
    type: 'mcp_client',
    redirect_uris: payload.redirect_uris,
    client_name: payload.client_name,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(MCP_ISSUER)
    .setExpirationTime('365d')
    .sign(getSigningKey(config));
}

export async function verifyClientId(token: string, config: MCPAppConfig): Promise<ClientPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(config), { issuer: MCP_ISSUER });
    if (payload.type !== 'mcp_client') return null;
    return {
      redirect_uris: payload.redirect_uris as string[],
      client_name: payload.client_name as string | undefined,
    };
  } catch {
    return null;
  }
}

// ---------- OAuth State ----------

interface OAuthStatePayload {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state?: string;
  scope?: string;
}

export async function signOAuthState(payload: OAuthStatePayload, config: MCPAppConfig): Promise<string> {
  return new SignJWT({
    type: 'oauth_state',
    ...payload,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(MCP_ISSUER)
    .setExpirationTime('10m')
    .sign(getSigningKey(config));
}

export async function verifyOAuthState(token: string, config: MCPAppConfig): Promise<OAuthStatePayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(config), { issuer: MCP_ISSUER });
    if (payload.type !== 'oauth_state') return null;
    return {
      client_id: payload.client_id as string,
      redirect_uri: payload.redirect_uri as string,
      code_challenge: payload.code_challenge as string,
      state: payload.state as string | undefined,
      scope: payload.scope as string | undefined,
    };
  } catch {
    return null;
  }
}

// ---------- Auth Code ----------

interface AuthCodePayload {
  email: string;
  name: string;
  client_id: string;
  code_challenge: string;
  redirect_uri: string;
  provider_refresh_token?: string;
}

export async function signAuthCode(payload: AuthCodePayload, config: MCPAppConfig): Promise<string> {
  return new SignJWT({
    type: 'auth_code',
    email: payload.email,
    name: payload.name,
    client_id: payload.client_id,
    code_challenge: payload.code_challenge,
    redirect_uri: payload.redirect_uri,
    prt: encryptOptional(payload.provider_refresh_token, config),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(MCP_ISSUER)
    .setExpirationTime('5m')
    .sign(getSigningKey(config));
}

export async function verifyAuthCode(token: string, config: MCPAppConfig): Promise<AuthCodePayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(config), { issuer: MCP_ISSUER });
    if (payload.type !== 'auth_code') return null;
    return {
      email: payload.email as string,
      name: payload.name as string,
      client_id: payload.client_id as string,
      code_challenge: payload.code_challenge as string,
      redirect_uri: payload.redirect_uri as string,
      provider_refresh_token: decryptOptional(payload.prt as string | undefined, config),
    };
  } catch {
    return null;
  }
}

// ---------- Access Token ----------

interface AccessTokenPayload {
  email: string;
  name: string;
  scopes: string[];
  provider_access_token?: string;
}

export async function signAccessToken(payload: AccessTokenPayload, config: MCPAppConfig): Promise<string> {
  return new SignJWT({
    type: 'access',
    email: payload.email,
    name: payload.name,
    scopes: payload.scopes,
    pat: encryptOptional(payload.provider_access_token, config),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(MCP_ISSUER)
    .setExpirationTime('1h')
    .sign(getSigningKey(config));
}

export async function verifyAccessToken(token: string, config: MCPAppConfig): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(config), { issuer: MCP_ISSUER });
    if (payload.type !== 'access') return null;
    const email = payload.email as string;
    if (!email) return null;
    if (config.allowedDomain && !email.endsWith(`@${config.allowedDomain}`)) return null;
    return {
      email,
      name: (payload.name as string) || email,
      scopes: (payload.scopes as string[]) || [],
      provider_access_token: decryptOptional(payload.pat as string | undefined, config),
    };
  } catch {
    return null;
  }
}

// ---------- Refresh Token ----------

interface RefreshTokenPayload {
  email: string;
  name: string;
  provider_refresh_token?: string;
}

export async function signRefreshToken(payload: RefreshTokenPayload, config: MCPAppConfig): Promise<string> {
  return new SignJWT({
    type: 'refresh',
    email: payload.email,
    name: payload.name,
    prt: encryptOptional(payload.provider_refresh_token, config),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(MCP_ISSUER)
    .setExpirationTime('90d')
    .sign(getSigningKey(config));
}

export async function verifyRefreshToken(token: string, config: MCPAppConfig): Promise<RefreshTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(config), { issuer: MCP_ISSUER });
    if (payload.type !== 'refresh') return null;
    const email = payload.email as string;
    if (!email) return null;
    if (config.allowedDomain && !email.endsWith(`@${config.allowedDomain}`)) return null;
    return {
      email,
      name: (payload.name as string) || email,
      provider_refresh_token: decryptOptional(payload.prt as string | undefined, config),
    };
  } catch {
    return null;
  }
}

// ---------- PKCE ----------

export function verifyPKCE(codeVerifier: string, codeChallenge: string): boolean {
  const hash = createHash('sha256').update(codeVerifier).digest('base64url');
  const normalizedHash = hash.replace(/=+$/, '');
  const normalizedChallenge = codeChallenge.replace(/=+$/, '');
  return normalizedHash === normalizedChallenge;
}

export function generateRandomString(length = 32): string {
  return randomBytes(length).toString('base64url');
}

// ---------- Base URL ----------

export function getBaseUrl(config: MCPAppConfig, req?: { headers: { host?: string; 'x-forwarded-proto'?: string } }): string {
  if (config.baseUrl) return config.baseUrl;
  if (req) {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    return `${proto}://${req.headers.host}`;
  }
  return 'http://localhost:3000';
}
