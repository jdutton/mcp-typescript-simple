# @mcp-typescript-simple/example-mcp

Example MCP server demonstrating how to use the `@mcp-typescript-simple` framework packages.

## Overview

This package provides a working reference implementation of an MCP server built using the `@mcp-typescript-simple` framework. It demonstrates:

- **Tool Registry Pattern**: How to compose basic and LLM-powered tools
- **Conditional Features**: Graceful degradation when LLM API keys are missing
- **Multi-Transport Support**: STDIO, HTTP, and OAuth authentication
- **Framework Composition**: How to integrate all framework packages

## Features

### Basic Tools (Always Available)
- `hello` - Greet users by name
- `echo` - Echo back messages
- `current-time` - Get current timestamp

### LLM Tools (Optional - requires API keys)
- `chat` - Interactive AI assistant
- `analyze` - Deep text analysis
- `summarize` - Text summarization
- `explain` - Educational explanations

## Installation

```bash
# As part of the workspace
npm install

# As a standalone package (when published)
npm install @mcp-typescript-simple/example-mcp
```

## Usage

### Running Locally

```bash
# STDIO mode (for MCP clients like Claude Code)
npm run dev:stdio

# HTTP mode (no authentication)
npm run dev:http

# HTTP mode with OAuth
npm run dev:oauth
```

### As an Executable

```bash
# Run directly (when installed globally)
example-mcp

# Or with npx
npx @mcp-typescript-simple/example-mcp
```

## Configuration

### Required Environment Variables

**For LLM Tools** (at least one):
- `ANTHROPIC_API_KEY` - Claude models
- `OPENAI_API_KEY` - GPT models
- `GOOGLE_API_KEY` - Gemini models

**For OAuth Mode**:
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
- `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`

### Transport Mode

Set via `MCP_MODE` environment variable:
- `stdio` - STDIO transport (default)
- `streamable_http` - HTTP transport

### Example .env file

```bash
# LLM Providers (choose one or more)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...

# OAuth (optional, for HTTP mode)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Transport mode
MCP_MODE=streamable_http
```

## Code Structure

```
packages/example-mcp/
├── src/
│   └── index.ts           # Main server composition
├── test/
│   └── index.test.ts      # Bootstrap tests
├── package.json           # Package configuration
├── tsconfig.json          # TypeScript build config
└── vitest.config.ts       # Test configuration
```

## How It Works

### 1. Tool Registry Composition

```typescript
// Create registry and add basic tools
const toolRegistry = new ToolRegistry();
toolRegistry.merge(basicTools);

// Conditionally add LLM tools
try {
  await llmManager.initialize();
  const llmTools = createLLMTools(llmManager);
  toolRegistry.merge(llmTools);
} catch (error) {
  // Gracefully continue with basic tools only
}
```

### 2. MCP Server Setup

```typescript
// Setup server with tool registry
await setupMCPServerWithRegistry(server, toolRegistry, logger);
```

### 3. Transport Layer

```typescript
// Create transport based on environment
const transportManager = TransportFactory.createFromEnvironment();
await transportManager.initialize(server);
await transportManager.start();
```

## Using as a Template

To create your own MCP server:

1. **Copy this package** as a starting point
2. **Replace tools** with your own implementations
3. **Customize** server name, version, and capabilities
4. **Add dependencies** for your specific tools
5. **Deploy** using your preferred method

### Example: Custom Tool

```typescript
import { ToolRegistry, Tool } from "@mcp-typescript-simple/tools";

// Define your tool
const myTool: Tool = {
  name: "my-tool",
  description: "My custom tool",
  inputSchema: {
    type: "object",
    properties: {
      input: { type: "string" }
    },
    required: ["input"]
  },
  handler: async (args) => {
    return {
      content: [
        {
          type: "text",
          text: `Processed: ${args.input}`
        }
      ]
    };
  }
};

// Add to registry
const toolRegistry = new ToolRegistry();
toolRegistry.register(myTool);
```

## Framework Packages Used

This example demonstrates integration with:

- `@mcp-typescript-simple/tools` - Tool registry system
- `@mcp-typescript-simple/tools-llm` - LLM provider management
- `@mcp-typescript-simple/example-tools-basic` - Basic tool implementations
- `@mcp-typescript-simple/example-tools-llm` - LLM tool implementations
- `@mcp-typescript-simple/server` - MCP server setup
- `@mcp-typescript-simple/http-server` - HTTP transport layer
- `@mcp-typescript-simple/config` - Configuration management
- `@mcp-typescript-simple/observability` - Logging and telemetry

## Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm test -- --watch

# Type checking
npm run typecheck

# Linting
npm run lint
```

## Deployment

See the main [deployment documentation](../../docs/deployment/) for:
- Docker deployment
- Vercel serverless deployment
- Environment configuration
- Production best practices

## Learn More

- [Framework Documentation](../../README.md)
- [Creating Custom Tools](../../docs/creating-tools.md)
- [MCP Specification](https://modelcontextprotocol.io/)
- [TypeScript Best Practices](../../docs/typescript-patterns.md)

## License

MIT
