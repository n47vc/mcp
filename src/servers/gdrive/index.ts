import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import { google } from 'googleapis';
import * as path from 'path';
import { Readable } from 'stream';
import { z } from 'zod';

import type { MCPUserContext, MCPServerDefinition } from '../../types';

// ---------- Input Schemas ----------

const SearchDriveSchema = z.object({
  query: z.string().min(1),
  searchMode: z.enum(['fulltext', 'name']).optional().default('fulltext'),
  fileType: z.enum(['any', 'folder', 'document', 'spreadsheet', 'presentation', 'pdf']).optional().default('any'),
  maxResults: z.number().int().positive().max(50).optional().default(20),
  driveId: z.string().optional(),
  folderId: z.string().optional(),
});

const ReadSlidesSchema = z.object({
  presentationId: z.string().min(1),
});

const ReadDocSchema = z.object({
  documentId: z.string().min(1),
});

const ReadSheetSchema = z.object({
  spreadsheetId: z.string().min(1),
  sheetName: z.string().optional(),
});

const ReadPdfSchema = z.object({
  fileId: z.string().min(1),
  maxPages: z.number().int().positive().max(100).optional().default(50),
});

const ReadTextSchema = z.object({
  fileId: z.string().min(1),
});

const ReadImageSchema = z.object({
  fileId: z.string().min(1),
});

const UploadFileSchema = z.object({
  filePath: z.string().min(1),
  folderId: z.string().min(1),
  fileName: z.string().optional(),
  convertToGoogleFormat: z.boolean().optional().default(false),
});

const AppendDocSchema = z.object({
  documentId: z.string().min(1),
  content: z.string().min(1),
});

const CreateDocSchema = z.object({
  title: z.string().min(1),
  folderId: z.string().optional(),
  content: z.string().optional(),
});

const CreateFolderSchema = z.object({
  name: z.string().min(1),
  parentFolderId: z.string().optional(),
});

const MoveFileSchema = z.object({
  fileId: z.string().min(1),
  destinationFolderId: z.string().min(1),
});

// ---------- Google Auth ----------

function getGoogleAuth(providerAccessToken?: string) {
  if (providerAccessToken) {
    // Use the authenticated user's OAuth token
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: providerAccessToken });
    return oauth2Client;
  }

  // Fallback to service account
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    throw new Error('No Google credentials available. Please re-authenticate via OAuth.');
  }
  const serviceAccount = JSON.parse(
    Buffer.from(serviceAccountJson, 'base64').toString('utf-8')
  );
  return new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/presentations.readonly',
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
  });
}

// ---------- MIME Type → Readability Mapping ----------

const READABLE_MIME_TYPES: Record<string, { tool: string; note: string }> = {
  // Google native formats
  'application/vnd.google-apps.presentation': { tool: 'gdrive_read_slides', note: 'Google Slides' },
  'application/vnd.google-apps.document': { tool: 'gdrive_read_doc', note: 'Google Doc' },
  'application/vnd.google-apps.spreadsheet': { tool: 'gdrive_read_sheet', note: 'Google Sheet' },

  // PDF
  'application/pdf': { tool: 'gdrive_read_pdf', note: 'PDF' },

  // Office formats → converted via Google
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { tool: 'gdrive_read_slides', note: 'PowerPoint (.pptx) — converted to Slides' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { tool: 'gdrive_read_doc', note: 'Word (.docx) — converted to Doc' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { tool: 'gdrive_read_sheet', note: 'Excel (.xlsx) — converted to Sheet' },
  'application/msword': { tool: 'gdrive_read_doc', note: 'Word (.doc) — converted to Doc' },
  'application/vnd.ms-excel': { tool: 'gdrive_read_sheet', note: 'Excel (.xls) — converted to Sheet' },
  'application/vnd.ms-powerpoint': { tool: 'gdrive_read_slides', note: 'PowerPoint (.ppt) — converted to Slides' },
  'application/rtf': { tool: 'gdrive_read_doc', note: 'RTF — converted to Doc' },

  // OpenDocument formats → converted via Google
  'application/vnd.oasis.opendocument.text': { tool: 'gdrive_read_doc', note: 'OpenDocument Text (.odt) — converted to Doc' },
  'application/vnd.oasis.opendocument.spreadsheet': { tool: 'gdrive_read_sheet', note: 'OpenDocument Spreadsheet (.ods) — converted to Sheet' },
  'application/vnd.oasis.opendocument.presentation': { tool: 'gdrive_read_slides', note: 'OpenDocument Presentation (.odp) — converted to Slides' },

  // CSV/TSV → converted to Sheet
  'text/csv': { tool: 'gdrive_read_sheet', note: 'CSV — converted to Sheet' },
  'text/tab-separated-values': { tool: 'gdrive_read_sheet', note: 'TSV — converted to Sheet' },

  // Plain text formats → download as text
  'text/plain': { tool: 'gdrive_read_text', note: 'Text file' },
  'text/markdown': { tool: 'gdrive_read_text', note: 'Markdown file' },
  'text/html': { tool: 'gdrive_read_text', note: 'HTML file' },
  'text/xml': { tool: 'gdrive_read_text', note: 'XML file' },
  'application/json': { tool: 'gdrive_read_text', note: 'JSON file' },
  'application/xml': { tool: 'gdrive_read_text', note: 'XML file' },
  'text/css': { tool: 'gdrive_read_text', note: 'CSS file' },
  'application/javascript': { tool: 'gdrive_read_text', note: 'JavaScript file' },
  'application/x-yaml': { tool: 'gdrive_read_text', note: 'YAML file' },

  // Image formats → download as image
  'image/jpeg': { tool: 'gdrive_read_image', note: 'JPEG image' },
  'image/png': { tool: 'gdrive_read_image', note: 'PNG image' },
  'image/gif': { tool: 'gdrive_read_image', note: 'GIF image' },
  'image/webp': { tool: 'gdrive_read_image', note: 'WebP image' },
  'image/svg+xml': { tool: 'gdrive_read_text', note: 'SVG image (XML text)' },
};

// MIME types that can be converted to a Google native format for reading
const DOC_CONVERTIBLE = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/rtf',
  'application/vnd.oasis.opendocument.text',
]);

