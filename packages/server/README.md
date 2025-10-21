# @mcp-typescript-simple/server

**High-Level MCP Server Creation and Management**

This package provides a simplified, high-level API for creating MCP (Model Context Protocol) servers in TypeScript.

## Purpose

Abstracts away the complexity of:
- MCP SDK Server instantiation
- Tool registry management
- Transport layer configuration
- Server lifecycle management

## Quick Start

```typescript
import { createMCPServer } from '@mcp-typescript-simple/server';
import { myTools } from './my-tools/index.js';

const server = await createMCPServer({
  name: 'my-mcp-server',
  version: '1.0.0',
  tools: [myTools],
});

await server.start();
```

## API

### `createMCPServer(config: MCPServerConfig)`

Creates and initializes an MCP server with the specified configuration.

**Parameters:**
- `config.name` (string) - Server name
- `config.version` (string) - Server version
- `config.tools` (ToolRegistry[]) - Array of tool registries to include
- `config.transport` (optional) - Transport type: 'auto' (default), 'stdio', or 'http'

**Returns:**
```typescript
{
  server: Server,           // MCP SDK Server instance
  start: () => Promise<void>,  // Start the server
  stop: () => Promise<void>,   // Stop the server
}
```

## Advanced Usage

### Access underlying MCP Server

```typescript
const { server, start } = await createMCPServer({
  name: 'my-server',
  version: '1.0.0',
  tools: [myTools],
});

// Access MCP SDK server directly
console.log(server.getCapabilities());

await start();
```

### Low-Level Setup (Advanced)

For advanced use cases, you can use the lower-level `setupMCPServerWithRegistry()` function:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { setupMCPServerWithRegistry } from '@mcp-typescript-simple/server';
import { ToolRegistry } from '@mcp-typescript-simple/tools';

const server = new Server({
  name: 'my-server',
  version: '1.0.0',
}, { capabilities: { tools: {} } });

const registry = new ToolRegistry();
// ... add tools to registry

await setupMCPServerWithRegistry(server, registry);
```

## License

MIT
