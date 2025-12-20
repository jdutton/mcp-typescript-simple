# Getting Started with mcp-typescript-simple

Welcome to `@mcp-typescript-simple` - a production-ready framework for building Model Context Protocol (MCP) servers in TypeScript.

## What is mcp-typescript-simple?

A complete framework that provides:

- ✅ **Dual Transport Modes**: STDIO (traditional) and Streamable HTTP
- ✅ **OAuth Authentication**: Multi-provider support (Google, GitHub, Microsoft)
- ✅ **LLM Integration**: Claude, OpenAI, and Gemini with type-safe providers
- ✅ **Horizontal Scaling**: Redis-backed session management
- ✅ **Production Deployment**: Docker and Vercel serverless ready
- ✅ **Scaffolding Tool**: Generate working servers in seconds
- ✅ **Complete Testing**: Unit, integration, and system test suite
- ✅ **Validation Pipeline**: Fast, cached validation with vibe-validate

## Quick Start

### Create a New MCP Server

```bash
npm create @mcp-typescript-simple@latest my-server
cd my-server
npm install
```

### Start Development

```bash
# STDIO mode (recommended for local testing)
npm run dev:stdio

# HTTP mode (web/API access)
npm run dev:http

# With OAuth authentication
npm run dev:oauth
```

### Test Your Server

```bash
# Run tests
npm test

# Full validation (required before commit)
npm run validate
```

## Generated Project Structure

```
my-server/
├── src/
│   ├── index.ts              # Main entry point
│   ├── config.ts             # Configuration
│   └── tools/                # MCP tools (your logic here!)
│       ├── index.ts          # Tool registry
│       ├── hello.ts          # Example: Basic tool
│       └── echo.ts           # Example: Echo tool
├── test/
│   ├── unit/                 # Unit tests
│   └── system/               # System/integration tests
├── .env.example              # Environment configuration template
├── docker-compose.yml        # Docker deployment
├── Dockerfile                # Container definition
├── vibe-validate.config.yaml # Validation pipeline
├── CLAUDE.md                 # Claude Code guidance
└── README.md                 # Project documentation
```

## Core Concepts

### 1. Transport Modes

**STDIO Mode:**
- Traditional MCP transport (stdin/stdout)
- Best for: MCP Inspector, desktop clients
- Server instance: Long-lived
- Session: Implicit

**HTTP Mode:**
- Modern web/API transport
- Best for: Web apps, cloud deployments, horizontal scaling
- Server instance: Per-request (stateless)
- Session: Header-based (`mcp-session-id`)

**Key difference:** HTTP mode requires special handling for tool persistence. See [Tool Registry for HTTP Mode](./03-tool-registry-http-mode.md).

### 2. Tool Registry

The tool registry manages your MCP tools:

```typescript
import { ToolRegistry } from '@mcp-typescript-simple/tools';

const toolRegistry = new ToolRegistry();
toolRegistry.register(helloTool);
toolRegistry.register(echoTool);
```

**CRITICAL for HTTP mode:** Must pass toolRegistry to transport initialization:

```typescript
await transportManager.initialize(server, toolRegistry);
                                          ^^^^^^^^^^^^^
                                          Required for HTTP mode!
```

**Why?** HTTP mode creates fresh server instances per request. The tool registry enables tool re-registration during session reconstruction.

**See:** [Tool Registry for HTTP Mode](./03-tool-registry-http-mode.md)

### 3. Session Management

**STDIO Mode:** Sessions are implicit (long-lived connection)

**HTTP Mode:** Sessions are explicit (header-based):

```bash
# Initialize session
curl -i http://localhost:3000/mcp -d '{"method":"initialize",...}'
# Extract: mcp-session-id: <uuid> from headers

# Subsequent requests
curl http://localhost:3000/mcp \
  -H 'mcp-session-id: <uuid>' \
  -d '{"method":"tools/list",...}'
```

**Key Point:** Session ID is in HTTP **headers**, not JSON body!

**See:** [HTTP Session Management](./02-http-session-management.md)

### 4. Configuration

Framework uses environment variables for configuration:

```bash
# .env
MCP_MODE=streamable_http      # Transport mode
HTTP_PORT=3000                # HTTP server port
TOKEN_ENCRYPTION_KEY=xxx      # Required for token storage
REDIS_URL=redis://...         # Optional: Redis for horizontal scaling
```

**Before first run:** Copy `.env.example` to `.env`

## Development Workflow

### 1. Create New Tool

```typescript
// src/tools/my-tool.ts
import { type ToolDefinition } from '@mcp-typescript-simple/tools';
import { z } from 'zod';

export const myTool: ToolDefinition = {
  name: 'my-tool',
  description: 'What your tool does',
  inputSchema: z.object({
    input: z.string().describe('Input parameter'),
  }),
  execute: async (args) => {
    const { input } = args;
    return {
      content: [{ type: 'text', text: `Processed: ${input}` }],
    };
  },
};
```

### 2. Register Tool

```typescript
// src/tools/index.ts
import { myTool } from './my-tool.js';

toolRegistry.register(myTool);
```

### 3. Add Test

```typescript
// test/unit/tools/my-tool.test.ts
import { describe, test, expect } from 'vitest';
import { myTool } from '../../../src/tools/my-tool.js';

describe('myTool', () => {
  test('processes input', async () => {
    const result = await myTool.execute({ input: 'test' });
    expect(result.content[0].text).toBe('Processed: test');
  });
});
```

### 4. Validate

```bash
npm run validate
```

## Deployment Options