const SHEET_CONVERTIBLE = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'text/tab-separated-values',
  'application/vnd.oasis.opendocument.spreadsheet',
]);

const SLIDES_CONVERTIBLE = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument.presentation',
]);

// File extension → MIME type mapping for uploads
const EXTENSION_MIME_TYPES: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.md': 'text/markdown',
  '.rtf': 'application/rtf',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.zip': 'application/zip',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.yaml': 'application/x-yaml',
  '.yml': 'application/x-yaml',
};

// Source MIME → Google native MIME for import conversion on upload
const GOOGLE_CONVERSION_MIME: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.google-apps.document',
  'application/msword': 'application/vnd.google-apps.document',
  'application/rtf': 'application/vnd.google-apps.document',
  'application/vnd.oasis.opendocument.text': 'application/vnd.google-apps.document',
  'text/plain': 'application/vnd.google-apps.document',
  'text/html': 'application/vnd.google-apps.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/vnd.google-apps.spreadsheet',
  'application/vnd.ms-excel': 'application/vnd.google-apps.spreadsheet',
  'text/csv': 'application/vnd.google-apps.spreadsheet',
  'text/tab-separated-values': 'application/vnd.google-apps.spreadsheet',
  'application/vnd.oasis.opendocument.spreadsheet': 'application/vnd.google-apps.spreadsheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'application/vnd.google-apps.presentation',
  'application/vnd.ms-powerpoint': 'application/vnd.google-apps.presentation',
  'application/vnd.oasis.opendocument.presentation': 'application/vnd.google-apps.presentation',
};

// ---------- Drive Search ----------

interface DriveFileResult {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  modifiedTime: string;
  owners: string[];
  driveId: string | null;
  readable: boolean;
  readTool: string | null;
  readNote: string | null;
}

const FILE_TYPE_MIME: Record<string, string> = {
  folder: 'application/vnd.google-apps.folder',
  document: 'application/vnd.google-apps.document',
  spreadsheet: 'application/vnd.google-apps.spreadsheet',
  presentation: 'application/vnd.google-apps.presentation',
  pdf: 'application/pdf',
};

async function searchDriveFiles(
  query: string,
  options: { searchMode?: 'fulltext' | 'name'; fileType?: string; maxResults?: number; driveId?: string; folderId?: string; providerAccessToken?: string } = {}
): Promise<DriveFileResult[]> {
  const auth = getGoogleAuth(options.providerAccessToken);
  const drive = google.drive({ version: 'v3', auth });
  const maxResults = options.maxResults || 20;
  const escapedQuery = query.replace(/'/g, "\\'");

  let q = options.searchMode === 'name'
    ? `name contains '${escapedQuery}' and trashed = false`
    : `fullText contains '${escapedQuery}' and trashed = false`;
  if (options.fileType && options.fileType !== 'any' && FILE_TYPE_MIME[options.fileType]) {
    q += ` and mimeType = '${FILE_TYPE_MIME[options.fileType]}'`;
  }
  if (options.folderId) {
    q += ` and '${options.folderId.replace(/'/g, "\\'")}' in parents`;
  }

  const results: DriveFileResult[] = [];
  let pageToken: string | undefined;

  do {
    const listParams: any = {
      q,
      fields: 'nextPageToken, files(id, name, mimeType, webViewLink, modifiedTime, owners, driveId)',
      pageSize: Math.min(maxResults - results.length, 100),
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      orderBy: 'modifiedTime desc',
    };

    // Scope to a specific shared drive if provided
    if (options.driveId) {
      listParams.driveId = options.driveId;
      listParams.corpora = 'drive';
    }

    const res: any = await drive.files.list(listParams);

    for (const file of res.data.files || []) {
      if (!file.id || !file.name) continue;
      const mime = file.mimeType || 'unknown';
      const readInfo = READABLE_MIME_TYPES[mime];
      results.push({
        id: file.id,
        name: file.name,
        mimeType: mime,
        webViewLink: file.webViewLink || '',
        modifiedTime: file.modifiedTime || '',
        owners: file.owners?.map((o: any) => o.displayName || o.emailAddress) || [],
        driveId: file.driveId || null,
        readable: !!readInfo,
        readTool: readInfo?.tool ?? null,
        readNote: readInfo?.note ?? null,
      });
    }

    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken && results.length < maxResults);

  return results.slice(0, maxResults);
}

// ---------- Shared Drives ----------

interface SharedDriveResult {
  id: string;
  name: string;
}

async function listSharedDrives(
  providerAccessToken?: string
): Promise<SharedDriveResult[]> {
  const auth = getGoogleAuth(providerAccessToken);
  const drive = google.drive({ version: 'v3', auth });

  const results: SharedDriveResult[] = [];
  let pageToken: string | undefined;

  do {
    const res: any = await drive.drives.list({
      pageSize: 100,
      pageToken,
      fields: 'nextPageToken, drives(id, name)',
    });

    for (const d of res.data.drives || []) {
      if (d.id && d.name) {
        results.push({ id: d.id, name: d.name });
      }
    }

    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return results;
}

// ---------- Folder Listing ----------

const ListFolderSchema = z.object({
  folderId: z.string().min(1),
  recursive: z.boolean().optional().default(false),
  maxDepth: z.number().int().positive().max(10).optional().default(4),
  maxResults: z.number().int().positive().max(500).optional().default(50),
});

interface FolderEntry {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  isFolder: boolean;
  webViewLink: string;
  modifiedTime: string;
  driveId: string | null;
  readable: boolean;
  readTool: string | null;
  readNote: string | null;
  children?: FolderEntry[];
  truncated?: boolean;
}

interface ListFolderResult {
  entries: FolderEntry[];
  totalFiles: number;
  truncatedAtDepth: boolean;
}

async function listFolderDirect(
  folderId: string,
  drive: any,
  maxResults: number,
): Promise<FolderEntry[]> {
  const q = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`;

  const results: FolderEntry[] = [];
  let pageToken: string | undefined;

  do {
    const res: any = await drive.files.list({
      q,
      fields: 'nextPageToken, files(id, name, mimeType, webViewLink, modifiedTime, driveId)',
      pageSize: Math.min(maxResults - results.length, 100),
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      orderBy: 'folder,name',
    });

    for (const file of res.data.files || []) {
      if (!file.id || !file.name) continue;
      const mime = file.mimeType || 'unknown';
      const isFolder = mime === 'application/vnd.google-apps.folder';
      const readInfo = READABLE_MIME_TYPES[mime];
      results.push({
        id: file.id,
        name: file.name,
        path: file.name,
        mimeType: mime,
        isFolder,
        webViewLink: file.webViewLink || '',
        modifiedTime: file.modifiedTime || '',
        driveId: file.driveId || null,
        readable: isFolder || !!readInfo,
        readTool: isFolder ? 'gdrive_list_folder' : (readInfo?.tool ?? null),
        readNote: isFolder ? 'Folder — use gdrive_list_folder to browse' : (readInfo?.note ?? null),
      });
    }

    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken && results.length < maxResults);

  return results.slice(0, maxResults);
}

async function listFolderRecursive(
  folderId: string,
  drive: any,
  parentPath: string,
  currentDepth: number,
  maxDepth: number,
  maxResults: number,
  state: { totalFiles: number; truncatedAtDepth: boolean },
): Promise<FolderEntry[]> {
  const entries = await listFolderDirect(folderId, drive, maxResults);

  for (const entry of entries) {
    entry.path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    if (!entry.isFolder) {
      state.totalFiles++;
    }
  }

  const folders = entries.filter(e => e.isFolder);
  for (const folder of folders) {
    if (currentDepth >= maxDepth) {
      folder.truncated = true;
      folder.readNote = `Folder not expanded — max depth (${maxDepth}) reached. Use gdrive_list_folder with this folder's ID to browse deeper.`;
      state.truncatedAtDepth = true;
    } else {
      folder.children = await listFolderRecursive(
        folder.id,
        drive,
        folder.path,
        currentDepth + 1,
        maxDepth,
        maxResults,
        state,
      );
    }
  }

  return entries;
}

