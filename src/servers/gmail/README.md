# Gmail MCP Server

Read, search, and compose emails via Gmail. Part of [@n47vc/mcp](../../README.md).

## Setup

Requires Google OAuth with Gmail scopes. These scopes are declared automatically by the server definition — just include `gmail` in your `servers` array.

Enable the **Gmail API** in your Google Cloud Console project.

No additional environment variables required beyond the base Google OAuth credentials.

## Tools

### `gmail_who_am_i`
Get the authenticated user's Gmail profile (email, name, message/thread counts).

### `gmail_list_threads`
List email threads. Supports Gmail search syntax.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | `string` | No | Gmail search query (e.g., `"from:user@example.com"`, `"is:unread"`, `"newer_than:7d"`) |
| `labelIds` | `string[]` | No | Filter by label (e.g., `["INBOX"]`, `["SENT"]`) |
| `maxResults` | `number` | No | Max threads to return (default 20, max 100) |

### `gmail_get_thread`
Get full contents of a thread — all messages with headers, snippet, and plain text body.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `threadId` | `string` | Yes | Thread ID from `gmail_list_threads` |

### `gmail_list_emails`
List individual emails with full content. For conversations, prefer `gmail_get_thread`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | `string` | No | Gmail search query |
| `labelIds` | `string[]` | No | Filter by label |
| `maxResults` | `number` | No | Max emails to return (default 20, max 50) |

### `gmail_write_draft`
Compose a new email draft (saved to Drafts folder).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `to` | `string` | Yes | Recipient(s), comma-separated |
| `subject` | `string` | Yes | Subject line |
| `body` | `string` | Yes | Plain text body |
| `cc` | `string` | No | CC recipients |
| `bcc` | `string` | No | BCC recipients |

### `gmail_write_draft_reply`
Compose a draft reply to an existing message (threaded).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `messageId` | `string` | Yes | Message ID to reply to |
| `body` | `string` | Yes | Reply body (plain text) |
| `to` | `string` | No | Override reply-to address |
| `cc` | `string` | No | CC recipients |
| `bcc` | `string` | No | BCC recipients |

### `gmail_send_internal_email`
Send an email directly, restricted to internal recipients only (same domain). All to, cc, and bcc addresses must belong to the internal domain. The internal domain is determined by the `allowedDomain` config, or derived from the authenticated user's email.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `to` | `string` | Yes | Recipient(s), must be internal |
| `subject` | `string` | Yes | Subject line |
| `body` | `string` | Yes | Plain text body |
| `cc` | `string` | No | CC recipients, must be internal |
| `bcc` | `string` | No | BCC recipients, must be internal |
