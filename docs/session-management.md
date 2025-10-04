# MCP Session Management Architecture

## Overview

The MCP TypeScript Simple server uses StreamableHTTPServerTransport for HTTP-based MCP protocol communication with **horizontal scalability** support via metadata-driven reconstruction. This document describes the session management architecture, scalability features, and deployment considerations.

## Session State Architecture

### Hybrid Reconstruction Pattern (v1.1.0+)

The server implements a **two-tier session management system** that enables horizontal scalability:

#### 1. Metadata Layer (Persistent, Serializable)
Session metadata is stored in external storage (Vercel KV/Redis):

```typescript
interface MCPSessionMetadata {
  sessionId: string;
  createdAt: number;
  lastActivity: number;
  authInfo?: {           // OAuth authentication preserved
    provider: string;
    userId?: string;
    email?: string;
  };
}
```

**Storage Options** (auto-detected):
- **Vercel KV** (Redis): For serverless/multi-instance deployments
- **Memory**: For local development and single-instance deployments

#### 2. Instance Layer (Ephemeral, Non-Serializable)
Server + Transport instances are reconstructed on-demand:

- **Transport objects contain non-serializable components**: HTTP response objects, event handlers, connection state
- **Instances are cached locally** (10-minute TTL) to avoid reconstruction overhead
- **Any instance can handle any session** via just-in-time reconstruction from metadata

### Session Lifecycle
1. **Initialization**: Client sends MCP `initialize` request
   - Server creates new StreamableHTTPServerTransport
   - Session metadata stored in Vercel KV/Redis (if available)
2. **Session ID**: Server generates UUID and returns in `mcp-session-id` header
3. **Subsequent Requests**: Client includes `mcp-session-id` header
   - Server checks local instance cache (10-min TTL)
   - On cache miss: Fetches metadata from Vercel KV/Redis
   - Reconstructs Server + Transport from metadata
   - Caches instance locally for future requests
4. **Cleanup**: Sessions can be terminated via `DELETE /mcp` endpoint or automatic timeout (30 minutes)

## Deployment Implications

### Single Instance Deployments ✅
**Works perfectly with automatic in-memory storage**
- Local development servers (`npm run dev:http`)
- Single container deployments
- Simple production environments
- **No configuration needed** - automatically uses memory store

### Vercel Serverless ✅
**Fully supported with Vercel KV**
- Horizontal auto-scaling across function instances
- Sessions survive cold starts and instance restarts
- Any function instance can handle any session
- **Setup**: Add Vercel KV integration (`vercel link` → add KV storage)

**How it works:**
```
Request → Vercel Function Instance A
  ├─ Check local cache (miss - cold start)
  ├─ Fetch metadata from Vercel KV
  ├─ Reconstruct Server + Transport
  └─ Process request

Request → Vercel Function Instance B (different instance)
  ├─ Check local cache (miss - first time)
  ├─ Fetch SAME metadata from Vercel KV
  ├─ Reconstruct Server + Transport
  └─ Process request successfully ✅
```

### Load Balanced Deployments ✅
**No sticky sessions required with Vercel KV/Redis**
- Multiple identical server instances
- Round-robin load balancing works perfectly
- Sessions accessible from any instance
- **Setup**: Configure `REDIS_URL` environment variable OR use Vercel KV

**Without external storage** (fallback to memory):
- **Requires sticky sessions** - clients must route to same instance
- Configure load balancer with session affinity using `mcp-session-id` header

### Container Orchestration ✅
**Kubernetes/Docker Swarm with horizontal scaling**
- Deploy with Vercel KV or Redis for session metadata
- No session affinity required
- Scale pods freely - sessions work across all pods
- **Setup**: Set `REDIS_URL` environment variable in pod spec

**Example Kubernetes Deployment:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-server
spec:
  replicas: 3  # Scale horizontally
  selector:
    matchLabels:
      app: mcp-server
  template:
    metadata:
      labels:
        app: mcp-server
    spec:
      containers:
      - name: mcp-server
        image: mcp-typescript-simple:latest
        env:
        - name: REDIS_URL
          value: "redis://redis-service:6379"
        # NO session affinity needed!
