# BUG REPRODUCTION AND FIX: Transport State Not Set During Reconstruction

## Observed Behavior (FIXED)

When reconstructing a session, the MCP Inspector showed "Server not initialized" errors despite correct session ID:

```
[12:29:32] INFO: Reconstructing MCP server instance
    sessionId: "937e4604..."

[12:29:32] INFO: Before transport.handleRequest
    transportSessionId: "ce19f2a9-bf05-4c36-9360-757caabccb34"  ✅ Correct!
    statusCode: 400  ❌ Error: "Server not initialized"
```

## Root Causes (TWO BUGS FIXED)

### Bug 1: Session ID Not Set ✅ FIXED
In `mcp-instance-manager.ts:createTransportWithSessionId()`, we create a transport with a `sessionIdGenerator` that returns the existing session ID. However, the `sessionIdGenerator` is only called **during the initialize request**, not when the transport is created.

**Fix**: Set `transport.sessionId` directly after construction:
```typescript
(transport as any).sessionId = sessionId;
```

### Bug 2: Initialized Flag Not Set ✅ FIXED
The MCP SDK's `StreamableHTTPServerTransport` has an internal `_initialized` flag that tracks whether the initialize handshake has occurred. This flag is only set to `true` during actual initialize requests.

From the SDK source (`streamableHttp.js:442`):
```javascript
if (!this._initialized) {
  res.writeHead(400).end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Bad Request: Server not initialized"
    },
    id: null
  }));
  return false;
}
```

For reconstructed sessions, we never send an initialize request (the session is already initialized from a previous server instance), so `_initialized` remains `false`.

**Fix**: Set `transport._initialized` directly after construction:
```typescript
(transport as any)._initialized = true;
```

## Test-Driven Development Process

1. ✅ **Write failing test** (TDD requirement):
   - Added assertion in `mcp-horizontal-scaling.test.ts`
   - Test failed: `Expected: true, Received: false`

2. ✅ **Implement fix**:
   - Set both `sessionId` and `_initialized` properties
   - Added explanatory comments

3. ✅ **Verify test passes**:
   - All 13 tests in `mcp-horizontal-scaling.test.ts` pass

## Final Implementation

Location: `src/server/mcp-instance-manager.ts:171-172`

```typescript
// CRITICAL FIX: Set the transport's sessionId and _initialized properties directly
// The sessionIdGenerator callback and initialization flow are only invoked during
// initialize requests, but reconstructed sessions never receive initialize (already
// initialized). We must set these properties manually for the transport to work correctly.
(transport as any).sessionId = sessionId;
(transport as any)._initialized = true;
```

## Impact

This fix enables true horizontal scalability by allowing reconstructed sessions to work correctly with the MCP SDK's internal state machine. Sessions can now be reconstructed across different server instances without errors.
