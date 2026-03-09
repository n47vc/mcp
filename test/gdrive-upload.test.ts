import { describe, it, expect, vi } from 'vitest';
import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { createGDriveUploadHandler } from '../src/gdrive-upload';
import type { MCPAppConfig } from '../src/types';

const TEST_SECRET = 'test-secret-that-is-long-enough-for-hmac';

function makeConfig(overrides: Partial<MCPAppConfig> = {}): MCPAppConfig {
  return {
    secret: TEST_SECRET,
    authProvider: {
      id: 'test', name: 'Test',
      getAuthorizationUrl: () => '',
      exchangeCode: async () => ({ email: '', name: '', access_token: '', refresh_token: '' }),
      refreshAccessToken: async () => ({ access_token: '' }),
      getBaseScopes: () => [],
    },
    servers: [],
    ...overrides,
  };
}

function mockRes() {
  const res: any = { statusCode: 0, body: null, headers: {} as Record<string, string> };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (data: any) => { res.body = data; return res; };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  return res;
}

/** Encrypt a provider token the same way the gdrive server does */
function encryptForUpload(plaintext: string, secret: string): string {
  const key = createHash('sha256').update(`encrypt:${secret}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString('base64url');
}

/** Decrypt a provider token the same way the upload endpoint does */
function decryptToken(ciphertext: string, secret: string): string {
  const key = createHash('sha256').update(`encrypt:${secret}`).digest();
  const data = Buffer.from(ciphertext, 'base64url');
  const iv = data.subarray(0, 12);
  const tag = data.subarray(data.length - 16);
  const encrypted = data.subarray(12, data.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/** Create a valid upload JWT matching what the gdrive server produces */
async function mintUploadToken(secret: string, overrides: Record<string, any> = {}) {
  const signingKey = new TextEncoder().encode(secret);
  const pat = encryptForUpload('google-oauth-token-123', secret);
  return new SignJWT({
    type: 'gdrive_upload',
    sid: 'test-session-id',
    fileName: 'report.pdf',
    folderId: 'folder-abc',
    mimeType: 'application/pdf',
    convert: false,
    pat,
    ...overrides,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('n47-mcp')
    .setExpirationTime('10m')
    .sign(signingKey);
}

function mockReqWithBody(token: string, body: Buffer = Buffer.from('file-content')) {
  const listeners: Record<string, Function[]> = {};
  return {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    on(event: string, cb: Function) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
      // Simulate streaming body immediately
      if (event === 'data') setTimeout(() => cb(body), 0);
      if (event === 'end') setTimeout(() => cb(), 1);
      return this;
    },
  };
}

// ─── Encryption round-trip ───────────────────────────────────────────

describe('upload token encryption round-trip', () => {
  it('encrypts and decrypts a provider token with the same secret', () => {
    const original = 'ya29.a0AfH6SMBx-some-google-token';
    const encrypted = encryptForUpload(original, TEST_SECRET);
    const decrypted = decryptToken(encrypted, TEST_SECRET);
    expect(decrypted).toBe(original);
  });

  it('fails to decrypt with a different secret', () => {
    const encrypted = encryptForUpload('my-token', TEST_SECRET);
    expect(() => decryptToken(encrypted, 'wrong-secret-that-is-also-long')).toThrow();
  });

  it('produces different ciphertexts for the same input (random IV)', () => {
    const a = encryptForUpload('same-token', TEST_SECRET);
    const b = encryptForUpload('same-token', TEST_SECRET);
    expect(a).not.toBe(b);
    // But both decrypt to the same value
    expect(decryptToken(a, TEST_SECRET)).toBe('same-token');
    expect(decryptToken(b, TEST_SECRET)).toBe('same-token');
  });
});

// ─── JWT minting & verification ──────────────────────────────────────

describe('upload JWT round-trip', () => {
  it('mints a JWT that can be verified with the same secret', async () => {
    const token = await mintUploadToken(TEST_SECRET);
    const signingKey = new TextEncoder().encode(TEST_SECRET);
    const { payload } = await jwtVerify(token, signingKey, { issuer: 'n47-mcp' });

    expect(payload.type).toBe('gdrive_upload');
    expect(payload.fileName).toBe('report.pdf');
    expect(payload.folderId).toBe('folder-abc');
    expect(payload.pat).toBeDefined();
  });

  it('rejects a JWT signed with a different secret', async () => {
    const token = await mintUploadToken('different-secret-long-enough');
    const signingKey = new TextEncoder().encode(TEST_SECRET);
    await expect(jwtVerify(token, signingKey, { issuer: 'n47-mcp' })).rejects.toThrow();
  });

  it('the encrypted pat in the JWT decrypts to the original token', async () => {
    const token = await mintUploadToken(TEST_SECRET);
    const signingKey = new TextEncoder().encode(TEST_SECRET);
    const { payload } = await jwtVerify(token, signingKey, { issuer: 'n47-mcp' });
    const decrypted = decryptToken(payload.pat as string, TEST_SECRET);
    expect(decrypted).toBe('google-oauth-token-123');
  });

  it('secret mismatch between sign and decrypt causes failure', async () => {
    // Simulate the bug: sign JWT with secret A, try to decrypt pat with secret B
    const signSecret = 'secret-A-that-is-long-enough-for-hmac';
    const decryptSecret = 'secret-B-that-is-long-enough-for-hmac';

    // JWT is signed with signSecret, pat is encrypted with signSecret
    const token = await mintUploadToken(signSecret);

    // Even if we could verify the JWT (we can't with wrong key), decryption would fail
    const signingKey = new TextEncoder().encode(signSecret);
    const { payload } = await jwtVerify(token, signingKey, { issuer: 'n47-mcp' });

    // Decrypting with a different secret should fail
    expect(() => decryptToken(payload.pat as string, decryptSecret)).toThrow();
  });
});

// ─── Upload endpoint handler ─────────────────────────────────────────

describe('createGDriveUploadHandler', () => {
  it('rejects non-POST methods', async () => {
    const handler = createGDriveUploadHandler(makeConfig());
    const res = mockRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it('rejects missing Authorization header', async () => {
    const handler = createGDriveUploadHandler(makeConfig());
    const res = mockRes();
    await handler({ method: 'POST', headers: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toContain('Missing');
  });

  it('rejects invalid JWT token', async () => {
    const handler = createGDriveUploadHandler(makeConfig());
    const res = mockRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer garbage-token' } }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toContain('Invalid');
  });

  it('rejects JWT signed with wrong secret', async () => {
    const config = makeConfig();
    const token = await mintUploadToken('wrong-secret-that-is-long-enough');
    const handler = createGDriveUploadHandler(config);
    const res = mockRes();
    await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` } }, res);
    expect(res.statusCode).toBe(401);
  });

  it('rejects JWT with wrong type claim', async () => {
    const config = makeConfig();
    const token = await mintUploadToken(TEST_SECRET, { type: 'access_token' });
    const handler = createGDriveUploadHandler(config);
    const res = mockRes();
    const req = mockReqWithBody(token);
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toContain('Invalid token type');
  });

  it('rejects JWT with missing pat claim', async () => {
    const signingKey = new TextEncoder().encode(TEST_SECRET);
    const token = await new SignJWT({
      type: 'gdrive_upload',
      sid: 'test',
      fileName: 'test.pdf',
      folderId: 'folder-abc',
      // pat intentionally omitted
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('n47-mcp')
      .setExpirationTime('10m')
      .sign(signingKey);

    const handler = createGDriveUploadHandler(makeConfig());
    const res = mockRes();
    const req = mockReqWithBody(token);
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('Missing provider token');
  });

  it('rejects empty request body', async () => {
    const config = makeConfig();
    const token = await mintUploadToken(TEST_SECRET);
    const handler = createGDriveUploadHandler(config);
    const res = mockRes();
    const req = mockReqWithBody(token, Buffer.alloc(0));
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('Empty');
  });

  it('returns 502 when Google Drive API fails', async () => {
    // Mock googleapis to simulate a failure
    const { google } = await import('googleapis');
    const originalDrive = google.drive;

    // Temporarily replace google.drive
    (google as any).drive = () => ({
      files: {
        create: vi.fn().mockRejectedValue(new Error('Insufficient Permission')),
      },
    });

    try {
      const config = makeConfig();
      const token = await mintUploadToken(TEST_SECRET);
      const handler = createGDriveUploadHandler(config);
      const res = mockRes();
      const req = mockReqWithBody(token, Buffer.from('PDF file contents'));
      await handler(req, res);
      expect(res.statusCode).toBe(502);
      expect(res.body.error).toContain('Insufficient Permission');
    } finally {
      // Restore
      (google as any).drive = originalDrive;
    }
  });

  it('succeeds when Google Drive API succeeds', async () => {
    const { google } = await import('googleapis');
    const originalDrive = google.drive;

    (google as any).drive = () => ({
      files: {
        create: vi.fn().mockResolvedValue({
          data: {
            id: 'file-id-123',
            name: 'report.pdf',
            mimeType: 'application/pdf',
            webViewLink: 'https://drive.google.com/file/d/file-id-123/view',
          },
        }),
      },
    });

    try {
      const config = makeConfig();
      const token = await mintUploadToken(TEST_SECRET);
      const handler = createGDriveUploadHandler(config);
      const res = mockRes();
      const req = mockReqWithBody(token, Buffer.from('PDF file contents'));
      await handler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.id).toBe('file-id-123');
      expect(res.body.name).toBe('report.pdf');
      expect(res.body.webViewLink).toContain('drive.google.com');
    } finally {
      (google as any).drive = originalDrive;
    }
  });
});

