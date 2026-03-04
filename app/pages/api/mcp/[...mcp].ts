import { createMCPApp, createGoogleAuthProvider, gmail, gdrive, apollo } from '@n47vc/mcp';

export const config = { api: { bodyParser: false } };

export default createMCPApp({
  secret: process.env.MCP_SECRET!,
  authProvider: createGoogleAuthProvider({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    allowedDomain: process.env.ALLOWED_DOMAIN,
  }),
  servers: [gmail, gdrive, apollo],
});
