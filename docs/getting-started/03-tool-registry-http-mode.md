# Tool Registry for HTTP Mode

## The Problem

**Symptom:** Tools work initially but disappear after session reconnection in HTTP mode.

**Error Messages:**
- `tools/list` returns empty array after session resume
- "Server not initialized" errors
- Tools that worked before suddenly vanish

## Root Cause: Server Lifecycle Differences

The MCP SDK creates server instances differently depending on transport mode:

### STDIO Mode (Simple)
```
┌──────────────────────────────┐
│  MCP Server Instance         │
│  - Created once at startup   │
│  - Lives entire process life │
│  - Tools registered once     │
└──────────────────────────────┘
```

**STDIO behavior:**
- Server created once when process starts
- Tools registered once during initialization
- Same server instance handles all requests
- Tools persist automatically ✅

### HTTP Mode (Complex)
```
Request 1:
┌──────────────────────────────┐
│  MCP Server Instance A       │
│  - Created for this request  │
│  - Must reconstruct session  │
│  - Destroyed after response  │
└──────────────────────────────┘

Request 2 (same session):
┌──────────────────────────────┐
│  MCP Server Instance B       │
│  - NEW instance created      │
│  - Must load session from ID │
│  - Needs tools re-registered │
└──────────────────────────────┘
```

**HTTP behavior:**
- Fresh server instance created for **each request**
- Session metadata loaded from storage (Redis/memory)
- Tools must be **re-registered** for each instance
- Without tool registry, tools vanish ❌

## The Solution: Pass ToolRegistry to Transport

### ❌ WRONG (Tools will vanish)

```typescript
// src/index.ts
const server = new Server({...});
const toolRegistry = new ToolRegistry();

// Register tools
toolRegistry.register(helloTool);
toolRegistry.register(echoTool);

// Setup server
await setupMCPServerWithRegistry(server, toolRegistry, logger);

// Initialize transport - MISSING toolRegistry!
const transportManager = TransportFactory.createFromEnvironment();
await transportManager.initialize(server);  // ❌ Tools will vanish!
```

**What happens:**
1. Initial request: Tools work (server has them)
2. Subsequent requests: New server instance created
3. Session metadata loaded (session ID, client info)
4. **Tools NOT re-registered** → empty tool list
5. `tools/list` returns `[]`

### ✅ CORRECT (Tools persist)

```typescript
// src/index.ts
const server = new Server({...});
const toolRegistry = new ToolRegistry();

// Register tools
toolRegistry.register(helloTool);
toolRegistry.register(echoTool);

// Setup server
await setupMCPServerWithRegistry(server, toolRegistry, logger);

// Initialize transport - PASS toolRegistry!
const transportManager = TransportFactory.createFromEnvironment();
await transportManager.initialize(server, toolRegistry);  // ✅ Tools persist!
                                          ^^^^^^^^^^^^^
                                          CRITICAL!
```

**What happens:**
1. Initial request: Tools work (server has them)
2. Subsequent requests: New server instance created
3. Session metadata loaded (session ID, client info)
4. **Tools re-registered automatically** from toolRegistry
5. `tools/list` returns full tool list ✅

## How It Works Under the Hood

The `@mcp-typescript-simple/http-server` package handles session reconstruction:

```typescript
// Simplified internal logic
class StreamableHTTPTransport {
  async handleRequest(req, res) {
    const sessionId = req.headers['mcp-session-id'];

    if (sessionId) {
      // Reconstruct session
      const session = await this.sessionStore.load(sessionId);

      // Re-register tools if toolRegistry provided
      if (this.toolRegistry) {
        const tools = this.toolRegistry.list();
        for (const tool of tools) {
          this.server.setRequestHandler(
            ListToolsRequestSchema,
            async () => ({ tools })
          );
          // ... register tool execution handlers
        }
      }
    }
  }
}
```

**Key insight:** The transport layer needs the tool registry to reconstruct the full server state, not just session metadata.

## Why This Isn't Needed in STDIO Mode

STDIO mode uses a long-lived server instance:

```typescript
// STDIO transport (simplified)
class STDIOTransport {
  async start(server) {
    // Server instance created ONCE
    // Tools registered ONCE during initialization
    // Same instance handles all requests

    process.stdin.on('data', async (data) => {
      await this.server.handleRequest(data);
      // Same server every time ✅
    });
  }
}
```

No session reconstruction needed → tools persist automatically.

## Troubleshooting

### Symptom: "Tools vanish on session reconnection"

**Check your code:**

```typescript
// Find this line in src/index.ts
await transportManager.initialize(server, toolRegistry);
                                          ^^^^^^^^^^^^^
                                          Is this here?
```

**If toolRegistry is missing:**
1. Add it to the `initialize()` call
2. Restart server: `npm run dev:http`
3. Test session reconnection

### Symptom: "Server not initialized" errors

This usually means:
1. Missing `mcp-session-id` header in requests, OR
2. Missing `toolRegistry` in transport initialization

**Fix:**
- Ensure session ID is passed in headers (not body)
- Ensure toolRegistry passed to `transportManager.initialize()`

### Symptom: Tools work in STDIO but not HTTP

This confirms the issue - STDIO mode doesn't need toolRegistry passed, but HTTP mode does.

**Fix:** Pass toolRegistry to HTTP transport initialization.

## Testing Session Reconstruction

```bash
# Start server in HTTP mode
npm run dev:http

# Terminal 1: Initialize session
curl -i -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}'

# Extract mcp-session-id from headers
# Example: mcp-session-id: 550e8400-e29b-41d4-a716-446655440000

# Terminal 2: List tools using session (NEW server instance!)
curl -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'mcp-session-id: 550e8400-e29b-41d4-a716-446655440000' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2}'

# ✅ Should return full tool list
# ❌ If empty array, toolRegistry not passed to transport
```

## Best Practices

### 1. Always pass toolRegistry in HTTP mode

```typescript
// REQUIRED for HTTP mode
await transportManager.initialize(server, toolRegistry);
```

### 2. Register all tools before transport initialization

```typescript
// Register ALL tools first
toolRegistry.merge(basicTools);
toolRegistry.merge(llmTools);

// THEN initialize transport
await transportManager.initialize(server, toolRegistry);
```

### 3. Don't modify toolRegistry after transport starts

```typescript
// ❌ BAD - Tools won't be available in reconstructed sessions
await transportManager.initialize(server, toolRegistry);
toolRegistry.register(lateTool);  // Won't be in session reconstruction!

// ✅ GOOD - All tools registered before transport starts
toolRegistry.register(allTools);
await transportManager.initialize(server, toolRegistry);
```

## Related Documentation

- [HTTP Session Management](./02-http-session-management.md) - How HTTP sessions work
- [Session Management Guide](../session-management.md) - Redis persistence and horizontal scaling
- [Transport Architecture](../architecture/transports.md) - Deep dive on transport layer

## Summary

**Key Takeaway:** HTTP mode creates fresh server instances per request. Pass `toolRegistry` to `transportManager.initialize()` so tools can be re-registered during session reconstruction.

**Quick Fix:**
```typescript
// Add toolRegistry parameter
await transportManager.initialize(server, toolRegistry);
                                          ^^^^^^^^^^^^^
```

**Why It Matters:** Without this, tools work initially but vanish on subsequent requests, breaking MCP client functionality.
