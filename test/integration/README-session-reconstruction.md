# Session Reconstruction Integration Tests

## Overview

The `session-reconstruction.test.ts` file contains comprehensive integration tests for the horizontal scalability feature that enables session recovery across server instances and cold starts.

## What These Tests Validate

### 1. **Basic Session Creation and Resumption**
- ✅ Session ID is returned in headers after initialization
- ✅ Session ID can be used in subsequent requests
- ✅ Invalid session IDs are rejected

### 2. **Session Reconstruction After Cache Clear**
This is the **core horizontal scalability test** that simulates:
- **Serverless cold starts** - function instance restarts with empty cache
- **Multi-instance deployments** - different server instances handling same session
- **Cache eviction** - sessions older than 10-minute TTL

**How it works:**
```typescript
// 1. Create session
const sessionId = initializeSession();

// 2. Use session successfully
callTool(sessionId); // Works ✅

// 3. Simulate cold start by clearing instance cache
instanceManager.instanceCache.clear();

// 4. Use session again - should reconstruct from metadata
callTool(sessionId); // Should still work ✅
```

### 3. **Multi-Tool Execution After Reconstruction**
Verifies that **all tools work correctly** after reconstruction:
- hello tool
- echo tool
- current-time tool

This ensures the server reconstruction properly registers all tools.

### 4. **Concurrent Requests After Reconstruction**
Tests race conditions:
- Multiple requests arrive simultaneously to same reconstructed session
- First request reconstructs the instance
- Subsequent requests should reuse the reconstructed instance
- Only **one instance** should be cached (not multiple duplicates)

### 5. **Session Metadata Persistence**
Validates the metadata layer:
- Metadata survives instance cache clears
- `lastActivity` timestamp is updated
- `createdAt` timestamp is preserved
- Session ID remains consistent

### 6. **Error Cases**
Tests failure scenarios:
- Metadata deleted but cache exists
- Malformed session IDs
- Non-existent session IDs

## Running the Tests

```bash
# Run just these tests
npm test -- test/integration/session-reconstruction.test.ts

# Run with coverage
npm test -- test/integration/session-reconstruction.test.ts --coverage

# Run in watch mode
npm test -- test/integration/session-reconstruction.test.ts --watch
```

## What Would These Tests Have Caught?

### Bug #1: Double Connection
**Symptom**: "Transport already started" error

**Test that catches it**:
```typescript
it('should reconstruct session from metadata after instance cache clear')
```

This test would fail with:
```
Error: Transport already started
    at StreamableHTTPServerTransport.start
    at Server.connect
```

### Bug #2: Missing Server Connection
**Symptom**: Server not initialized

**Test that catches it**:
```typescript
it('should execute multiple different tools after reconstruction')
```

This test would fail because tools wouldn't be registered on the reconstructed server.

### Bug #3: Metadata Not Persisting
**Symptom**: Session lost after cache clear

**Test that catches it**:
```typescript
it('should persist session metadata across instance cache clears')
```

This test would fail with "Session not found" after clearing cache.

## Integration with CI/CD

These tests are included in:
- `npm test` - Full test suite
- `npm run test:integration` - Integration tests only
- `npm run test:ci` - CI pipeline validation

## Performance Considerations

These tests simulate:
- **Cold start latency**: First request after cache clear (~1-5ms reconstruction)
- **Warm cache latency**: Subsequent requests (<1ms from cache)
- **Concurrent reconstruction**: Multiple requests should share single reconstruction

## Related Files

- **Implementation**: `src/server/mcp-instance-manager.ts`
- **Express Integration**: `src/server/streamable-http-server.ts`
- **Metadata Store**: `src/session/memory-mcp-metadata-store.ts`
- **Unit Tests**: `test/unit/session/memory-mcp-metadata-store.test.ts`
- **Integration Tests**: `test/integration/mcp-horizontal-scaling.test.ts`

## Future Enhancements

Planned test additions:
- [ ] Redis integration tests (requires test infrastructure)
- [ ] Load testing with multiple concurrent sessions
- [ ] Session TTL expiration tests
- [ ] Auth info preservation after reconstruction
- [ ] Event store resumability tests (Phase 3)