async function listFolder(
  folderId: string,
  options: { recursive?: boolean; maxDepth?: number; maxResults?: number; providerAccessToken?: string } = {}
): Promise<ListFolderResult> {
  const auth = getGoogleAuth(options.providerAccessToken);
  const drive = google.drive({ version: 'v3', auth });
  const maxResults = options.maxResults || 50;

  if (options.recursive) {
    const maxDepth = options.maxDepth || 4;
    const state = { totalFiles: 0, truncatedAtDepth: false };
    const entries = await listFolderRecursive(folderId, drive, '', 1, maxDepth, maxResults, state);
    return { entries, totalFiles: state.totalFiles, truncatedAtDepth: state.truncatedAtDepth };
  }

  const entries = await listFolderDirect(folderId, drive, maxResults);
  const totalFiles = entries.filter(e => !e.isFolder).length;
  return { entries, totalFiles, truncatedAtDepth: false };
}

// ---------- Slides: Screenshot each slide ----------

interface SlideImage {
  slideIndex: number;
  base64: string;
}

interface PresentationScreenshots {
  title: string;
  slideCount: number;
  slides: SlideImage[];
}

async function readSlidesAsImages(presentationId: string, providerAccessToken?: string): Promise<PresentationScreenshots> {
  const auth = getGoogleAuth(providerAccessToken);
  const slides = google.slides({ version: 'v1', auth });

  const presentation = await slides.presentations.get({ presentationId });
  const title = presentation.data.title || 'Untitled Presentation';
  const pageSlides = presentation.data.slides || [];

  const slideImages: SlideImage[] = [];

  for (let index = 0; index < pageSlides.length; index++) {
    const slide = pageSlides[index];
    const pageObjectId = slide.objectId;
    if (!pageObjectId) continue;

    const thumbnail = await slides.presentations.pages.getThumbnail({
      presentationId,
      pageObjectId,
      'thumbnailProperties.thumbnailSize': 'LARGE',
      'thumbnailProperties.mimeType': 'PNG',
    });

    const contentUrl = thumbnail.data.contentUrl;
    if (!contentUrl) continue;

    // Fetch the image and convert to base64
    const imageResponse = await fetch(contentUrl);
    const arrayBuffer = await imageResponse.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    slideImages.push({
      slideIndex: index + 1,
      base64,
    });
  }

  return { title, slideCount: pageSlides.length, slides: slideImages };
}

// ---------- Docs: Extract text ----------

function extractTextFromDocElement(element: any): string {
  if (element.paragraph) {
    return (element.paragraph.elements || [])
      .map((e: any) => e.textRun?.content || '')
      .join('');
  }
  if (element.table) {
    const rows: string[] = [];
    for (const row of element.table.tableRows || []) {
      const cells: string[] = [];
      for (const cell of row.tableCells || []) {
        const cellText = (cell.content || [])
          .map((c: any) => extractTextFromDocElement(c))
          .join('')
          .trim();
        if (cellText) cells.push(cellText);
      }
      if (cells.length > 0) rows.push(cells.join(' | '));
    }
    return rows.join('\n') + '\n';
  }
  if (element.sectionBreak) return '';
  if (element.tableOfContents) {
    return (element.tableOfContents.content || [])
      .map((c: any) => extractTextFromDocElement(c))
      .join('');
  }
  return '';
}

async function readDocument(documentId: string, providerAccessToken?: string): Promise<{ title: string; text: string }> {
  const auth = getGoogleAuth(providerAccessToken);
  const docs = google.docs({ version: 'v1', auth });

  const doc = await docs.documents.get({ documentId });
  const title = doc.data.title || 'Untitled Document';
  const body = doc.data.body;

  if (!body?.content) {
    return { title, text: '' };
  }

  const text = body.content
    .map((element: any) => extractTextFromDocElement(element))
    .join('');

  return { title, text };
}

