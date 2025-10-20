/**
 * Unit tests for setupMCPServerWithRegistry (registry-based setup)
 *
 * Tests the new registry-based setup function that uses ToolRegistry
 */

import { vi } from 'vitest';
import { setupMCPServerWithRegistry } from '../../../src/server/mcp-setup-registry.js';
import { ToolRegistry } from '@mcp-typescript-simple/tools';
import { basicTools } from '@mcp-typescript-simple/example-tools-basic';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

describe('setupMCPServerWithRegistry', () => {
  const createServer = () => {
    return {
      setRequestHandler: vi.fn()
    } as unknown as { setRequestHandler: Mock };
  };

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('registers tools from the registry', async () => {
    const server = createServer();
    const registry = new ToolRegistry();
    registry.merge(basicTools);

    await setupMCPServerWithRegistry(server as unknown as any, registry);

    // Check that list tools handler was registered
    const listHandler = server.setRequestHandler.mock.calls.find(
      ([schema]) => schema === ListToolsRequestSchema
    )?.[1] as (() => Promise<any>) | undefined;

    expect(typeof listHandler).toBe('function');

    // Get the tools list
    const response = await listHandler!();
    const toolNames = response.tools.map((tool: { name: string }) => tool.name);

    // Should have basic tools
    expect(toolNames).toEqual(expect.arrayContaining(['hello', 'echo', 'current-time']));
  });

  it('works with an empty registry', async () => {
    const server = createServer();
    const registry = new ToolRegistry();

    await setupMCPServerWithRegistry(server as unknown as any, registry);

    // Should still set up handlers
    expect(server.setRequestHandler).toHaveBeenCalled();

    const listHandler = server.setRequestHandler.mock.calls.find(
      ([schema]) => schema === ListToolsRequestSchema
    )?.[1] as (() => Promise<any>) | undefined;

    const response = await listHandler!();
    expect(response.tools).toEqual([]);
  });

  it('handles multiple tool registrations from registry', async () => {
    const server = createServer();
    const registry = new ToolRegistry();

    // Add basic tools
    registry.merge(basicTools);

    await setupMCPServerWithRegistry(server as unknown as any, registry);

    const listHandler = server.setRequestHandler.mock.calls.find(
      ([schema]) => schema === ListToolsRequestSchema
    )?.[1] as (() => Promise<any>) | undefined;

    const response = await listHandler!();

    // Should have all registered tools
    expect(response.tools.length).toBeGreaterThan(0);
  });
});