```

## Recommended Deployment Patterns

### 1. Development
**Single instance with automatic memory storage**
- `npm run dev:http` for local development
- Docker container for isolated development
- No special configuration needed - automatically uses memory store
- Perfect for development and testing

### 2. Production - Serverless (Vercel/AWS Lambda)
**Horizontal scaling with Vercel KV/Redis**
- Auto-scaling across multiple function instances
- Sessions accessible from any instance
- **Setup**: Add Vercel KV integration or configure `REDIS_URL`
- No sticky sessions required - requests can hit any instance
- Sessions survive cold starts and instance restarts

### 3. Production - Load Balanced (Kubernetes/Docker Swarm)
**Horizontal scaling with external metadata storage**
- Multiple identical server instances with round-robin load balancing
- Sessions accessible from any instance via Vercel KV/Redis
- **Setup**: Configure `REDIS_URL` environment variable
- No session affinity required - any instance can handle any session
- Scale pods/containers freely based on load

### 4. Production - Simple (Single Instance)
**Single instance with high availability backup**
- Primary instance with health monitoring
- Optional standby instance for failover
- Uses in-memory storage (no external dependencies)
- Regular health checks via `/health` endpoint

## Alternative Approaches (Legacy/Fallback)

### 1. Load Balancing Without External Storage
**Requires sticky sessions**
- Configure load balancer for session affinity using `mcp-session-id` header
- Each instance maintains its own in-memory session storage
- Requests must route to same instance for session continuity
- Less flexible than Vercel KV/Redis approach

### 2. Stateless Mode Implementation
**Not recommended - loses session benefits**
```typescript
// Create fresh server per request (no session persistence)
app.post('/mcp', async (req, res) => {
  const server = new Server(/* ... */);
  const transport = new StreamableHTTPServerTransport(/* ... */);
  await server.connect(transport);
  // Handle request and cleanup
});
```
- Higher overhead per request
- No session state between requests
- Higher memory and CPU usage

## Session Management API

### Session Initialization
```bash
POST /mcp
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {"name": "client", "version": "1.0.0"}
  }
}

# Response includes mcp-session-id header
mcp-session-id: 550e8400-e29b-41d4-a716-446655440000
```

### Session Usage
```bash
POST /mcp
Content-Type: application/json
mcp-session-id: 550e8400-e29b-41d4-a716-446655440000

