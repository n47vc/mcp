# Apollo MCP Server

Search and enrich people and company data via Apollo.io. Part of [@n47vc/mcp](../../README.md).

## Setup

Requires an Apollo.io API key.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `APOLLO_API_KEY` | Yes | API key from [Apollo.io](https://app.apollo.io/#/settings/integrations/api) |

No additional Google OAuth scopes are needed — Apollo uses its own API key for data access. Users are still authenticated via Google OAuth for identity.

## Tools

### `apollo_enrich_company`
Get detailed company information: headcount, industry, funding history, revenue, technologies, and location.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `domain` | `string` | Yes | Company domain (e.g., `"stripe.com"`) |

### `apollo_company_people`
Find people at a company. Returns names, titles, seniority, email, LinkedIn, location, and employment history.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `domain` | `string` | Yes | Company domain |
| `titles` | `string[]` | No | Filter by title keywords (e.g., `["CEO", "VP Engineering"]`) |
| `seniorities` | `string[]` | No | Filter by level: `"c_suite"`, `"vp"`, `"director"`, `"manager"`, `"senior"`, `"entry"` |
| `limit` | `number` | No | Max results (default 25, max 100) |

### `apollo_find_person`
Find a specific person by name, email, or LinkedIn URL. Returns full profile with employment history.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | No* | Person's full name |
| `email` | `string` | No* | Email address |
| `company` | `string` | No | Company name (narrows search) |
| `linkedin_url` | `string` | No* | LinkedIn profile URL |

*At least one of `name`, `email`, or `linkedin_url` is required.

### `apollo_search_people`
Search for people across all companies using keywords. For searching within one company, use `apollo_company_people`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `keywords` | `string` | Yes | Search keywords (e.g., `"machine learning fintech"`) |
| `titles` | `string[]` | No | Filter by title keywords |
| `limit` | `number` | No | Max results (default 10, max 100) |

### `apollo_enrich_person`
Enrich a person's profile using any combination of identifiers. More flexible than `apollo_find_person`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `apolloId` | `string` | No* | Apollo person ID (from previous results) |
| `email` | `string` | No* | Email address |
| `name` | `string` | No* | Full name |
| `company` | `string` | No | Company name |
| `domain` | `string` | No | Company domain |
| `linkedin_url` | `string` | No* | LinkedIn URL |

*At least one identifier is required.
