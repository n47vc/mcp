# Contributing

## Getting Started

```bash
git clone https://github.com/n47-vc/mcp.git
cd mcp
npm install
npm run build
```

## Development

```bash
npm run dev    # watch mode
npm run lint   # type-check
npm test       # run tests
```

## Adding a New MCP Server

1. Create a directory under `src/servers/<name>/`.
2. Export a `MCPServerDefinition` object and a `createServer` factory function.
3. Add the exports to `src/index.ts`.

## Adding a New Auth Provider

Implement the `AuthProviderConfig` interface (see `src/auth/providers/google.ts` for reference) and export it from `src/index.ts`.

## Pull Requests

- Keep PRs focused on a single change.
- Run `npm run lint` and `npm test` before submitting.
- Add tests for new features.
