import { jwtVerify } from 'jose';
import { createHash, createDecipheriv } from 'crypto';
import { google } from 'googleapis';
import { Readable } from 'stream';
import type { MCPAppConfig } from './types';

// MIME type map — same as in gdrive server
const EXTENSION_MIME_TYPES: Record<string, string> = {
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.rtf': 'application/rtf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.yaml': 'application/x-yaml',
  '.yml': 'application/x-yaml',
};

const GOOGLE_CONVERSION_MIME: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.google-apps.document',
  'application/msword': 'application/vnd.google-apps.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/vnd.google-apps.spreadsheet',
  'application/vnd.ms-excel': 'application/vnd.google-apps.spreadsheet',
  'text/csv': 'application/vnd.google-apps.spreadsheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'application/vnd.google-apps.presentation',
  'application/vnd.ms-powerpoint': 'application/vnd.google-apps.presentation',
};

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

export function createGDriveUploadHandler(config: MCPAppConfig) {
  return async function handler(req: any, res: any) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Extract Bearer token
    const authHeader = req.headers?.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing Authorization header' });
    }

    const token = authHeader.slice(7);
    const secret = config.secret;
    const signingKey = new TextEncoder().encode(secret);

    // Verify the upload JWT
    let payload: any;
    try {
      const result = await jwtVerify(token, signingKey, { issuer: 'n47-mcp' });
      payload = result.payload;
    } catch {
      return res.status(401).json({ error: 'Invalid or expired upload token' });
    }

    if (payload.type !== 'gdrive_upload') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    // Decrypt the provider access token
    if (!payload.pat) {
      return res.status(400).json({ error: 'Missing provider token in upload token' });
    }

    let providerAccessToken: string;
    try {
      providerAccessToken = decryptToken(payload.pat, secret);
    } catch {
      return res.status(400).json({ error: 'Failed to decrypt provider token' });
    }

    // Read the request body as a buffer
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', resolve);
      req.on('error', reject);
    });
    const fileBuffer = Buffer.concat(chunks);

    if (fileBuffer.length === 0) {
      return res.status(400).json({ error: 'Empty request body — no file data received' });
    }

    // Determine MIME type
    const fileName: string = payload.fileName;
    const ext = fileName.includes('.') ? '.' + fileName.split('.').pop()!.toLowerCase() : '';
    const mimeType: string = payload.mimeType || EXTENSION_MIME_TYPES[ext] || 'application/octet-stream';
    const convert: boolean = payload.convert || false;
    const folderId: string = payload.folderId;

    // Upload to Google Drive
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: providerAccessToken });
    const drive = google.drive({ version: 'v3', auth });

    const requestBody: any = {
      name: fileName,
      parents: [folderId],
    };

    if (convert && GOOGLE_CONVERSION_MIME[mimeType]) {
      requestBody.mimeType = GOOGLE_CONVERSION_MIME[mimeType];
    }

    try {
      const uploadRes = await drive.files.create({
        requestBody,
        media: {
          mimeType,
          body: Readable.from(fileBuffer),
        },
        supportsAllDrives: true,
        fields: 'id, name, mimeType, webViewLink',
      });

      return res.status(200).json({
        success: true,
        id: uploadRes.data.id || '',
        name: uploadRes.data.name || fileName,
        mimeType: uploadRes.data.mimeType || mimeType,
        webViewLink: uploadRes.data.webViewLink || '',
        converted: convert,
      });
    } catch (err: any) {
      const message = err?.message || 'Upload to Google Drive failed';
      return res.status(502).json({ error: message });
    }
  };
}
