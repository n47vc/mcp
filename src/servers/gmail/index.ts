import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { z } from 'zod';
import type { MCPUserContext, MCPServerDefinition } from '../../types';

// ---------- Input Schemas ----------

const WhoAmISchema = z.object({});

const ListThreadsSchema = z.object({
  query: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  maxResults: z.number().int().positive().max(100).optional().default(20),
});

const GetThreadSchema = z.object({
  threadId: z.string().min(1),
});

const ListEmailsSchema = z.object({
  query: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  maxResults: z.number().int().positive().max(50).optional().default(20),
});

const WriteDraftSchema = z.object({
  to: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  cc: z.string().optional(),
  bcc: z.string().optional(),
});

const WriteDraftReplySchema = z.object({
  messageId: z.string().min(1),
  body: z.string().min(1),
  to: z.string().optional(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
});

const SendEmailSchema = z.object({
  to: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  cc: z.string().optional(),
  bcc: z.string().optional(),
});

const ListLabelsSchema = z.object({});

const ModifyMessageLabelsSchema = z.object({
  messageId: z.string().min(1),
  addLabelIds: z.array(z.string()).optional(),
  removeLabelIds: z.array(z.string()).optional(),
});

const ModifyThreadLabelsSchema = z.object({
  threadId: z.string().min(1),
  addLabelIds: z.array(z.string()).optional(),
  removeLabelIds: z.array(z.string()).optional(),
});

// ---------- Helpers ----------

function getGoogleAuth(providerAccessToken?: string) {
  if (!providerAccessToken) {
    throw new Error('No Google credentials available. Please re-authenticate via OAuth.');
  }
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: providerAccessToken });
  return oauth2Client;
}

function getHeader(headers: { name?: string | null; value?: string | null }[], name: string): string {
  const header = headers.find(h => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value || '';
}

function getPlainTextBody(payload: any): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
      if (part.parts) {
        const nested = getPlainTextBody(part);
        if (nested) return nested;
      }
    }
  }
  return '';
}

interface RawMessageOptions {
  to: string;
  subject: string;
  body: string;
  from?: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string;
  references?: string;
}

async function batchMap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency = 5): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...await Promise.all(batch.map(fn)));
  }
  return results;
}

function mimeEncodeSubject(subject: string): string {
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;
}

function buildRawMessage(options: RawMessageOptions): string {
  const lines: string[] = [];
  if (options.from) lines.push(`From: ${options.from}`);
  lines.push(`To: ${options.to}`);
  if (options.cc) lines.push(`Cc: ${options.cc}`);
  if (options.bcc) lines.push(`Bcc: ${options.bcc}`);
  lines.push(`Subject: ${mimeEncodeSubject(options.subject)}`);
  if (options.inReplyTo) lines.push(`In-Reply-To: ${options.inReplyTo}`);
  if (options.references) lines.push(`References: ${options.references}`);
  lines.push('Content-Type: text/plain; charset=utf-8');
  lines.push('');
  lines.push(options.body);
  const raw = lines.join('\r\n');
  return Buffer.from(raw, 'utf-8').toString('base64url');
}

// ---------- Server Factory ----------

