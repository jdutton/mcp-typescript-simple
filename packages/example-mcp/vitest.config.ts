import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'test/',
        '**/*.test.ts',
        '**/*.config.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@mcp-typescript-simple/tools': resolve(__dirname, '../tools/src'),
      '@mcp-typescript-simple/tools-llm': resolve(__dirname, '../tools-llm/src'),
      '@mcp-typescript-simple/example-tools-basic': resolve(__dirname, '../example-tools-basic/src'),
      '@mcp-typescript-simple/example-tools-llm': resolve(__dirname, '../example-tools-llm/src'),
      '@mcp-typescript-simple/server': resolve(__dirname, '../server/src'),
      '@mcp-typescript-simple/http-server': resolve(__dirname, '../http-server/src'),
      '@mcp-typescript-simple/config': resolve(__dirname, '../config/src'),
      '@mcp-typescript-simple/observability': resolve(__dirname, '../observability/src'),
    },
  },
});
