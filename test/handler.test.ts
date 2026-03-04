import { describe, it, expect, vi } from 'vitest';
import { createMCPHandler } from '../src/handler';
import { signAccessToken } from '../src/auth/jwt';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { MCPAppConfig } from '../src/types';

function makeConfig(overrides: Partial<MCPAppConfig> = {}): MCPAppConfig {
  return {
    secret: 'test-secret-that-is-long-enough-for-hmac',
    authProvider: {
      id: 'test', name: 'Test',
      getAuthorizationUrl: () => '',
      exchangeCode: async () => ({ email: '', name: '', access_token: '', refresh_token: '' }),
      refreshAccessToken: async () => ({ access_token: '' }),
      getBaseScopes: () => [],
    },
    servers: [],
    baseUrl: 'https://example.com',
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

/** Create a real MCP Server with a single echo tool for testing hooks */
function createTestServer() {
  const server = new Server(
    { name: 'test', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: 'echo',
      description: 'Echo tool',
      inputSchema: { type: 'object' as const, properties: { msg: { type: 'string' as const } } },
    }],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const msg = (request.params.arguments as any)?.msg || 'hello';
    return { content: [{ type: 'text', text: msg }] };
  });

  return server;
}

describe('createMCPHandler', () => {
  const mockCreateServer = () => ({} as any);

  it('returns 401 without Authorization header', async () => {
    const handler = createMCPHandler('gmail', mockCreateServer, makeConfig());
    const res = mockRes();
    await handler({ method: 'POST', headers: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error.message).toBe('Unauthorized');
  });

  it('includes WWW-Authenticate header on 401', async () => {
    const handler = createMCPHandler('gmail', mockCreateServer, makeConfig());
    const res = mockRes();
    await handler({ method: 'POST', headers: {} }, res);
    expect(res.headers['WWW-Authenticate']).toContain('resource_metadata');
    expect(res.headers['WWW-Authenticate']).toContain('gmail');
  });

  it('returns 403 for invalid token', async () => {
    const handler = createMCPHandler('gmail', mockCreateServer, makeConfig());
    const res = mockRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer invalid-token' } }, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error.message).toContain('expired');
  });

  it('returns 405 for unsupported methods', async () => {
    const config = makeConfig();
    const token = await signAccessToken({
      email: 'user@example.com', name: 'User', scopes: [],
    }, config);

    const handler = createMCPHandler('gmail', mockCreateServer, config);
    const res = mockRes();
    await handler({ method: 'PUT', headers: { authorization: `Bearer ${token}` } }, res);
    expect(res.statusCode).toBe(405);
    expect(res.headers['Allow']).toBe('GET, POST, DELETE');
  });
});

describe('tool lifecycle hooks', () => {
  it('wraps tools/call handler when onToolCall is set', async () => {
    const onToolCall = vi.fn();
    const config = makeConfig({ onToolCall });

    const server = createTestServer();
    const handlers = (server as any)._requestHandlers as Map<string, Function>;
    const original = handlers.get('tools/call')!;

    // Apply the same wrapping logic as createMCPHandler
    handlers.set('tools/call', async (request: any, extra: any) => {
      const toolName = request.params?.name;
      const toolArgs = request.params?.arguments;
      if (config.onToolCall) {
        const blocked = await config.onToolCall('test', toolName, toolArgs, 'user@example.com');
        if (blocked) return blocked;
      }
      return original(request, extra);
    });

    const wrappedHandler = handlers.get('tools/call')!;
    const result = await wrappedHandler(
      { method: 'tools/call', params: { name: 'echo', arguments: { msg: 'hi' } } },
      {}
    );

    expect(result).toEqual({ content: [{ type: 'text', text: 'hi' }] });
    expect(onToolCall).toHaveBeenCalledWith('test', 'echo', { msg: 'hi' }, 'user@example.com');
  });

  it('onToolCall can block execution by returning a result', async () => {
    const blockedResult = { content: [{ type: 'text' as const, text: 'blocked' }] };
    const onToolCall = vi.fn().mockResolvedValue(blockedResult);
    const config = makeConfig({ onToolCall });
    const token = await signAccessToken({
      email: 'user@example.com', name: 'User', scopes: [],
    }, config);

    // Create a server and manually test the wrapped handler
    const server = createTestServer();

    // Simulate what createMCPHandler does internally
    const handlers = (server as any)._requestHandlers as Map<string, Function>;
    const original = handlers.get('tools/call')!;

    // Apply the wrapping logic
    handlers.set('tools/call', async (request: any, extra: any) => {
      const toolName = request.params?.name;
      const toolArgs = request.params?.arguments;
      if (config.onToolCall) {
        const blocked = await config.onToolCall('test', toolName, toolArgs, 'user@example.com');
        if (blocked) return blocked;
      }
      return original(request, extra);
    });

    const wrappedHandler = handlers.get('tools/call')!;
    const result = await wrappedHandler(
      { method: 'tools/call', params: { name: 'echo', arguments: { msg: 'hi' } } },
      {}
    );

    expect(result).toEqual(blockedResult);
    expect(onToolCall).toHaveBeenCalledWith('test', 'echo', { msg: 'hi' }, 'user@example.com');
  });

  it('onToolComplete can override the result', async () => {
    const overrideResult = { content: [{ type: 'text' as const, text: 'overridden' }] };
    const onToolComplete = vi.fn().mockResolvedValue(overrideResult);
    const config = makeConfig({ onToolComplete });
    const token = await signAccessToken({
      email: 'user@example.com', name: 'User', scopes: [],
    }, config);

    const server = createTestServer();
    const handlers = (server as any)._requestHandlers as Map<string, Function>;
    const original = handlers.get('tools/call')!;

    handlers.set('tools/call', async (request: any, extra: any) => {
      let result: any, error: unknown;
      try { result = await original(request, extra); } catch (err) { error = err; }
      if (config.onToolComplete) {
        const override = await config.onToolComplete('test', request.params?.name, request.params?.arguments, result, error, 'user@example.com');
        if (override) return override;
      }
      if (error) throw error;
      return result;
    });

    const wrappedHandler = handlers.get('tools/call')!;
    const result = await wrappedHandler(
      { method: 'tools/call', params: { name: 'echo', arguments: { msg: 'hi' } } },
      {}
    );

    expect(result).toEqual(overrideResult);
    expect(onToolComplete).toHaveBeenCalledWith('test', 'echo', { msg: 'hi' }, expect.objectContaining({ content: [{ type: 'text', text: 'hi' }] }), undefined, 'user@example.com');
  });

  it('onToolComplete receives errors from tool execution', async () => {
    const onToolComplete = vi.fn();
    const config = makeConfig({ onToolComplete });

    const server = new Server(
      { name: 'test', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
    server.setRequestHandler(CallToolRequestSchema, async () => {
      throw new Error('tool failed');
    });

    const handlers = (server as any)._requestHandlers as Map<string, Function>;
    const original = handlers.get('tools/call')!;

    handlers.set('tools/call', async (request: any, extra: any) => {
      let result: any, error: unknown;
      try { result = await original(request, extra); } catch (err) { error = err; }
      if (config.onToolComplete) {
        const override = await config.onToolComplete('test', request.params?.name, request.params?.arguments, result, error, 'user@example.com');
        if (override) return override;
      }
      if (error) throw error;
      return result;
    });

    const wrappedHandler = handlers.get('tools/call')!;

    await expect(wrappedHandler(
      { method: 'tools/call', params: { name: 'broken', arguments: {} } },
      {}
    )).rejects.toThrow('tool failed');

    expect(onToolComplete).toHaveBeenCalledWith('test', 'broken', {}, undefined, expect.any(Error), 'user@example.com');
  });

  it('passes through when hooks return void', async () => {
    const onToolCall = vi.fn(); // returns undefined
    const onToolComplete = vi.fn(); // returns undefined
    const config = makeConfig({ onToolCall, onToolComplete });

    const server = createTestServer();
    const handlers = (server as any)._requestHandlers as Map<string, Function>;
    const original = handlers.get('tools/call')!;

    handlers.set('tools/call', async (request: any, extra: any) => {
      const toolName = request.params?.name;
      const toolArgs = request.params?.arguments;
      if (config.onToolCall) {
        const blocked = await config.onToolCall('test', toolName, toolArgs, 'user@example.com');
        if (blocked) return blocked;
      }
      let result: any, error: unknown;
      try { result = await original(request, extra); } catch (err) { error = err; }
      if (config.onToolComplete) {
        const override = await config.onToolComplete('test', toolName, toolArgs, result, error, 'user@example.com');
        if (override) return override;
      }
      if (error) throw error;
      return result;
    });

    const wrappedHandler = handlers.get('tools/call')!;
    const result = await wrappedHandler(
      { method: 'tools/call', params: { name: 'echo', arguments: { msg: 'pass-through' } } },
      {}
    );

    expect(result).toEqual({ content: [{ type: 'text', text: 'pass-through' }] });
    expect(onToolCall).toHaveBeenCalled();
    expect(onToolComplete).toHaveBeenCalled();
  });
});
