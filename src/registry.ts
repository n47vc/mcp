import type { MCPServerDefinition } from './types';

const servers = new Map<string, MCPServerDefinition>();

export function registerMCPServer(definition: MCPServerDefinition): void {
  servers.set(definition.slug, definition);
}

export function getMCPServer(slug: string): MCPServerDefinition | undefined {
  return servers.get(slug);
}

export function getAllMCPServers(): MCPServerDefinition[] {
  return Array.from(servers.values());
}
