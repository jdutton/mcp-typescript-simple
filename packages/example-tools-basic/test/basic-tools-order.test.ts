/**
 * Integration test for basicTools registration order
 *
 * This test validates that the basicTools registry exports tools
 * in the expected alphabetical order as defined in Phase 6.
 */

import { describe, it, expect } from 'vitest';
import { basicTools } from '../src/index.js';

describe('basicTools registration order', () => {
  it('should register tools in alphabetical order (Phase 6)', () => {
    const tools = basicTools.list();
    const toolNames = tools.map(t => t.name);

    // Phase 6: Tools are registered in alphabetical order
    // packages/example-tools-basic/src/index.ts:33-35
    expect(toolNames).toEqual(['current-time', 'echo', 'hello']);
  });

  it('should have exactly 3 basic tools', () => {
    const tools = basicTools.list();
    expect(tools).toHaveLength(3);
  });

  it('should preserve tool metadata in list()', () => {
    const tools = basicTools.list();

    // Verify current-time is first
    expect(tools[0].name).toBe('current-time');
    expect(tools[0].description).toBe('Get the current timestamp');

    // Verify echo is second
    expect(tools[1].name).toBe('echo');
    expect(tools[1].description).toBe('Echo back the provided message');

    // Verify hello is third
    expect(tools[2].name).toBe('hello');
    expect(tools[2].description).toBe('Say hello to someone');
  });

  it('should match getNames() order with list() order', () => {
    const toolNames = basicTools.getNames();
    const listNames = basicTools.list().map(t => t.name);

    expect(toolNames).toEqual(listNames);
    expect(toolNames).toEqual(['current-time', 'echo', 'hello']);
  });
});