// ---------- Sheets: Read data ----------

interface SheetData {
  title: string;
  sheetName: string;
  sheetNames: string[];
  headers: string[];
  rows: string[][];
  rowCount: number;
}

async function readSpreadsheet(spreadsheetId: string, sheetName?: string, providerAccessToken?: string): Promise<SheetData> {
  const auth = getGoogleAuth(providerAccessToken);
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'properties(title),sheets(properties(title))',
  });

  const title = meta.data.properties?.title || 'Untitled Spreadsheet';
  const sheetNames = (meta.data.sheets || [])
    .map((s: any) => s.properties?.title)
    .filter(Boolean) as string[];

  const targetSheet = sheetName || sheetNames[0] || 'Sheet1';

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${targetSheet}'!A:AZ`,
  });

  const allRows = response.data.values || [];
  const headers = allRows.length > 0 ? allRows[0].map(String) : [];
  const dataRows = allRows.slice(1).map(row => row.map(String));

  return {
    title,
    sheetName: targetSheet,
    sheetNames,
    headers,
    rows: dataRows,
    rowCount: dataRows.length,
  };
}

// ---------- Drive File Helpers ----------

async function getFileMimeType(
  fileId: string,
  providerAccessToken?: string
): Promise<{ mimeType: string; name: string }> {
  const auth = getGoogleAuth(providerAccessToken);
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.get({ fileId, fields: 'mimeType, name', supportsAllDrives: true });
  return { mimeType: res.data.mimeType || 'unknown', name: res.data.name || 'unknown' };
}

async function downloadDriveFileAsBuffer(
  fileId: string,
  providerAccessToken?: string
): Promise<Buffer> {
  const auth = getGoogleAuth(providerAccessToken);
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data as ArrayBuffer);
}

async function copyAndConvertFile(
  fileId: string,
  targetMimeType: string,
  providerAccessToken?: string
): Promise<string> {
  const auth = getGoogleAuth(providerAccessToken);
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.copy({
    fileId,
    supportsAllDrives: true,
    requestBody: { mimeType: targetMimeType },
  });
  if (!res.data.id) throw new Error('Failed to create converted copy');
  return res.data.id;
}

async function deleteDriveFile(
  fileId: string,
  providerAccessToken?: string
): Promise<void> {
  const auth = getGoogleAuth(providerAccessToken);
  const drive = google.drive({ version: 'v3', auth });
  await drive.files.delete({ fileId, supportsAllDrives: true });
}

// ---------- PDF: Render pages as images ----------

interface PdfPageImage {
  pageIndex: number;
  base64: string;
}

async function readPdfAsImages(
  fileId: string,
  maxPages: number,
  providerAccessToken?: string
): Promise<{ name: string; pageCount: number; pages: PdfPageImage[] }> {
  const { PDFDocument } = await import('pdf-lib');
  const { fromBuffer } = await import('pdf2pic');

  const { name } = await getFileMimeType(fileId, providerAccessToken);
  const pdfBuffer = await downloadDriveFileAsBuffer(fileId, providerAccessToken);

  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const pageCount = pdfDoc.getPageCount();
  const pagesToRender = Math.min(pageCount, maxPages);

  const pages: PdfPageImage[] = [];
  const convert = fromBuffer(pdfBuffer, {
    density: 200,
    format: 'png',
    width: 1600,
    height: 1600,
    preserveAspectRatio: true,
  });

  for (let i = 1; i <= pagesToRender; i++) {
    const result = await convert(i, { responseType: 'base64' });
    if (result.base64) {
      pages.push({ pageIndex: i, base64: result.base64 });
    }
  }

  return { name, pageCount, pages };
}

// ---------- Text & Image File Readers ----------

async function readTextFile(
  fileId: string,
  providerAccessToken?: string
): Promise<{ name: string; text: string; mimeType: string }> {
  const { name, mimeType } = await getFileMimeType(fileId, providerAccessToken);
  const buffer = await downloadDriveFileAsBuffer(fileId, providerAccessToken);
  const text = buffer.toString('utf-8');
  return { name, text, mimeType };
}

async function readImageFile(
  fileId: string,
  providerAccessToken?: string
): Promise<{ name: string; base64: string; mimeType: string }> {
  const { name, mimeType } = await getFileMimeType(fileId, providerAccessToken);
  const buffer = await downloadDriveFileAsBuffer(fileId, providerAccessToken);
  const base64 = buffer.toString('base64');
  return { name, base64, mimeType };
}

// ---------- Write Operations ----------

async function uploadFile(
  filePath: string,
  folderId: string,
  fileName?: string,
  convertToGoogleFormat?: boolean,
  providerAccessToken?: string
): Promise<{ id: string; name: string; mimeType: string; webViewLink: string }> {
  const auth = getGoogleAuth(providerAccessToken);
  const drive = google.drive({ version: 'v3', auth });

  const resolvedName = fileName || path.basename(filePath);
  const ext = path.extname(resolvedName).toLowerCase();
  const mimeType = EXTENSION_MIME_TYPES[ext] || 'application/octet-stream';

  const requestBody: any = {
    name: resolvedName,
    parents: [folderId],
  };

  if (convertToGoogleFormat && GOOGLE_CONVERSION_MIME[mimeType]) {
    requestBody.mimeType = GOOGLE_CONVERSION_MIME[mimeType];
  }

  const res = await drive.files.create({
    requestBody,
    media: {
      mimeType,
      body: fs.createReadStream(filePath),
    },
    supportsAllDrives: true,
    fields: 'id, name, mimeType, webViewLink',
  });

  return {
    id: res.data.id || '',
    name: res.data.name || resolvedName,
    mimeType: res.data.mimeType || mimeType,
    webViewLink: res.data.webViewLink || '',
  };
}