// ─── Secret consistency (the bug we just fixed) ──────────────────────

describe('secret consistency between tool and endpoint', () => {
  it('same secret encrypts in tool and decrypts in endpoint', async () => {
    const secret = TEST_SECRET;

    // Simulate what the gdrive tool does: encrypt + sign with secret
    const providerToken = 'ya29.real-google-token';
    const encryptedPat = encryptForUpload(providerToken, secret);
    const signingKey = new TextEncoder().encode(secret);
    const jwt = await new SignJWT({
      type: 'gdrive_upload',
      pat: encryptedPat,
      fileName: 'test.txt',
      folderId: 'root',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('n47-mcp')
      .setExpirationTime('10m')
      .sign(signingKey);

    // Simulate what the upload endpoint does: verify + decrypt with same secret
    const { payload } = await jwtVerify(jwt, signingKey, { issuer: 'n47-mcp' });
    expect(payload.type).toBe('gdrive_upload');

    const decryptedToken = decryptToken(payload.pat as string, secret);
    expect(decryptedToken).toBe(providerToken);
  });

  it('mismatched secrets fail at JWT verification', async () => {
    const toolSecret = 'tool-secret-that-is-long-enough';
    const endpointSecret = 'endpoint-secret-that-is-long-enough';

    const encryptedPat = encryptForUpload('token', toolSecret);
    const jwt = await new SignJWT({ type: 'gdrive_upload', pat: encryptedPat })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('n47-mcp')
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode(toolSecret));

    // Endpoint tries to verify with its own (different) secret — should fail
    const endpointKey = new TextEncoder().encode(endpointSecret);
    await expect(jwtVerify(jwt, endpointKey, { issuer: 'n47-mcp' })).rejects.toThrow();
  });

  it('mismatched secrets fail at token decryption even if JWT somehow verifies', async () => {
    // Even if the JWT layer used the same key, encrypting with one secret
    // and decrypting with another must fail
    const encrypted = encryptForUpload('sensitive-token', 'secret-A-long-enough-for-test');
    expect(() => decryptToken(encrypted, 'secret-B-long-enough-for-test')).toThrow();
  });
});
