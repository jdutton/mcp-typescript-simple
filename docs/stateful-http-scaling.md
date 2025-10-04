# Horizontal Scalability for Stateful Streamable HTTP

## Research Summary

After extensive research into the MCP SDK issue #843 and real-world implementations, this document outlines the fundamental challenge and viable architectural approaches for achieving horizontal scalability with stateful streamable HTTP transport.

## The Core Problem

**StreamableHTTPServerTransport is inherently non-serializable:**
- Contains live HTTP response objects (Node.js streams)
- Has active event handlers and callbacks
- Maintains in-memory protocol state
- Cannot be serialized to Redis/external storage
- **This is a fundamental SDK design limitation affecting ALL MCP TypeScript projects**

### Issue Reference

- **GitHub Issue**: [modelcontextprotocol/typescript-sdk#843](https://github.com/modelcontextprotocol/typescript-sdk/issues/843)
- **Problem Statement**: "Pick-your-poison scenario - stateful mode prevents horizontal scalability, stateless mode requires giving up features like sampling, elicitation, and progress reporting"

## What Others Have Done

### 1. Yigitkonur's Stateful Redis Example (Recommended)

**Repository**: [yigitkonur/example-mcp-server-streamable-http](https://github.com/yigitkonur/example-mcp-server-streamable-http)

- **Architecture**: Store session metadata in Redis, NOT transport objects
- **Pattern**: Just-in-time server + transport reconstruction per request
- **Key Insight**: Each request reconstructs Server + Transport from persistent metadata
- **Result**: Any server instance can handle any session ID

**Implementation Pattern**:
```typescript
async function getOrCreateInstances(sessionId: string) {
  // 1. Check local cache first
  let instances = sessionInstances.get(sessionId);
  if (instances) return instances;

  // 2. Verify session exists in persistent store
  const sessionData = await sessionStore.get(sessionId);
  if (!sessionData) {
    throw new SessionNotFoundError('Session does not exist', { sessionId });
  }

  // 3. Reconstruct instances from persistent state
  console.log(`Reconstructing instances for session ${sessionId}`);
  // Reconstruction logic...

  return instances;
}
```

**Critical Initialization Order**:
```typescript
// 1. Generate session ID
const newSessionId = randomUUID();

// 2. Create initial session data
const sessionData = createNewSessionData();

// 3. Persist session data FIRST
await sessionStore.set(newSessionId, sessionData);

// 4. Now safely create McpServer instance
const server = await createMCPServer(newSessionId);
```

### 2. MCP SDK Stateless Mode (Simple but Limited)

**Repository**: [yigitkonur/example-mcp-server-streamable-http-stateless](https://github.com/yigitkonur/example-mcp-server-streamable-http-stateless)

- Create fresh Server + Transport for EVERY request
- No session persistence between requests
- Higher memory/CPU overhead
- **Loses MCP features**: sampling, elicitation, progress reporting

**When to Use**: Simple deployments where MCP protocol features aren't required

### 3. Sticky Sessions (Traditional but Problematic)

- Load balancer routes clients to same server instance (session affinity)
- Works but defeats horizontal scalability
- Pod restarts lose sessions
- Not suitable for serverless environments (Vercel, AWS Lambda)

**Configuration Examples**:

**Nginx**:
```nginx
upstream mcp_servers {
    ip_hash;
    server 10.0.0.1:3000;
    server 10.0.0.2:3000;
}
```

**Kubernetes**:
```yaml
apiVersion: v1
kind: Service
metadata:
  name: mcp-service
spec:
  sessionAffinity: ClientIP
  sessionAffinityConfig:
    clientIP:
      timeoutSeconds: 10800  # 3 hours
```

## Current Architecture Analysis

### Strengths

✅ Already have store abstraction pattern (`OAuthSessionStore`, `EventStore`)
✅ Vercel KV integration exists for OAuth sessions
✅ Factory pattern for switching between memory/Redis
✅ Session cleanup and TTL handling
✅ Comprehensive observability infrastructure

### Current Limitation

❌ `sessionTransports: Map<string, StreamableHTTPServerTransport>` stored in memory only (src/server/streamable-http-server.ts:55)
❌ Works perfectly for single instance, breaks on multiple instances/serverless cold starts
❌ Vercel serverless function uses global `transportCache` (api/mcp.ts:24) - lost on cold starts

### Current Implementation

**Express Server** (src/server/streamable-http-server.ts):
```typescript
private sessionTransports: Map<string, StreamableHTTPServerTransport> = new Map();

private async getOrCreateTransport(req: Request, requestId: string): Promise<StreamableHTTPServerTransport> {
  const existingSessionId = req.headers['mcp-session-id'] as string;
  const existingTransport = existingSessionId ? this.sessionTransports.get(existingSessionId) : undefined;

  if (existingTransport) {
    logger.debug("Reusing existing transport for session", { requestId, sessionId: existingSessionId });
    return existingTransport;
  }

  // Create new transport...
}
```

**Vercel Serverless** (api/mcp.ts):
```typescript
const transportCache = new Map<string, StreamableHTTPServerTransport>();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cachedTransport = sessionId ? transportCache.get(sessionId) : undefined;

  if (cachedTransport) {
    logger.debug("Reusing cached transport for session", { sessionId, requestId });
    transport = cachedTransport;
  } else {
    // Create new transport and server...
  }
}
```

## Recommended Solution: Hybrid Reconstruction Pattern

### Architecture Decision

**Store session METADATA in Redis, reconstruct Server + Transport on-demand**

### Data Model

```typescript
/**
 * Session metadata stored in Redis (serializable)
 */
interface MCPSessionMetadata {
  sessionId: string;
  authInfo?: AuthInfo;
  createdAt: number;
  lastActivity: number;
  metadata?: Record<string, unknown>;
  // Event history for resumability
  events?: SerializedEvent[];
}

/**
 * Server instance in memory (non-serializable)
 */
interface MCPServerInstance {
  server: Server;
  transport: StreamableHTTPServerTransport;
  sessionId: string;
  lastUsed: number;
}

/**
 * Serialized event for storage
 */
interface SerializedEvent {
  eventId: string;
  streamId: string;
  message: JSONRPCMessage;
  timestamp: number;
}
```

### Key Pattern: Just-In-Time Reconstruction

```typescript
/**
 * Get or recreate MCP server instance for session
 *
 * This pattern enables horizontal scalability by:
 * 1. Checking local instance cache (fast path)
 * 2. Verifying session exists in Redis (authoritative source)
 * 3. Reconstructing Server + Transport from metadata
 * 4. Restoring event history for resumability
 */
async function getOrRecreateServerInstance(sessionId: string): Promise<MCPServerInstance> {
  // 1. Check local cache (warm path - same instance)
  let instance = localInstanceCache.get(sessionId);
  if (instance) {
    instance.lastUsed = Date.now();
    return instance;
  }

  // 2. Verify session exists in Redis (authoritative source)
  const metadata = await sessionMetadataStore.get(sessionId);
  if (!metadata) {
    throw new SessionNotFoundError(`Session ${sessionId} not found`);
  }

  // 3. Reconstruct server + transport from metadata
  logger.info("Reconstructing MCP server instance", { sessionId });

  const server = await createMCPServer();
  const transport = createTransportWithSessionId(sessionId, metadata);
  await server.connect(transport);

  // 4. Restore event history if resumability enabled
  if (metadata.events && metadata.events.length > 0) {
    await restoreEventHistory(transport, metadata.events);
    logger.debug("Event history restored", {
      sessionId,
      eventCount: metadata.events.length
    });
  }

  // 5. Cache locally for subsequent requests
  const instance: MCPServerInstance = {
    server,
    transport,
    sessionId,
    lastUsed: Date.now()
  };
  localInstanceCache.set(sessionId, instance);

  return instance;
}

/**
 * Create transport with existing session ID
 * (skips session ID generation, uses provided ID)
 */
function createTransportWithSessionId(
  sessionId: string,
  metadata: MCPSessionMetadata
): StreamableHTTPServerTransport {
  return new StreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId, // Return existing session ID
    onsessioninitialized: async (sid: string) => {
      logger.debug("Transport initialized with existing session", { sessionId: sid });
      // Session already exists in Redis, just update lastActivity
      await sessionMetadataStore.updateActivity(sid);
    },
    onsessionclosed: async (sid: string) => {
      logger.info("Transport session closed", { sessionId: sid });
      // Remove from local cache and Redis
      localInstanceCache.delete(sid);
      await sessionMetadataStore.delete(sid);
    },
    enableJsonResponse: EnvironmentConfig.get().MCP_LEGACY_CLIENT_SUPPORT,
    eventStore: createRedisEventStore(sessionId), // Redis-backed event store
    allowedOrigins: process.env.ALLOWED_ORIGINS?.split(','),
    allowedHosts: process.env.ALLOWED_HOSTS?.split(','),
  });
}
```

### Store Interface

```typescript
/**
 * MCP Session Metadata Store Interface
 * (mirrors OAuthSessionStore pattern)
 */
export interface MCPSessionMetadataStore {
  /**
   * Store session metadata by session ID
   */
  storeSession(sessionId: string, metadata: MCPSessionMetadata): Promise<void>;

  /**
   * Retrieve session metadata by session ID
   */
  getSession(sessionId: string): Promise<MCPSessionMetadata | null>;

  /**
   * Update last activity timestamp
   */
  updateActivity(sessionId: string): Promise<void>;

  /**
   * Delete session metadata by session ID
   */
  deleteSession(sessionId: string): Promise<void>;

  /**
   * Clean up expired sessions
   * @returns Number of sessions cleaned up
   */
  cleanup(): Promise<number>;

  /**
   * Get the number of active sessions (for monitoring)
   */
  getSessionCount(): Promise<number>;

  /**
   * Dispose of resources (cleanup timers, connections, etc.)
   */
  dispose(): void;
}
```

## Implementation Plan

### Phase 1: Core Infrastructure (1-2 days)

**Files to Create:**
- `src/session/metadata-store-interface.ts` - Interface definition
- `src/session/memory-metadata-store.ts` - In-memory implementation (existing behavior)
- `src/session/vercel-kv-metadata-store.ts` - Redis-backed implementation
- `src/session/metadata-store-factory.ts` - Factory with auto-detection

**Tasks:**
1. Create `MCPSessionMetadataStore` interface (mirror OAuthSessionStore pattern)
2. Implement `MemorySessionMetadataStore` (existing behavior)
3. Implement `VercelKVSessionMetadataStore` (Redis-backed)
4. Add `SessionMetadataStoreFactory` with auto-detection
5. Add unit tests for all store implementations

### Phase 2: Reconstruction Logic (2-3 days)

**Files to Modify:**
- `src/server/streamable-http-server.ts` - Update to use reconstruction pattern
- `api/mcp.ts` - Update Vercel handler to use reconstruction pattern
- `src/server/mcp-setup.ts` - Extract server creation logic

**Tasks:**
1. Extract server instance creation to `createMCPServerInstance()`
2. Implement `getOrRecreateServerInstance()` with metadata lookup
3. Add local instance cache with TTL (5-10 minutes)
4. Update `streamable-http-server.ts` to use reconstruction pattern
5. Update `api/mcp.ts` (Vercel) to use reconstruction pattern
6. Add cache eviction for expired local instances

### Phase 3: Event Resumability (2-3 days)

**Files to Create:**
- `src/session/redis-event-store.ts` - Redis-backed EventStore implementation

**Files to Modify:**
- `src/session/event-store.ts` - Add event serialization utilities

**Tasks:**
1. Create `RedisEventStore` implementing `EventStore` interface
2. Store events in Redis with session ID prefix (`mcp:events:{sessionId}:{eventId}`)
3. Implement event replay during reconstruction
4. Add event TTL matching session timeout
5. Add tests for cross-instance event resumption

### Phase 4: Testing & Validation (2-3 days)

**Files to Create:**
- `test/unit/session/metadata-store.test.ts` - Unit tests for metadata stores
- `test/integration/multi-instance.test.ts` - Multi-instance simulation tests
- `test/system/horizontal-scaling.system.test.ts` - End-to-end scaling tests

**Tasks:**
1. Unit tests for metadata stores (memory and Redis)
2. Integration tests simulating multi-instance scenarios
3. Load testing with session distribution across instances
4. Vercel cold-start testing (session survives function restart)
5. Event resumability tests (reconnection after disconnect)

### Phase 5: Documentation & ADR (1 day)

**Files to Create:**
- `docs/adr/003-horizontal-scaling-architecture.md` - Architectural decision record

**Files to Modify:**
- `docs/session-management.md` - Update with new patterns
- `CLAUDE.md` - Update project architecture section
- `README.md` - Update deployment options

**Tasks:**
1. Create ADR-003 documenting this architectural decision
2. Update session-management.md with new patterns
3. Add deployment guide for Redis-backed scaling
4. Update CLAUDE.md with new architecture
5. Add troubleshooting guide for multi-instance deployments

## Benefits

✅ **True Horizontal Scalability**: Any instance handles any session
✅ **Serverless Compatible**: Survives Vercel cold starts and function restarts
✅ **Backward Compatible**: Works with existing single-instance deployments (memory store)
✅ **Resumability Preserved**: Event history stored in Redis for reconnection
✅ **Minimal SDK Changes**: Works within MCP SDK constraints (no SDK modifications needed)
✅ **Cost Effective**: Only stores lightweight metadata, not full transport objects
✅ **Proven Pattern**: Based on successful community implementations

## Trade-offs

⚠️ **Reconstruction Overhead**: Each request to new instance recreates Server + Transport (~10-50ms)
⚠️ **Redis Dependency**: Production horizontal scaling requires Redis/Vercel KV
⚠️ **Event Storage**: Resumability requires storing full event history (can be large)
⚠️ **Cache Invalidation**: Need to handle instance cache TTL carefully to prevent memory leaks
⚠️ **Complexity**: More moving parts than pure in-memory solution

## Alternative: Pure Stateless Mode (Simpler but Limited)

If you want to avoid complexity and don't need MCP protocol features:

**Implementation:**
```typescript
// Create fresh Server + Transport for EVERY request
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // No session caching - always create new
  const server = await createMCPServer();
  const transport = new StreamableHTTPServerTransport({
    // Minimal config, no session management
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
```

**Pros:**
- Simpler code (no Redis, no reconstruction logic)
- No session state to manage
- Works in any environment

**Cons:**
- Higher resource usage (recreate everything per request)
- Loses sampling, elicitation, progress reporting
- No resumability after disconnect
- Not suitable for long-running tool executions

## Recommendation

Implement the **Hybrid Reconstruction Pattern** because:

1. **Aligns with existing architecture**: Leverages your store abstraction pattern
2. **Leverages existing infrastructure**: Uses Vercel KV you already have for OAuth
3. **True horizontal scalability**: Any instance, any session
4. **Maintains MCP features**: Sampling, elicitation, progress reporting preserved
5. **Proven pattern**: Based on successful community implementation (yigitkonur)
6. **Future-proof**: Scales from single instance to multi-region deployment

## Estimated Timeline

- **Phase 1**: 1-2 days (Core Infrastructure)
- **Phase 2**: 2-3 days (Reconstruction Logic)
- **Phase 3**: 2-3 days (Event Resumability)
- **Phase 4**: 2-3 days (Testing & Validation)
- **Phase 5**: 1 day (Documentation & ADR)

**Total**: 8-11 days for complete implementation and testing

## References

- **MCP SDK Issue**: [#843 - Horizontal scalability for stateful streamable HTTP](https://github.com/modelcontextprotocol/typescript-sdk/issues/843)
- **Related Issue**: [#330 - Both SSE and StreamableHttp transport require sticky sessions](https://github.com/modelcontextprotocol/typescript-sdk/issues/330)
- **Python SDK Issue**: [#880 - How to build session persistence in streamable http MCP server](https://github.com/modelcontextprotocol/python-sdk/issues/880)
- **Community Implementation**: [yigitkonur/example-mcp-server-streamable-http](https://github.com/yigitkonur/example-mcp-server-streamable-http)
- **Stateless Example**: [yigitkonur/example-mcp-server-streamable-http-stateless](https://github.com/yigitkonur/example-mcp-server-streamable-http-stateless)
- **Socket.io Pattern**: [Redis adapter for horizontal scaling](https://socket.io/docs/v4/redis-adapter/)
- **MCPcat Guide**: [StreamableHTTP for Scalable MCP Deployments](https://mcpcat.io/guides/setting-up-streamablehttp-scalable-deployments/)

## Next Steps

1. Review this plan with team
2. Decide on implementation approach (Hybrid vs Stateless)
3. Create feature branch: `feature/horizontal-scaling`
4. Begin Phase 1 implementation
5. Iterate with testing and validation at each phase