async function appendToGoogleDoc(
  documentId: string,
  content: string,
  providerAccessToken?: string
): Promise<void> {
  const auth = getGoogleAuth(providerAccessToken);
  const docs = google.docs({ version: 'v1', auth });

  const doc = await docs.documents.get({ documentId });
  const body = doc.data.body;
  if (!body?.content?.length) throw new Error('Document body is empty or inaccessible');

  const lastElement = body.content[body.content.length - 1];
  const endIndex = lastElement.endIndex || 1;

  const textToInsert = '\n' + content;

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [{
        insertText: {
          location: { index: endIndex - 1 },
          text: textToInsert,
        },
      }],
    },
  });
}

async function appendToTextFile(
  fileId: string,
  content: string,
  providerAccessToken?: string
): Promise<void> {
  const auth = getGoogleAuth(providerAccessToken);
  const drive = google.drive({ version: 'v3', auth });

  // Download current content
  const buffer = await downloadDriveFileAsBuffer(fileId, providerAccessToken);
  const existing = buffer.toString('utf-8');

  // Append with a newline separator
  const updated = existing + '\n' + content;

  // Re-upload the updated content
  const { mimeType } = await getFileMimeType(fileId, providerAccessToken);
  await drive.files.update({
    fileId,
    supportsAllDrives: true,
    media: {
      mimeType,
      body: Readable.from([updated]),
    },
  });
}

// Text-based MIME types that support download+append+re-upload
const TEXT_APPENDABLE = new Set([
  'text/plain',
  'text/markdown',
  'text/html',
  'text/xml',
  'text/css',
  'text/csv',
  'text/tab-separated-values',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-yaml',
]);

async function appendToFile(
  fileId: string,
  content: string,
  providerAccessToken?: string
): Promise<{ fileId: string; appendedLength: number; method: string }> {
  const { mimeType } = await getFileMimeType(fileId, providerAccessToken);

  if (mimeType === 'application/vnd.google-apps.document') {
    await appendToGoogleDoc(fileId, content, providerAccessToken);
    return { fileId, appendedLength: content.length, method: 'google-docs-api' };
  }

  if (TEXT_APPENDABLE.has(mimeType)) {
    await appendToTextFile(fileId, content, providerAccessToken);
    return { fileId, appendedLength: content.length, method: 'download-append-reupload' };
  }

  throw new Error(
    `Cannot append to file with MIME type "${mimeType}". ` +
    'Supported types: Google Docs, and text-based files (.txt, .md, .json, .xml, .html, .css, .csv, .yaml, etc.).'
  );
}

async function createDocument(
  title: string,
  folderId?: string,
  content?: string,
  providerAccessToken?: string
): Promise<{ id: string; name: string; mimeType: string; webViewLink: string }> {
  const auth = getGoogleAuth(providerAccessToken);
  const drive = google.drive({ version: 'v3', auth });

  const requestBody: any = {
    name: title,
    mimeType: 'application/vnd.google-apps.document',
  };
  if (folderId) {
    requestBody.parents = [folderId];
  }

  // If content is provided, upload as text/plain and let Google convert to Doc
  const media = content ? {
    mimeType: 'text/plain',
    body: Readable.from([content]),
  } : undefined;

  const res = await drive.files.create({
    requestBody,
    ...(media ? { media } : {}),
    supportsAllDrives: true,
    fields: 'id, name, mimeType, webViewLink',
  });

  return {
    id: res.data.id || '',
    name: res.data.name || title,
    mimeType: res.data.mimeType || 'application/vnd.google-apps.document',
    webViewLink: res.data.webViewLink || '',
  };
}

async function createDriveFolder(
  name: string,
  parentFolderId?: string,
  providerAccessToken?: string
): Promise<{ id: string; name: string; webViewLink: string }> {
  const auth = getGoogleAuth(providerAccessToken);
  const drive = google.drive({ version: 'v3', auth });

  const requestBody: any = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentFolderId) {
    requestBody.parents = [parentFolderId];
  }

  const res = await drive.files.create({
    requestBody,
    supportsAllDrives: true,
    fields: 'id, name, webViewLink',
  });

  return {
    id: res.data.id || '',
    name: res.data.name || name,
    webViewLink: res.data.webViewLink || '',
  };
}

async function moveFile(
  fileId: string,
  destinationFolderId: string,
  providerAccessToken?: string
): Promise<{ id: string; name: string; webViewLink: string; destinationFolderId: string }> {
  const auth = getGoogleAuth(providerAccessToken);
  const drive = google.drive({ version: 'v3', auth });

  // Get current parents to remove them
  const file = await drive.files.get({
    fileId,
    fields: 'parents, name',
    supportsAllDrives: true,
  });

  const previousParents = (file.data.parents || []).join(',');

  const res = await drive.files.update({
    fileId,
    addParents: destinationFolderId,
    removeParents: previousParents,
    supportsAllDrives: true,
    fields: 'id, name, parents, webViewLink',
  });

  return {
    id: res.data.id || fileId,
    name: res.data.name || '',
    webViewLink: res.data.webViewLink || '',
    destinationFolderId,
  };
}

// ---------- ID Extraction Helpers ----------

function extractIdFromUrl(url: string, pattern: RegExp): string {
  const match = url.match(pattern);
  return match ? match[1] : url;
}

// ---------- Server Factory ----------

