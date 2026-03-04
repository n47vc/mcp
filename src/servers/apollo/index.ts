import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { MCPUserContext, MCPServerDefinition } from '../../types';

// ---------- Apollo API Client ----------

const APOLLO_BASE_URL = 'https://api.apollo.io/api/v1';

function getApiKey(): string {
  const key = process.env.APOLLO_API_KEY;
  if (!key) throw new Error('APOLLO_API_KEY environment variable is not set');
  return key;
}

async function apolloPost(endpoint: string, body: Record<string, any>): Promise<any> {
  const resp = await fetch(`${APOLLO_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': getApiKey() },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Apollo API error: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

async function searchPeople(params: { q_keywords?: string; q_organization_domains?: string[]; person_titles?: string[]; per_page?: number }): Promise<any[]> {
  const body: Record<string, any> = {
    per_page: params.per_page || 25,
  };
  if (params.q_keywords) body.q_keywords = params.q_keywords;
  if (params.q_organization_domains) body.q_organization_domains = params.q_organization_domains;
  if (params.person_titles) body.person_titles = params.person_titles;
  const data = await apolloPost('/mixed_people/search', body);
  return data.people || [];
}

async function enrichPerson(params: Record<string, any>): Promise<any | null> {
  const data = await apolloPost('/people/match', params);
  return data.person || null;
}

async function findPerson(params: { name?: string; email?: string; company?: string; linkedin_url?: string }): Promise<any | null> {
  // Try enrichment first
  if (params.email || params.linkedin_url) {
    const person = await enrichPerson({
      email: params.email,
      linkedin_url: params.linkedin_url,
      organization_name: params.company,
    });
    if (person) return person;
  }
  // Fall back to search
  if (params.name) {
    const people = await searchPeople({
      q_keywords: params.company ? `${params.name} ${params.company}` : params.name,
      per_page: 1,
    });
    return people[0] || null;
  }
  return null;
}

async function enrichOrganization(domain: string): Promise<any | null> {
  const data = await apolloPost('/organizations/enrich', { domain });
  return data.organization || null;
}

// ---------- Input Schemas ----------

const CompanyPeopleSchema = z.object({
  domain: z.string(),
  titles: z.array(z.string()).optional(),
  seniorities: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(100).optional().default(25),
});

const EnrichCompanySchema = z.object({ domain: z.string() });

const FindPersonSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  company: z.string().optional(),
  linkedin_url: z.string().optional(),
}).refine(data => data.name || data.email || data.linkedin_url, {
  message: "At least one of 'name', 'email', or 'linkedin_url' must be provided",
});

const SearchPeopleSchema = z.object({
  keywords: z.string(),
  titles: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(100).optional().default(10),
});

const EnrichPersonSchema = z.object({
  apolloId: z.string().optional(),
  email: z.string().optional(),
  name: z.string().optional(),
  company: z.string().optional(),
  domain: z.string().optional(),
  linkedin_url: z.string().optional(),
}).refine(data => data.apolloId || data.email || data.name || data.linkedin_url, {
  message: 'At least one identifier must be provided',
});

// ---------- Formatters ----------

function formatPerson(p: any) {
  return {
    id: p.id, name: p.name, title: p.title, seniority: p.seniority, email: p.email,
    linkedin_url: p.linkedin_url, city: p.city, state: p.state, country: p.country,
    departments: p.departments, phone_numbers: p.phone_numbers, photo_url: p.photo_url,
    headline: p.headline,
    company: p.organization ? { name: p.organization.name, domain: p.organization.primary_domain, linkedin_url: p.organization.linkedin_url } : null,
  };
}

function formatPersonFull(p: any) {
  return {
    ...formatPerson(p),
    employment_history: p.employment_history?.map((e: any) => ({
      title: e.title, organization_name: e.organization_name, start_date: e.start_date, end_date: e.end_date, current: e.current,
    })),
    twitter_url: p.twitter_url, github_url: p.github_url, functions: p.functions, subdepartments: p.subdepartments,
  };
}

// ---------- Server Factory ----------

export function createApolloServer(context?: MCPUserContext): Server {
  const server = new Server(
    { name: 'apollo-people', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'apollo_enrich_company',
        description: 'Get detailed company information from Apollo including headcount, industry, funding, revenue, technologies, and location.',
        inputSchema: { type: 'object' as const, properties: { domain: { type: 'string' as const, description: 'Company domain (e.g., "stripe.com")' } }, required: ['domain'] },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      {
        name: 'apollo_company_people',
        description: 'Find key people at a company by domain. Returns names, titles, seniority, email, LinkedIn, location, and employment history.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            domain: { type: 'string' as const, description: 'Company domain' },
            titles: { type: 'array' as const, items: { type: 'string' as const }, description: 'Filter by title keywords' },
            seniorities: { type: 'array' as const, items: { type: 'string' as const }, description: 'Filter by seniority level' },
            limit: { type: 'number' as const, description: 'Max results (default 25, max 100)', default: 25 },
          },
          required: ['domain'],
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      {
        name: 'apollo_find_person',
        description: 'Find a specific person by name, email, or LinkedIn URL.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            name: { type: 'string' as const, description: "Person's full name" },
            email: { type: 'string' as const, description: 'Email address' },
            company: { type: 'string' as const, description: 'Company name' },
            linkedin_url: { type: 'string' as const, description: 'LinkedIn profile URL' },
          },
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      {
        name: 'apollo_search_people',
        description: 'Search for people across all companies using keywords.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            keywords: { type: 'string' as const, description: 'Search keywords' },
            titles: { type: 'array' as const, items: { type: 'string' as const }, description: 'Filter by title keywords' },
            limit: { type: 'number' as const, description: 'Max results (default 10, max 100)', default: 10 },
          },
          required: ['keywords'],
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      {
        name: 'apollo_enrich_person',
        description: 'Enrich a person\'s profile using any combination of identifiers.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            apolloId: { type: 'string' as const, description: 'Apollo person ID' },
            email: { type: 'string' as const, description: 'Email address' },
            name: { type: 'string' as const, description: 'Full name' },
            company: { type: 'string' as const, description: 'Company name' },
            domain: { type: 'string' as const, description: 'Company domain' },
            linkedin_url: { type: 'string' as const, description: 'LinkedIn URL' },
          },
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case 'apollo_enrich_company': {
          const input = EnrichCompanySchema.parse(args);
          const org = await enrichOrganization(input.domain);
          if (!org) return { content: [{ type: 'text', text: JSON.stringify({ error: `No data found for domain: ${input.domain}` }, null, 2) }], isError: true };
          return { content: [{ type: 'text', text: JSON.stringify(org, null, 2) }] };
        }
        case 'apollo_company_people': {
          const input = CompanyPeopleSchema.parse(args);
          const people = await searchPeople({ q_organization_domains: [input.domain], person_titles: input.titles, per_page: input.limit });
          let filtered = people;
          if (input.seniorities && input.seniorities.length > 0) {
            const senioritySet = new Set(input.seniorities.map((s: string) => s.toLowerCase()));
            filtered = people.filter((p: any) => p.seniority && senioritySet.has(p.seniority.toLowerCase()));
          }
          return { content: [{ type: 'text', text: JSON.stringify({ domain: input.domain, count: filtered.length, people: filtered.map(formatPersonFull) }, null, 2) }] };
        }
        case 'apollo_find_person': {
          const input = FindPersonSchema.parse(args);
          const person = await findPerson(input);
          if (!person) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Person not found' }, null, 2) }], isError: true };
          return { content: [{ type: 'text', text: JSON.stringify(formatPersonFull(person), null, 2) }] };
        }
        case 'apollo_search_people': {
          const input = SearchPeopleSchema.parse(args);
          const people = await searchPeople({ q_keywords: input.keywords, person_titles: input.titles, per_page: input.limit });
          return { content: [{ type: 'text', text: JSON.stringify({ count: people.length, people: people.map(formatPerson) }, null, 2) }] };
        }
        case 'apollo_enrich_person': {
          const input = EnrichPersonSchema.parse(args);
          const person = await enrichPerson({ id: input.apolloId, email: input.email, name: input.name, organization_name: input.company, domain: input.domain, linkedin_url: input.linkedin_url });
          if (!person) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Person not found' }, null, 2) }], isError: true };
          return { content: [{ type: 'text', text: JSON.stringify(formatPersonFull(person), null, 2) }] };
        }
        default: throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      return { content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }], isError: true };
    }
  });

  return server;
}

export const apollo: MCPServerDefinition = {
  slug: 'apollo',
  name: 'Apollo People & Company MCP Server',
  createServer: createApolloServer,
  auth: { scopes: [] },
};

export default apollo;