{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

### Session Cleanup
```bash
DELETE /mcp
mcp-session-id: 550e8400-e29b-41d4-a716-446655440000

# Response
{
  "message": "Session successfully terminated",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "requestId": "req_1642251296789",
  "timestamp": "2024-01-15T12:34:56.789Z"
}
```

## Monitoring and Debugging

### Health Check Endpoint
```bash
GET /health

{
  "status": "healthy",
  "sessions": {
    "total": 10,
    "active": 2,
    "expired": 8
  },
  "memory": {
    "used": "45.2 MB",
    "free": "78.8 MB"
  }
}
```

### Session Debugging
- Monitor session count via `/health` endpoint
- Check server logs for session creation/cleanup
- Use `mcp-session-id` header for request tracing

## Performance Considerations

### Memory Usage
**Metadata Storage** (Vercel KV/Redis):
- Each session metadata record: ~500 bytes
- Minimal memory footprint on metadata store
- 30-minute TTL for automatic cleanup

**Instance Cache** (In-Memory):
- Each cached instance: ~1-5MB (depending on usage)
- 10-minute TTL for automatic cache eviction
- Only active sessions consume instance memory

### Concurrent Sessions
**With Vercel KV/Redis**:
- Virtually unlimited sessions (limited by Redis capacity)
- Scale horizontally by adding more server instances
- Each instance caches frequently-used sessions locally

**Single Instance** (Memory only):
- 100-1000+ concurrent sessions per instance
- Limited by available memory and CPU resources
- Suitable for development and small deployments

### Session Cleanup
- **Automatic metadata cleanup**: 30-minute TTL in Vercel KV/Redis
- **Automatic instance cleanup**: 10-minute TTL in local cache
- **Manual cleanup**: `DELETE /mcp` endpoint for explicit termination
- **Monitoring**: Track session count via `/health` endpoint

### Reconstruction Overhead
- **First request to instance**: 1-5ms reconstruction cost
- **Subsequent requests**: < 1ms (served from local cache)
- **Cache warming**: Instances cache on first access
- **Cold start impact**: Minimal - metadata fetched from Redis in ~1-2ms

## Session Recovery and Cold Starts

### Serverless Environment Behavior (With Vercel KV/Redis)

**With external metadata storage (v1.1.0+)**, sessions survive cold starts:

1. **Cold Start**: Function instance starts fresh with empty instance cache
2. **Session Preservation**: Metadata persists in Vercel KV/Redis
3. **Automatic Recovery**: Instance reconstructs Server + Transport from metadata
4. **Client Impact**: Transparent - clients see seamless operation
5. **Performance**: First request pays small reconstruction cost (~1-5ms)

**Example flow with Vercel KV:**
```
Request → Cold Start Function Instance
  ├─ Instance cache is empty (new instance)
  ├─ Fetch session metadata from Vercel KV ✅
  ├─ Reconstruct Server + Transport (~1-5ms)
  ├─ Cache instance locally (10-min TTL)
  └─ Process request successfully
```

### Serverless Environment Behavior (Without External Storage)

**Without Vercel KV/Redis** (memory-only fallback), sessions are lost during cold starts:

1. **Cold Start**: Function instance starts fresh with empty memory
2. **Session Loss**: All previous sessions stored in memory are lost
3. **Client Impact**: Clients receive "Session not found" errors
4. **Recovery**: Clients must detect session loss and re-initialize

**Client-side session recovery pattern** (only needed without external storage):

```typescript
// Client should implement automatic session recovery
async function makeRequest(method: string, params: any) {
  try {
    const response = await fetch('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'mcp-session-id': currentSessionId
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId++, method, params })
    });

    return await response.json();
  } catch (error) {
    // If session not found error, re-initialize
    if (error.message.includes('Session not found')) {
      console.log('Session lost, re-initializing...');
      await initializeSession();
      return makeRequest(method, params);
    }
    throw error;
  }
}
```

### Deployment Recommendations

**Production deployments should use Vercel KV/Redis** to avoid session loss:
- **Vercel**: Add Vercel KV integration (`vercel link` → add KV storage)
- **AWS Lambda**: Configure `REDIS_URL` environment variable
- **Kubernetes**: Deploy Redis service and configure `REDIS_URL`

**Memory-only mode** is suitable for:
- Local development and testing
- Single-instance deployments with sticky sessions
- Low-traffic environments where session loss is acceptable

## Architecture Summary

### Current Implementation (v1.1.0+)

The MCP server now supports **horizontal scalability** through hybrid reconstruction:

**What's Serializable** (stored in Vercel KV/Redis):
- ✅ Session ID (UUID)
- ✅ Session timestamps (created, last activity)
- ✅ Auth info (provider, user ID, email)
- ✅ Session metadata (lightweight, ~500 bytes)

**What's Reconstructed** (on-demand from metadata):
- 🔄 MCP Server instance
- 🔄 StreamableHTTPServerTransport
- 🔄 Tool registrations
- 🔄 Event handlers and streams

**Benefits:**
- ✅ Horizontal scaling - any instance can handle any session
- ✅ Cold start survival - sessions persist across instance restarts
- ✅ No sticky sessions required - true stateless routing
- ✅ Auth preservation - user context maintained across instances
- ✅ Automatic storage detection - Vercel KV or memory fallback

**Trade-offs:**
- ⚠️ Reconstruction cost on cache miss (~1-5ms, mitigated by 10-min cache)
- ⚠️ External storage dependency for multi-instance (Vercel KV/Redis)
- ⚠️ Only serializable metadata can be preserved