export function createGDriveServer(context?: MCPUserContext): Server {
  const providerAccessToken = context?.provider_access_token;
  const server = new Server(
    { name: 'google-drive', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'gdrive_search',
        description:
          'Search Google Drive for files. Returns file names, IDs, types, links, and modification dates. ' +
          'Returns ALL file types — each result includes a "readable" flag and ' +
          '"readTool" indicating which tool can open it (gdrive_read_slides, gdrive_read_doc, gdrive_read_sheet, gdrive_read_pdf, gdrive_read_text, gdrive_read_image), ' +
          'or null if the file type is not yet supported for reading. ' +
          'Two search modes: "fulltext" (default) searches inside file contents and names — best for finding files about a topic. ' +
          '"name" searches only file names — best when you know the file name or part of it, and faster than fulltext. ' +
          'By default searches across all drives (personal and shared). Use driveId to scope search to a specific shared drive ' +
          '(use gdrive_list_shared_drives to find drive IDs). Use folderId to search only within a specific folder.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: {
              type: 'string' as const,
              description: 'Search query string',
            },
            searchMode: {
              type: 'string' as const,
              enum: ['fulltext', 'name'],
              description: 'Search mode: "fulltext" (default) searches file contents and names — use for topic/keyword searches. "name" searches only file names — use when you know the file name or part of it.',
              default: 'fulltext',
            },
            fileType: {
              type: 'string' as const,
              enum: ['any', 'folder', 'document', 'spreadsheet', 'presentation', 'pdf'],
              description: 'Filter by file type. Use "folder" to find folders by name, then use gdrive_list_folder to browse their contents. Default: "any" (all types).',
              default: 'any',
            },
            maxResults: {
              type: 'number' as const,
              description: 'Maximum number of results (default 20, max 50)',
              default: 20,
            },
            driveId: {
              type: 'string' as const,
              description: 'Optional: ID of a shared drive to search within. Use gdrive_list_shared_drives to find available drive IDs.',
            },
            folderId: {
              type: 'string' as const,
              description: 'Optional: ID of a folder to search within. Only returns files that are direct children of this folder.',
            },
          },
          required: ['query'],
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'gdrive_list_shared_drives',
        description:
          'List all shared drives (Team Drives) the user has access to. Returns drive IDs and names. ' +
          'Use this to discover available shared drives, then pass a driveId to gdrive_search to search within a specific shared drive.',
        inputSchema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'gdrive_list_folder',
        description:
          'List the contents of a Google Drive folder. Returns all files and subfolders with their IDs, names, types, and links. ' +
          'Set recursive=true to automatically traverse subfolders and return a nested tree with full paths — ' +
          'much faster than manually listing each subfolder. Recursion stops at maxDepth (default 4); ' +
          'folders beyond the depth limit are marked with truncated=true. ' +
          'To browse a shared drive root, pass the shared drive ID as the folderId. ' +
          'Typical workflow: gdrive_list_shared_drives → gdrive_list_folder (drive root, recursive=true) → read files.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            folderId: {
              type: 'string' as const,
              description: 'ID of the folder to list. Can be a folder ID or a shared drive ID (to list the drive root).',
            },
            recursive: {
              type: 'boolean' as const,
              description: 'If true, recursively list all subfolders and return a nested tree with full paths. Default: false.',
              default: false,
            },
            maxDepth: {
              type: 'number' as const,
              description: 'Maximum folder depth to recurse into when recursive=true. Default: 4, max: 10.',
              default: 4,
            },
            maxResults: {
              type: 'number' as const,
              description: 'Maximum number of items per folder level (default 50, max 500)',
              default: 50,
            },
          },
          required: ['folderId'],
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'gdrive_read_slides',
        description:
          'Read a Google Slides presentation or uploaded PowerPoint (.pptx/.ppt) or OpenDocument (.odp) file by capturing a screenshot of each slide as an image. ' +
          'Returns the presentation title and one PNG image per slide. This captures all visual content including ' +
          'charts, diagrams, images, and text formatting. For non-native formats, a temporary Google Slides copy is created and deleted after reading. ' +
          'Use gdrive_search first to find presentation IDs, or extract the ID from a Google Slides URL (the string between /d/ and /edit).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            presentationId: {
              type: 'string' as const,
              description: 'Google Slides presentation ID, uploaded .pptx/.ppt/.odp file ID, or full URL',
            },
          },
          required: ['presentationId'],
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'gdrive_read_doc',
        description:
          'Read the text content of a Google Doc or uploaded Word (.docx/.doc), RTF, or OpenDocument (.odt) file. Extracts all text including paragraphs, tables, and lists. ' +
          'For non-native formats, a temporary Google Docs copy is created and deleted after reading. ' +
          'Use gdrive_search first to find document IDs, or extract the ID from a Google Docs URL.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            documentId: {
              type: 'string' as const,
              description: 'Google Docs document ID, uploaded .docx/.doc/.rtf/.odt file ID, or full URL',
            },
          },
          required: ['documentId'],
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'gdrive_read_sheet',
        description:
          'Read data from a Google Sheet or uploaded Excel (.xlsx/.xls), CSV, TSV, or OpenDocument (.ods) file. ' +
          'Returns headers and rows from a specific sheet tab (or the first tab by default). ' +
          'Also returns the list of all sheet tab names. For non-native formats, a temporary Google Sheets copy is created and deleted after reading. ' +
          'Use gdrive_search first to find spreadsheet IDs.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            spreadsheetId: {
              type: 'string' as const,
              description: 'Google Sheets spreadsheet ID, uploaded .xlsx/.xls/.csv/.tsv/.ods file ID, or full URL',
            },
            sheetName: {
              type: 'string' as const,
              description: 'Optional: specific sheet tab name to read (defaults to first sheet)',
            },
          },
          required: ['spreadsheetId'],
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'gdrive_read_pdf',
        description:
          'Read a PDF file from Google Drive by rendering each page as a PNG image. ' +
          'Returns the file name, page count, and one image per page. Use gdrive_search first to find the file ID.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            fileId: {
              type: 'string' as const,
              description: 'Google Drive file ID of the PDF',
            },
            maxPages: {
              type: 'number' as const,
              description: 'Maximum number of pages to render (default 50, max 100)',
              default: 50,
            },
          },
          required: ['fileId'],
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'gdrive_read_text',
        description:
          'Read a plain text file from Google Drive. Works with .txt, .md, .json, .xml, .html, .css, .js, .yaml, .svg, and other text-based formats. ' +
          'Downloads the raw file content and returns it as UTF-8 text. Use gdrive_search first to find the file ID.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            fileId: {
              type: 'string' as const,
              description: 'Google Drive file ID of the text file',
            },
          },
          required: ['fileId'],
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'gdrive_read_image',
        description:
          'Read an image file from Google Drive. Supports JPEG, PNG, GIF, and WebP formats. ' +
          'Downloads the file and returns it as a base64-encoded image. Use gdrive_search first to find the file ID.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            fileId: {
              type: 'string' as const,
              description: 'Google Drive file ID of the image',
            },
          },
          required: ['fileId'],
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      {
        name: 'gdrive_upload_file',
        description:
          'Upload a local file to a specific Google Drive folder. Supports any file type including .docx, .pdf, .xlsx, .pptx, .csv, .txt, images, etc. ' +
          'Set convertToGoogleFormat=true to convert Office files to Google native format on upload ' +
          '(e.g., .docx → Google Doc, .xlsx → Google Sheet, .pptx → Google Slides, .csv → Google Sheet). ' +
          'Note: Markdown (.md) files are NOT natively convertible by Google Drive — upload as .md or convert to HTML first.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            filePath: {
              type: 'string' as const,
              description: 'Absolute path to the local file to upload',
            },
            folderId: {
              type: 'string' as const,
              description: 'Google Drive folder ID to upload the file into',
            },
            fileName: {
              type: 'string' as const,
              description: 'Optional: override the file name in Drive (defaults to the local file name)',
            },
            convertToGoogleFormat: {
              type: 'boolean' as const,
              description: 'If true, convert to Google native format on upload (e.g., .docx → Google Doc). Default: false.',
              default: false,
            },
          },
          required: ['filePath', 'folderId'],
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      {
        name: 'gdrive_append_doc',
        description:
          'Append text content to the end of an existing Google Doc or plain text file (.txt, .md, .json, .xml, .html, .csv, .yaml, etc.). ' +
          'For Google Docs, uses the Docs API to insert text (plain text only, no formatting). ' +
          'For plain text files (including markdown), downloads the file, appends content, and re-uploads. ' +
          'A newline separator is automatically added before the appended content. ' +
          'Use gdrive_search to find the file ID first.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            documentId: {
              type: 'string' as const,
              description: 'Google Doc ID, plain text file ID, or full Google Docs URL',
            },
            content: {
              type: 'string' as const,
              description: 'Text content to append to the end of the file',
            },
          },
          required: ['documentId', 'content'],
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      {
        name: 'gdrive_create_doc',
        description:
          'Create a new Google Doc with optional initial content. The document is created as a native Google Doc. ' +
          'If content is provided, it is inserted as plain text. Optionally specify a folderId to create the doc in a specific folder.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            title: {
              type: 'string' as const,
              description: 'Title of the new Google Doc',
            },
            folderId: {
              type: 'string' as const,
              description: 'Optional: Google Drive folder ID to create the doc in (defaults to root)',
            },
            content: {
              type: 'string' as const,
              description: 'Optional: initial plain text content for the document',
            },
          },
          required: ['title'],
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      {
        name: 'gdrive_create_folder',
        description:
          'Create a new folder in Google Drive. Optionally specify a parent folder ID to create it as a subfolder.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            name: {
              type: 'string' as const,
              description: 'Name of the new folder',
            },
            parentFolderId: {
              type: 'string' as const,
              description: 'Optional: parent folder ID to create this folder inside (defaults to root)',
            },
          },
          required: ['name'],
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      {
        name: 'gdrive_move_file',
        description:
          'Move a file or folder to a different folder in Google Drive. ' +
          'Removes the file from its current parent folder(s) and places it in the destination folder.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            fileId: {
              type: 'string' as const,
              description: 'Google Drive file or folder ID to move',
            },
            destinationFolderId: {
              type: 'string' as const,
              description: 'Google Drive folder ID to move the file into',
            },
          },
          required: ['fileId', 'destinationFolderId'],
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'gdrive_search': {
          const input = SearchDriveSchema.parse(args);
          const results = await searchDriveFiles(input.query, {
            searchMode: input.searchMode,
            fileType: input.fileType,
            maxResults: input.maxResults,
            driveId: input.driveId,
            folderId: input.folderId,
            providerAccessToken,
          });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                query: input.query,
                ...(input.driveId ? { driveId: input.driveId } : {}),
                ...(input.folderId ? { folderId: input.folderId } : {}),
                count: results.length,
                files: results,
              }, null, 2),
            }],
          };
        }

        case 'gdrive_list_shared_drives': {
          const drives = await listSharedDrives(providerAccessToken);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                count: drives.length,
                drives,
              }, null, 2),
            }],
          };
        }

        case 'gdrive_list_folder': {
          const input = ListFolderSchema.parse(args);
          const result = await listFolder(input.folderId, {
            recursive: input.recursive,
            maxDepth: input.maxDepth,
            maxResults: input.maxResults,
            providerAccessToken,
          });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                folderId: input.folderId,
                recursive: input.recursive,
                totalFiles: result.totalFiles,
                count: result.entries.length,
                ...(result.truncatedAtDepth ? {
                  warning: `Some subfolders were not expanded because the maximum depth of ${input.maxDepth} was reached. Use gdrive_list_folder on the truncated folders to browse deeper.`,
                } : {}),
                entries: result.entries,
              }, null, 2),
            }],
          };
        }

        case 'gdrive_read_slides': {
          const input = ReadSlidesSchema.parse(args);
          let fileId = extractIdFromUrl(
            input.presentationId,
            /\/presentation\/d\/([a-zA-Z0-9_-]+)/
          );

          // Check if this is a non-native format that needs conversion
          const { mimeType } = await getFileMimeType(fileId, providerAccessToken);
          const needsConversion = SLIDES_CONVERTIBLE.has(mimeType);
          let tempCopyId: string | undefined;

          if (needsConversion) {
            tempCopyId = await copyAndConvertFile(
              fileId,
              'application/vnd.google-apps.presentation',
              providerAccessToken
            );
            fileId = tempCopyId;
          }

          try {
            const result = await readSlidesAsImages(fileId, providerAccessToken);

            const content: any[] = [
              { type: 'text', text: `Presentation: ${result.title} (${result.slideCount} slides)${needsConversion ? ' [converted from uploaded file]' : ''}` },
            ];

            for (const slide of result.slides) {
              content.push(
                { type: 'text', text: `--- Slide ${slide.slideIndex} ---` },
                { type: 'image', data: slide.base64, mimeType: 'image/png' },
              );
            }

            return { content };
          } finally {
            if (tempCopyId) {
              await deleteDriveFile(tempCopyId, providerAccessToken).catch((err) => {
                console.error('[GDrive MCP] Failed to delete temp slides copy:', err);
              });
            }
          }
        }

        case 'gdrive_read_doc': {
          const input = ReadDocSchema.parse(args);
          let fileId = extractIdFromUrl(
            input.documentId,
            /\/document\/d\/([a-zA-Z0-9_-]+)/
          );

          // Check if this is a non-native format that needs conversion
          const { mimeType } = await getFileMimeType(fileId, providerAccessToken);
          const needsConversion = DOC_CONVERTIBLE.has(mimeType);
          let tempCopyId: string | undefined;

          if (needsConversion) {
            tempCopyId = await copyAndConvertFile(
              fileId,
              'application/vnd.google-apps.document',
              providerAccessToken
            );
            fileId = tempCopyId;
          }

          try {
            const result = await readDocument(fileId, providerAccessToken);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  title: result.title,
                  text: result.text,
                  ...(needsConversion ? { note: 'Converted from uploaded file' } : {}),
                }, null, 2),
              }],
            };
          } finally {
            if (tempCopyId) {
              await deleteDriveFile(tempCopyId, providerAccessToken).catch((err) => {
                console.error('[GDrive MCP] Failed to delete temp doc copy:', err);
              });
            }
          }
        }

        case 'gdrive_read_sheet': {
          const input = ReadSheetSchema.parse(args);
          let spreadsheetId = extractIdFromUrl(
            input.spreadsheetId,
            /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/
          );

          // Check if this is a non-native format that needs conversion
          const { mimeType } = await getFileMimeType(spreadsheetId, providerAccessToken);
          const needsConversion = SHEET_CONVERTIBLE.has(mimeType);
          let tempCopyId: string | undefined;

          if (needsConversion) {
            tempCopyId = await copyAndConvertFile(
              spreadsheetId,
              'application/vnd.google-apps.spreadsheet',
              providerAccessToken
            );
            spreadsheetId = tempCopyId;
          }

          try {
            const result = await readSpreadsheet(spreadsheetId, input.sheetName, providerAccessToken);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  ...result,
                  ...(needsConversion ? { note: 'Converted from uploaded file' } : {}),
                }, null, 2),
              }],
            };
          } finally {
            if (tempCopyId) {
              await deleteDriveFile(tempCopyId, providerAccessToken).catch((err) => {
                console.error('[GDrive MCP] Failed to delete temp sheet copy:', err);
              });
            }
          }
        }

        case 'gdrive_read_pdf': {
          const input = ReadPdfSchema.parse(args);
          const result = await readPdfAsImages(input.fileId, input.maxPages, providerAccessToken);

          const content: any[] = [
            { type: 'text', text: `PDF: ${result.name} (${result.pageCount} pages${result.pageCount > input.maxPages ? `, showing first ${input.maxPages}` : ''})` },
          ];

          for (const page of result.pages) {
            content.push(
              { type: 'text', text: `--- Page ${page.pageIndex} ---` },
              { type: 'image', data: page.base64, mimeType: 'image/png' },
            );
          }

          return { content };
        }

        case 'gdrive_read_text': {
          const input = ReadTextSchema.parse(args);
          const result = await readTextFile(input.fileId, providerAccessToken);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                name: result.name,
                mimeType: result.mimeType,
                text: result.text,
              }, null, 2),
            }],
          };
        }

        case 'gdrive_read_image': {
          const input = ReadImageSchema.parse(args);
          const result = await readImageFile(input.fileId, providerAccessToken);

          // Map MIME type to a supported image type for the MCP response
          const imageMime = result.mimeType.startsWith('image/') ? result.mimeType : 'image/png';

          return {
            content: [
              { type: 'text', text: `Image: ${result.name} (${result.mimeType})` },
              { type: 'image', data: result.base64, mimeType: imageMime },
            ],
          };
        }

        case 'gdrive_upload_file': {
          const input = UploadFileSchema.parse(args);

          // Verify the file exists before attempting upload
          if (!fs.existsSync(input.filePath)) {
            throw new Error(`File not found: ${input.filePath}`);
          }

          const result = await uploadFile(
            input.filePath,
            input.folderId,
            input.fileName,
            input.convertToGoogleFormat,
            providerAccessToken
          );

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                ...result,
                converted: input.convertToGoogleFormat,
              }, null, 2),
            }],
          };
        }

        case 'gdrive_append_doc': {
          const input = AppendDocSchema.parse(args);
          const fileId = extractIdFromUrl(
            input.documentId,
            /\/document\/d\/([a-zA-Z0-9_-]+)/
          );

          const result = await appendToFile(fileId, input.content, providerAccessToken);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                ...result,
              }, null, 2),
            }],
          };
        }

        case 'gdrive_create_doc': {
          const input = CreateDocSchema.parse(args);
          const result = await createDocument(
            input.title,
            input.folderId,
            input.content,
            providerAccessToken
          );

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                ...result,
              }, null, 2),
            }],
          };
        }

        case 'gdrive_create_folder': {
          const input = CreateFolderSchema.parse(args);
          const result = await createDriveFolder(
            input.name,
            input.parentFolderId,
            providerAccessToken
          );

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                ...result,
              }, null, 2),
            }],
          };
        }

        case 'gdrive_move_file': {
          const input = MoveFileSchema.parse(args);
          const result = await moveFile(
            input.fileId,
            input.destinationFolderId,
            providerAccessToken
          );

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                ...result,
              }, null, 2),
            }],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
        isError: true,
      };
    }
  });

  return server;
}

export const gdrive: MCPServerDefinition = {
  slug: 'gdrive',
  name: 'Google Drive MCP Server',
  createServer: createGDriveServer,
  auth: {
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/presentations.readonly',
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
  },
};

export default gdrive;
