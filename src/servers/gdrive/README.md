# Google Drive MCP Server

Search, read, and manage files in Google Drive. Supports Docs, Sheets, Slides, PDFs, images, and plain text files. Part of [@n47vc/mcp](../../README.md).

## Setup

Requires Google OAuth with Drive scopes. Add to your `createGoogleAuthProvider` config:

```typescript
serverScopes: {
  gdrive: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/presentations.readonly',
  ],
}
```

Enable these APIs in your Google Cloud Console project:
- Google Drive API
- Google Docs API
- Google Sheets API
- Google Slides API

No additional environment variables required beyond the base Google OAuth credentials.

## Tools

### `gdrive_search`
Search for files across Google Drive (including shared drives).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | `string` | Yes | Search query |
| `searchMode` | `'fulltext' \| 'name'` | No | Search file contents or names only (default: `fulltext`) |
| `fileType` | `'any' \| 'folder' \| 'document' \| 'spreadsheet' \| 'presentation' \| 'pdf'` | No | Filter by type |
| `maxResults` | `number` | No | Max results (default 20, max 50) |
| `driveId` | `string` | No | Restrict to a specific shared drive |
| `folderId` | `string` | No | Restrict to a specific folder |

### `gdrive_list_shared_drives`
List all shared drives accessible to the user.

### `gdrive_list_folder`
List contents of a folder.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `folderId` | `string` | Yes | Folder ID |
| `maxResults` | `number` | No | Max results (default 50, max 100) |

### `gdrive_read_slides`
Read all text content from a Google Slides presentation.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `presentationId` | `string` | Yes | Presentation ID |

### `gdrive_read_doc`
Read full text content from a Google Doc.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `documentId` | `string` | Yes | Document ID |

### `gdrive_read_sheet`
Read data from a Google Sheet.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `spreadsheetId` | `string` | Yes | Spreadsheet ID |
| `sheetName` | `string` | No | Specific sheet tab name (default: first sheet) |

### `gdrive_read_pdf`
Read a PDF file, converting pages to images for visual analysis.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fileId` | `string` | Yes | Drive file ID |
| `maxPages` | `number` | No | Max pages to read (default 50, max 100) |

### `gdrive_read_text`
Read plain text files (txt, markdown, HTML, JSON, XML, etc.).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fileId` | `string` | Yes | Drive file ID |

### `gdrive_read_image`
Read an image file from Drive (returned as base64).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fileId` | `string` | Yes | Drive file ID |

### `gdrive_upload_file`
Upload a local file to a Drive folder.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filePath` | `string` | Yes | Local file path to upload |
| `folderId` | `string` | Yes | Destination folder ID |
| `fileName` | `string` | No | Override file name |
| `convertToGoogleFormat` | `boolean` | No | Convert to Google Docs/Sheets/Slides (default: false) |

### `gdrive_append_doc`
Append text content to an existing Google Doc.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `documentId` | `string` | Yes | Document ID |
| `content` | `string` | Yes | Text to append |

### `gdrive_create_doc`
Create a new Google Doc, optionally in a specific folder with initial content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | `string` | Yes | Document title |
| `folderId` | `string` | No | Parent folder ID |
| `content` | `string` | No | Initial text content |

### `gdrive_create_folder`
Create a new folder in Google Drive.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | Yes | Folder name |
| `parentFolderId` | `string` | No | Parent folder ID |

### `gdrive_move_file`
Move a file to a different folder.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fileId` | `string` | Yes | File ID to move |
| `destinationFolderId` | `string` | Yes | Destination folder ID |