export function createGmailServer(context?: MCPUserContext): Server {
  const providerAccessToken = context?.provider_access_token;
  const server = new Server(
    { name: 'gmail', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'gmail_who_am_i',
        description: "Get the authenticated user's Gmail profile (email, name, message/thread counts).",
        inputSchema: { type: 'object' as const, properties: {} },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      {
        name: 'gmail_list_threads',
        description: 'List threads in the user\'s mailbox. Supports Gmail search syntax for filtering.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string' as const, description: 'Gmail search query' },
            labelIds: { type: 'array' as const, items: { type: 'string' as const }, description: 'Filter by label IDs' },
            maxResults: { type: 'number' as const, description: 'Maximum threads to return (default 20, max 100)', default: 20 },
          },
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      {
        name: 'gmail_get_thread',
        description: 'Get the full contents of a specific thread by ID.',
        inputSchema: {
          type: 'object' as const,
          properties: { threadId: { type: 'string' as const, description: 'Gmail thread ID' } },
          required: ['threadId'],
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      {
        name: 'gmail_list_emails',
        description: 'List emails with full content. For conversations, prefer gmail_get_thread.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string' as const, description: 'Gmail search query' },
            labelIds: { type: 'array' as const, items: { type: 'string' as const }, description: 'Filter by label IDs' },
            maxResults: { type: 'number' as const, description: 'Maximum emails to return (default 20, max 50)', default: 20 },
          },
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      {
        name: 'gmail_write_draft',
        description: 'Compose a new email draft (saved to Drafts folder).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            to: { type: 'string' as const, description: 'Recipient(s), comma-separated' },
            subject: { type: 'string' as const, description: 'Subject line' },
            body: { type: 'string' as const, description: 'Email body (plain text)' },
            cc: { type: 'string' as const, description: 'CC recipients' },
            bcc: { type: 'string' as const, description: 'BCC recipients' },
          },
          required: ['to', 'subject', 'body'],
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      {
        name: 'gmail_write_draft_reply',
        description: 'Compose a draft reply to an existing message (threaded).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            messageId: { type: 'string' as const, description: 'Message ID to reply to' },
            body: { type: 'string' as const, description: 'Reply body (plain text)' },
            to: { type: 'string' as const, description: 'Override reply-to address' },
            cc: { type: 'string' as const, description: 'CC recipients' },
            bcc: { type: 'string' as const, description: 'BCC recipients' },
          },
          required: ['messageId', 'body'],
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      {
        name: 'gmail_send_email',
        description: 'Send an email directly (not as draft).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            to: { type: 'string' as const, description: 'Recipient(s)' },
            subject: { type: 'string' as const, description: 'Subject line' },
            body: { type: 'string' as const, description: 'Email body (plain text)' },
            cc: { type: 'string' as const, description: 'CC recipients' },
            bcc: { type: 'string' as const, description: 'BCC recipients' },
          },
          required: ['to', 'subject', 'body'],
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      {
        name: 'gmail_list_labels',
        description: 'List all labels in the mailbox (system labels like INBOX, SENT, STARRED and user-created labels).',
        inputSchema: { type: 'object' as const, properties: {} },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      {
        name: 'gmail_modify_message_labels',
        description: 'Add or remove labels on a single email message. Use gmail_list_labels to find label IDs. Common labels: STARRED, IMPORTANT, UNREAD, INBOX, SPAM, TRASH.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            messageId: { type: 'string' as const, description: 'Message ID to modify' },
            addLabelIds: { type: 'array' as const, items: { type: 'string' as const }, description: 'Label IDs to add' },
            removeLabelIds: { type: 'array' as const, items: { type: 'string' as const }, description: 'Label IDs to remove' },
          },
          required: ['messageId'],
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      {
        name: 'gmail_modify_thread_labels',
        description: 'Add or remove labels on all messages in a thread. Use gmail_list_labels to find label IDs. Common labels: STARRED, IMPORTANT, UNREAD, INBOX, SPAM, TRASH.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            threadId: { type: 'string' as const, description: 'Thread ID to modify' },
            addLabelIds: { type: 'array' as const, items: { type: 'string' as const }, description: 'Label IDs to add' },
            removeLabelIds: { type: 'array' as const, items: { type: 'string' as const }, description: 'Label IDs to remove' },
          },
          required: ['threadId'],
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case 'gmail_who_am_i': {
          WhoAmISchema.parse(args);
          const auth = getGoogleAuth(providerAccessToken);
          const gmail = google.gmail({ version: 'v1', auth });
          const profile = await gmail.users.getProfile({ userId: 'me' });
          return {
            content: [{ type: 'text', text: JSON.stringify({
              email: profile.data.emailAddress,
              name: context?.name || profile.data.emailAddress,
              messagesTotal: profile.data.messagesTotal,
              threadsTotal: profile.data.threadsTotal,
              historyId: profile.data.historyId,
            }, null, 2) }],
          };
        }
        case 'gmail_list_threads': {
          const input = ListThreadsSchema.parse(args);
          const auth = getGoogleAuth(providerAccessToken);
          const gmail = google.gmail({ version: 'v1', auth });
          const res = await gmail.users.threads.list({ userId: 'me', q: input.query, labelIds: input.labelIds, maxResults: input.maxResults });
          const threads = (res.data.threads || []).map(t => ({ id: t.id, snippet: t.snippet, historyId: t.historyId }));
          return { content: [{ type: 'text', text: JSON.stringify({ resultSizeEstimate: res.data.resultSizeEstimate, count: threads.length, threads }, null, 2) }] };
        }
        case 'gmail_get_thread': {
          const input = GetThreadSchema.parse(args);
          const auth = getGoogleAuth(providerAccessToken);
          const gmail = google.gmail({ version: 'v1', auth });
          const thread = await gmail.users.threads.get({ userId: 'me', id: input.threadId, format: 'full' });
          const messages = (thread.data.messages || []).map(msg => {
            const headers = msg.payload?.headers || [];
            return { id: msg.id, threadId: msg.threadId, from: getHeader(headers, 'From'), to: getHeader(headers, 'To'), cc: getHeader(headers, 'Cc'), subject: getHeader(headers, 'Subject'), date: getHeader(headers, 'Date'), snippet: msg.snippet, body: getPlainTextBody(msg.payload), labelIds: msg.labelIds };
          });
          return { content: [{ type: 'text', text: JSON.stringify({ id: thread.data.id, messageCount: messages.length, messages }, null, 2) }] };
        }
        case 'gmail_list_emails': {
          const input = ListEmailsSchema.parse(args);
          const auth = getGoogleAuth(providerAccessToken);
          const gmail = google.gmail({ version: 'v1', auth });
          const listRes = await gmail.users.messages.list({ userId: 'me', q: input.query, labelIds: input.labelIds, maxResults: input.maxResults });
          const messageIds = (listRes.data.messages || []).map(m => m.id!).filter(Boolean);
          const emails = await batchMap(messageIds, async (id) => {
            const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
            const headers = msg.data.payload?.headers || [];
            return { id: msg.data.id, threadId: msg.data.threadId, from: getHeader(headers, 'From'), to: getHeader(headers, 'To'), cc: getHeader(headers, 'Cc'), subject: getHeader(headers, 'Subject'), date: getHeader(headers, 'Date'), snippet: msg.data.snippet, body: getPlainTextBody(msg.data.payload), labelIds: msg.data.labelIds };
          });
          return { content: [{ type: 'text', text: JSON.stringify({ resultSizeEstimate: listRes.data.resultSizeEstimate, count: emails.length, emails }, null, 2) }] };
        }
        case 'gmail_write_draft': {
          const input = WriteDraftSchema.parse(args);
          const auth = getGoogleAuth(providerAccessToken);
          const gmail = google.gmail({ version: 'v1', auth });
          const raw = buildRawMessage({ to: input.to, subject: input.subject, body: input.body, from: context?.email, cc: input.cc, bcc: input.bcc });
          const draft = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });
          return { content: [{ type: 'text', text: JSON.stringify({ draftId: draft.data.id, messageId: draft.data.message?.id, threadId: draft.data.message?.threadId }, null, 2) }] };
        }
        case 'gmail_write_draft_reply': {
          const input = WriteDraftReplySchema.parse(args);
          const auth = getGoogleAuth(providerAccessToken);
          const gmail = google.gmail({ version: 'v1', auth });
          const original = await gmail.users.messages.get({ userId: 'me', id: input.messageId, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Message-ID', 'References'] });
          const origHeaders = original.data.payload?.headers || [];
          const origFrom = getHeader(origHeaders, 'From');
          const origSubject = getHeader(origHeaders, 'Subject');
          const origMessageId = getHeader(origHeaders, 'Message-ID');
          const origReferences = getHeader(origHeaders, 'References');
          const replySubject = origSubject.startsWith('Re:') ? origSubject : `Re: ${origSubject}`;
          const references = origReferences ? `${origReferences} ${origMessageId}` : origMessageId;
          const replyTo = input.to || origFrom;
          const raw = buildRawMessage({ to: replyTo, subject: replySubject, body: input.body, from: context?.email, cc: input.cc, bcc: input.bcc, inReplyTo: origMessageId, references });
          const draft = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw, threadId: original.data.threadId! } } });
          return { content: [{ type: 'text', text: JSON.stringify({ draftId: draft.data.id, messageId: draft.data.message?.id, threadId: draft.data.message?.threadId, inReplyTo: origMessageId, replyTo, subject: replySubject }, null, 2) }] };
        }
        case 'gmail_send_email': {
          const input = SendEmailSchema.parse(args);
          const auth = getGoogleAuth(providerAccessToken);
          const gmail = google.gmail({ version: 'v1', auth });
          const raw = buildRawMessage({ to: input.to, subject: input.subject, body: input.body, from: context?.email, cc: input.cc, bcc: input.bcc });
          const sent = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
          return { content: [{ type: 'text', text: JSON.stringify({ messageId: sent.data.id, threadId: sent.data.threadId, labelIds: sent.data.labelIds }, null, 2) }] };
        }
        case 'gmail_list_labels': {
          ListLabelsSchema.parse(args);
          const auth = getGoogleAuth(providerAccessToken);
          const gmail = google.gmail({ version: 'v1', auth });
          const res = await gmail.users.labels.list({ userId: 'me' });
          const labels = (res.data.labels || []).map(l => ({ id: l.id, name: l.name, type: l.type }));
          return { content: [{ type: 'text', text: JSON.stringify({ count: labels.length, labels }, null, 2) }] };
        }
        case 'gmail_modify_message_labels': {
          const input = ModifyMessageLabelsSchema.parse(args);
          if (!input.addLabelIds?.length && !input.removeLabelIds?.length) {
            throw new Error('At least one of addLabelIds or removeLabelIds is required');
          }
          const auth = getGoogleAuth(providerAccessToken);
          const gmail = google.gmail({ version: 'v1', auth });
          const res = await gmail.users.messages.modify({
            userId: 'me',
            id: input.messageId,
            requestBody: {
              addLabelIds: input.addLabelIds || [],
              removeLabelIds: input.removeLabelIds || [],
            },
          });
          return { content: [{ type: 'text', text: JSON.stringify({ messageId: res.data.id, threadId: res.data.threadId, labelIds: res.data.labelIds }, null, 2) }] };
        }
        case 'gmail_modify_thread_labels': {
          const input = ModifyThreadLabelsSchema.parse(args);
          if (!input.addLabelIds?.length && !input.removeLabelIds?.length) {
            throw new Error('At least one of addLabelIds or removeLabelIds is required');
          }
          const auth = getGoogleAuth(providerAccessToken);
          const gmail = google.gmail({ version: 'v1', auth });
          const res = await gmail.users.threads.modify({
            userId: 'me',
            id: input.threadId,
            requestBody: {
              addLabelIds: input.addLabelIds || [],
              removeLabelIds: input.removeLabelIds || [],
            },
          });
          return { content: [{ type: 'text', text: JSON.stringify({ threadId: res.data.id, messages: (res.data.messages || []).map(m => ({ id: m.id, labelIds: m.labelIds })) }, null, 2) }] };
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      return { content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }], isError: true };
    }
  });

  return server;
}

export const gmail: MCPServerDefinition = {
  slug: 'gmail',
  name: 'Gmail MCP Server',
  createServer: createGmailServer,
  auth: {
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.modify',
    ],
  },
};

export default gmail;