### Local Development

```bash
npm run dev:stdio    # STDIO mode
npm run dev:http     # HTTP mode (no auth)
npm run dev:oauth    # HTTP mode with OAuth
```

### Docker (Production-like)

```bash
docker-compose up
# Access: http://localhost:8080
```

Features:
- Nginx load balancer
- Redis session storage
- Multi-replica MCP servers
- Horizontal scaling ready

### Vercel Serverless

```bash
npm run build
vercel
```

Features:
- Auto-scaling serverless functions
- Global CDN distribution
- Built-in monitoring
- OAuth support

## Common Pitfalls

### ❌ Pitfall #1: Tools Vanish in HTTP Mode

**Symptom:** Tools work initially, then disappear after reconnection.

**Cause:** Missing toolRegistry in transport initialization.

**Fix:**
```typescript
await transportManager.initialize(server, toolRegistry);
```

**See:** [Tool Registry for HTTP Mode](./03-tool-registry-http-mode.md)

### ❌ Pitfall #2: Looking for Session ID in JSON Body

**Symptom:** Can't find session ID after initialize.

**Cause:** Looking in wrong place - it's in headers!

**Fix:**
```typescript
const sessionId = response.headers.get('mcp-session-id');
```

**See:** [HTTP Session Management](./02-http-session-management.md)

### ❌ Pitfall #3: Missing TOKEN_ENCRYPTION_KEY

**Symptom:** Runtime error at startup.

**Cause:** `.env` file not created from template.

**Fix:**
```bash
cp .env.example .env
```

### ❌ Pitfall #4: Port Conflicts

**Symptom:** "Address already in use" error.

**Cause:** Default port (3000) already used by another service.

**Fix:**
```bash
# .env
HTTP_PORT=3010  # Use non-conflicting port
```

## Getting Help

### Documentation

- **Framework Overview**: [README.md](../../README.md)
- **HTTP Session Management**: [02-http-session-management.md](./02-http-session-management.md)
- **Tool Registry Pattern**: [03-tool-registry-http-mode.md](./03-tool-registry-http-mode.md)
- **Session Persistence**: [session-management.md](../session-management.md)
- **OAuth Setup**: [oauth-setup.md](../oauth-setup.md)
- **Vercel Deployment**: [vercel-deployment.md](../vercel-deployment.md)

### Community

- **GitHub Issues**: [Report bugs](https://github.com/jdutton/mcp-typescript-simple/issues)
- **GitHub Discussions**: [Ask questions](https://github.com/jdutton/mcp-typescript-simple/discussions)
- **Example Projects**: Check `examples/` directory

### Generated Project Help

Each scaffolded project includes:

- **CLAUDE.md**: Comprehensive Claude Code guidance
- **README.md**: Project-specific documentation
- **.env.example**: Configuration template with comments

## Next Steps

### New Users

1. ✅ Create your first server: `npm create @mcp-typescript-simple@latest`
2. ✅ Read generated CLAUDE.md
3. ✅ Start development: `npm run dev:stdio`
4. ✅ Create your first custom tool
5. ✅ Run tests: `npm run validate`

### Intermediate Users

1. ✅ Deploy with Docker: `docker-compose up`
2. ✅ Configure OAuth authentication
3. ✅ Add LLM-powered tools
4. ✅ Set up Redis for horizontal scaling

### Advanced Users

1. ✅ Deploy to Vercel serverless
2. ✅ Implement custom storage backends
3. ✅ Add observability (OpenTelemetry)
4. ✅ Build multi-region deployments

## Framework Architecture

### Package Structure

The framework is organized as npm workspace packages:

- `@mcp-typescript-simple/config` - Environment configuration
- `@mcp-typescript-simple/tools` - Tool registry and definitions
- `@mcp-typescript-simple/tools-llm` - LLM-powered tools
- `@mcp-typescript-simple/server` - MCP server setup
- `@mcp-typescript-simple/http-server` - HTTP transport
- `@mcp-typescript-simple/auth` - OAuth providers
- `@mcp-typescript-simple/persistence` - Storage backends
- `@mcp-typescript-simple/observability` - Logging and metrics
- `@mcp-typescript-simple/testing` - Test utilities

### Key Design Principles

1. **Graceful Degradation**: Works without API keys (basic tools only)
2. **Progressive Enhancement**: Add features (OAuth, LLM, Redis) as needed
3. **Type Safety**: Full TypeScript support with strict mode
4. **Modularity**: Use only the packages you need
5. **Production Ready**: Battle-tested patterns and error handling

## Summary

**Key Takeaways:**

- ✅ Use scaffolding tool to generate working servers
- ✅ HTTP mode requires toolRegistry in transport initialization
- ✅ Session IDs are in headers, not JSON body
- ✅ Copy `.env.example` to `.env` before first run
- ✅ Use Redis for production (horizontal scaling)
- ✅ Run `npm run validate` before committing

**Quick Commands:**

```bash
# Create server
npm create @mcp-typescript-simple@latest my-server

# Development
npm run dev:stdio          # STDIO mode
npm run dev:http           # HTTP mode
npm run dev:oauth          # HTTP + OAuth

# Testing
npm test                   # Unit tests
npm run validate           # Full validation

# Deployment
docker-compose up          # Docker
vercel                     # Vercel serverless
```

---

**Ready to build?** Start with: `npm create @mcp-typescript-simple@latest`

**Need help?** Check the [documentation](../../README.md) or ask in [GitHub Discussions](https://github.com/jdutton/mcp-typescript-simple/discussions).
