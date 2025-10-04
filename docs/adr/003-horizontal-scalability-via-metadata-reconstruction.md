# ADR 003: Horizontal Scalability via Metadata Reconstruction

**Status**: Accepted

**Date**: 2025-10-03

**Context**: Issue #48

## Context

The MCP Streamable HTTP transport maintains non-serializable state (Server + Transport instances) that prevents sessions from being shared across multiple server instances. This limitation prevents horizontal scaling in serverless environments like Vercel, where requests may be handled by different function instances.

### Problem

1. **Non-Serializable Transport State**: `StreamableHTTPServerTransport` contains:
   - Live HTTP response objects
   - Active event handlers and streams
   - In-memory protocol state machines
   - Server instances with registered tools

2. **Serverless Cold Starts**: Vercel functions are stateless and ephemeral
   - Each request may hit a different instance
   - Instances can be terminated at any time
   - Session state must survive instance restarts

3. **Multi-Instance Deployments**:
   - Load balancers distribute requests across instances
   - Sessions must be accessible from any instance
   - No guarantee of request routing consistency

### Community Solution

The implementation follows the pattern from [Yigitkonur's Stateful Redis Example](https://github.com/yigitkonur/example-mcp-server-streamable-http):

> "The key insight is to store **serializable session metadata** in Redis while reconstructing **non-serializable Server + Transport instances** on-demand from that metadata."

## Decision

We implement a **hybrid reconstruction pattern** that separates concerns:

### 1. Metadata Layer (Persistent, Serializable)

Store lightweight session metadata in external storage:

```typescript
interface MCPSessionMetadata {
  sessionId: string;
  createdAt: number;
  lastActivity: number;
  authInfo?: {
    provider: string;
    userId?: string;
    email?: string;
  };
  events?: SerializedEvent[];  // For resumability (Phase 3)
}
```

**Storage Options** (auto-detected via factory):
- **Vercel KV** (Redis): For serverless deployments
- **Memory**: For local development and single-instance deployments

### 2. Instance Layer (Ephemeral, Non-Serializable)

Reconstruct Server + Transport on-demand:

```typescript
interface MCPServerInstance {
  server: Server;                        // MCP SDK server
  transport: StreamableHTTPServerTransport;  // Streamable HTTP transport
  sessionId: string;
  lastUsed: number;                      // For cache eviction
}
```

### 3. Manager Layer (Orchestration)

`MCPInstanceManager` coordinates reconstruction:

```typescript
class MCPInstanceManager {
  // Persistent metadata (Redis/Vercel KV)
  private metadataStore: MCPSessionMetadataStore;

  // Ephemeral cache (in-memory, per instance)
  private instanceCache: Map<string, MCPServerInstance>;

  async getOrRecreateInstance(sessionId: string): Promise<MCPServerInstance> {
    // 1. Check local cache (warm path)
    if (this.instanceCache.has(sessionId)) {
      return this.instanceCache.get(sessionId);
    }

    // 2. Verify session exists in Redis (authoritative source)
    const metadata = await this.metadataStore.getSession(sessionId);
    if (!metadata) throw new Error('Session not found');

    // 3. Reconstruct Server + Transport from metadata
    const instance = await this.createInstance(sessionId, metadata);

    // 4. Cache locally for subsequent requests
    this.instanceCache.set(sessionId, instance);

    return instance;
  }
}
```

## Architecture

### Request Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Client sends request with mcp-session-id header             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Vercel Function Instance A (or B, or C...)                  │
├─────────────────────────────────────────────────────────────┤
│ 1. MCPInstanceManager.getOrRecreateInstance(sessionId)      │
│    ├─ Check local cache (instance map)                      │
│    ├─ If miss: Fetch metadata from Vercel KV/Redis          │
│    ├─ Reconstruct Server + Transport                        │
│    └─ Cache instance locally                                │
│                                                              │
│ 2. Process request with reconstructed instance              │
│    └─ transport.handleRequest(req, res, body)               │
└─────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Vercel KV (Redis) - Authoritative Session State             │
├─────────────────────────────────────────────────────────────┤
│ Key: mcp:session:metadata:{sessionId}                        │
│ TTL: 30 minutes (automatic expiration)                      │
│ Value: {                                                     │
│   sessionId, createdAt, lastActivity,                       │
│   authInfo: { provider, userId, email }                     │
│ }                                                            │
└─────────────────────────────────────────────────────────────┘
```

### Cache Hierarchy

```
┌──────────────────────────────────────────────────────────────┐
│ Level 1: Instance Cache (In-Memory, Per-Instance)           │
├──────────────────────────────────────────────────────────────┤
│ • TTL: 10 minutes                                            │
│ • Scope: Single Vercel function instance                     │
│ • Contains: Server + Transport (non-serializable)           │
│ • Purpose: Avoid reconstruction overhead                     │
│ • Eviction: LRU + TTL-based cleanup every 5 minutes         │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼ (Cache miss)
┌──────────────────────────────────────────────────────────────┐
│ Level 2: Metadata Store (Vercel KV/Redis, Shared)           │
├──────────────────────────────────────────────────────────────┤
│ • TTL: 30 minutes                                            │
│ • Scope: Global (all function instances)                     │
│ • Contains: Session metadata (serializable)                  │
│ • Purpose: Authoritative session state                       │
│ • Eviction: Redis TTL-based automatic cleanup               │
└──────────────────────────────────────────────────────────────┘
```

## Consequences

### Positive

1. **Horizontal Scalability**
   - Any instance can handle any session
   - No session affinity required
   - Seamless load balancing

2. **Cold Start Survival**
   - Sessions survive function instance restarts
   - Metadata persists in Vercel KV/Redis
   - Instances reconstructed on-demand

3. **Development Experience**
   - Auto-detection of Vercel KV
   - Graceful fallback to memory store
   - No code changes required for deployment

4. **Performance Optimization**
   - Local instance cache (10 min TTL)
   - Avoids reconstruction overhead
   - Metadata queries only on cache miss

5. **Auth Preservation**
   - User authentication info stored in metadata
   - OAuth context available across instances
   - Secure session identity verification

### Negative

1. **Reconstruction Overhead**
   - First request to each instance pays reconstruction cost
   - ~1-5ms to create Server + Transport from metadata
   - Mitigated by 10-minute instance cache

2. **Metadata Storage Dependency**
   - Requires Vercel KV (Redis) for multi-instance
   - Additional infrastructure complexity
   - Monthly cost for Vercel KV (free tier available)

3. **State Limitations**
   - Only serializable data can be preserved
   - Complex in-memory state must be reconstructed
   - Tool state must be stateless or externalized

4. **Cache Invalidation**
   - Instance cache may serve stale data for up to 10 minutes
   - Session deletion requires waiting for cache TTL
   - Metadata updates may not propagate immediately

## Implementation Details

### Components Created

1. **`src/session/mcp-session-metadata-store-interface.ts`**
   - Interface for session metadata storage
   - Defines serializable session structure

2. **`src/session/memory-mcp-metadata-store.ts`**
   - In-memory implementation (local development)
   - 30-minute session timeout
   - Automatic cleanup every 5 minutes

3. **`src/session/vercel-kv-mcp-metadata-store.ts`**
   - Redis-backed implementation (production)
   - Vercel KV integration
   - Automatic TTL management

4. **`src/session/mcp-metadata-store-factory.ts`**
   - Auto-detection of environment
   - Factory pattern for store creation
   - Environment validation

5. **`src/server/mcp-instance-manager.ts`**
   - Just-in-time reconstruction logic
   - Local instance caching (10-minute TTL)
   - Cleanup timer for expired instances

6. **Integration Points**
   - `src/server/streamable-http-server.ts` (Express)
   - `api/mcp.ts` (Vercel serverless handler)

### Testing Coverage

- **Unit Tests**: 13 tests for metadata stores and factory
- **Integration Tests**: 13 tests for reconstruction pattern
  - Session metadata storage/retrieval
  - Instance reconstruction
  - Auth preservation
  - Multi-instance handoff simulation
  - Concurrent request handling
  - Cache behavior and TTL

## Alternatives Considered

### 1. Sticky Sessions (Load Balancer Affinity)

**Rejected**: Not available in Vercel serverless
- Vercel doesn't support session affinity
- Would require custom routing infrastructure
- Doesn't solve cold start problem

### 2. Serialize Entire Transport

**Rejected**: Transport contains non-serializable objects
- HTTP response streams
- Event emitters
- Active connections
- Too complex to serialize/deserialize

### 3. Proxy Pattern (Centralized State Server)

**Rejected**: Adds latency and single point of failure
- Every request requires network roundtrip
- Central server becomes bottleneck
- Defeats purpose of serverless scaling

### 4. Client-Side State Management

**Rejected**: Security and protocol violation
- Exposes server internals to client
- MCP protocol doesn't support client state
- Violates separation of concerns

## Future Enhancements (Phase 3)

### Redis-Backed Event Store

For full resumability across instances:

```typescript
interface RedisEventStore extends EventStore {
  // Store events in Redis with session prefix
  // Replay events during reconstruction
  // Enable GET requests to resume interrupted streams
}
```

This would allow:
- Stream resumption after instance restart
- Event replay for reconnecting clients
- Full protocol compliance with resumability

## References

- [Yigitkonur's Stateful Redis Example](https://github.com/yigitkonur/example-mcp-server-streamable-http)
- [MCP SDK v1.18.0 Documentation](https://github.com/modelcontextprotocol/typescript-sdk)
- [Vercel KV Documentation](https://vercel.com/docs/storage/vercel-kv)
- Issue #48: Implement horizontal scalability for Streamable HTTP transport

## Related ADRs

- [ADR 001: OAuth Client State Preservation](001-oauth-integration.md)
- [ADR 002: OAuth Client State Preservation](002-oauth-client-state-preservation.md)
