/**
 * Unit tests for ToolRegistry insertion order preservation
 */

import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import { z } from 'zod';

describe('ToolRegistry', () => {
  describe('insertion order preservation', () => {
    it('should preserve insertion order in list() method', () => {
      const registry = new ToolRegistry();

      // Register tools in specific order
      registry.add({
        name: 'zebra',
        description: 'Last alphabetically',
        inputSchema: z.object({}),
        handler: async () => ({ content: [{ type: 'text', text: 'zebra' }] }),
      });

      registry.add({
        name: 'alpha',
        description: 'First alphabetically',
        inputSchema: z.object({}),
        handler: async () => ({ content: [{ type: 'text', text: 'alpha' }] }),
      });

      registry.add({
        name: 'middle',
        description: 'Middle alphabetically',
        inputSchema: z.object({}),
        handler: async () => ({ content: [{ type: 'text', text: 'middle' }] }),
      });

      // Get tool list
      const tools = registry.list();
      const toolNames = tools.map(t => t.name);

      // Should preserve insertion order (zebra, alpha, middle)
      // NOT alphabetical order (alpha, middle, zebra)
      expect(toolNames).toEqual(['zebra', 'alpha', 'middle']);
    });

    it('should preserve order after merge operations', () => {
      const registry1 = new ToolRegistry();
      const registry2 = new ToolRegistry();

      // Registry 1: zebra, alpha
      registry1.add({
        name: 'zebra',
        description: 'Zebra tool',
        inputSchema: z.object({}),
        handler: async () => ({ content: [{ type: 'text', text: 'zebra' }] }),
      });

      registry1.add({
        name: 'alpha',
        description: 'Alpha tool',
        inputSchema: z.object({}),
        handler: async () => ({ content: [{ type: 'text', text: 'alpha' }] }),
      });

      // Registry 2: middle, omega
      registry2.add({
        name: 'middle',
        description: 'Middle tool',
        inputSchema: z.object({}),
        handler: async () => ({ content: [{ type: 'text', text: 'middle' }] }),
      });

      registry2.add({
        name: 'omega',
        description: 'Omega tool',
        inputSchema: z.object({}),
        handler: async () => ({ content: [{ type: 'text', text: 'omega' }] }),
      });

      // Merge registry2 into registry1
      registry1.merge(registry2);

      const tools = registry1.list();
      const toolNames = tools.map(t => t.name);

      // Should be: zebra, alpha (from registry1), then middle, omega (from registry2)
      expect(toolNames).toEqual(['zebra', 'alpha', 'middle', 'omega']);
    });

    it('should maintain order with real-world tool names', () => {
      const registry = new ToolRegistry();

      // Register in Phase 6 order (alphabetical)
      registry.add({
        name: 'current-time',
        description: 'Get current timestamp',
        inputSchema: z.object({}),
        handler: async () => ({ content: [{ type: 'text', text: '2025-10-24' }] }),
      });

      registry.add({
        name: 'hello',
        description: 'Say hello',
        inputSchema: z.object({ name: z.string() }),
        handler: async () => ({ content: [{ type: 'text', text: 'Hello!' }] }),
      });

      registry.add({
        name: 'echo',
        description: 'Echo message',
        inputSchema: z.object({ message: z.string() }),
        handler: async () => ({ content: [{ type: 'text', text: 'Echo!' }] }),
      });

      const tools = registry.list();
      const toolNames = tools.map(t => t.name);

      // Phase 6: Tools registered in alphabetical order
      expect(toolNames).toEqual(['current-time', 'hello', 'echo']);
    });

    it('should document that Map preserves insertion order (ES2015+)', () => {
      // This test documents the JavaScript Map behavior we rely on
      const map = new Map<string, number>();

      map.set('zebra', 1);
      map.set('alpha', 2);
      map.set('middle', 3);

      const keys = Array.from(map.keys());

      // Map preserves insertion order since ES2015
      expect(keys).toEqual(['zebra', 'alpha', 'middle']);
    });
  });

  describe('getNames() method', () => {
    it('should return tool names in insertion order', () => {
      const registry = new ToolRegistry();

      registry.add({
        name: 'third',
        description: 'Third',
        inputSchema: z.object({}),
        handler: async () => ({ content: [{ type: 'text', text: 'third' }] }),
      });

      registry.add({
        name: 'first',
        description: 'First',
        inputSchema: z.object({}),
        handler: async () => ({ content: [{ type: 'text', text: 'first' }] }),
      });

      registry.add({
        name: 'second',
        description: 'Second',
        inputSchema: z.object({}),
        handler: async () => ({ content: [{ type: 'text', text: 'second' }] }),
      });

      const names = registry.getNames();

      expect(names).toEqual(['third', 'first', 'second']);
    });
  });
});
