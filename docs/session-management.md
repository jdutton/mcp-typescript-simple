# MCP Session Management Architecture

## Overview

The MCP TypeScript Simple server uses StreamableHTTPServerTransport for HTTP-based MCP protocol communication. This document describes the session management architecture, limitations, and deployment considerations.

## Session State Architecture

### In-Memory State Management
The StreamableHTTPServerTransport session management has important architectural characteristics:

- **Session transports are stored in memory only** - cannot be serialized or persisted to external storage (Redis, databases)
- **Transport objects contain non-serializable components**: HTTP response objects, event handlers, connection state
- **No cross-instance session sharing** - each server instance maintains its own session storage

### Session Lifecycle
1. **Initialization**: Client sends MCP `initialize` request, server creates new StreamableHTTPServerTransport
2. **Session ID**: Server generates UUID and returns in `mcp-session-id` header
3. **Persistence**: Client must include `mcp-session-id` header in all subsequent requests
4. **Cleanup**: Sessions can be terminated via `DELETE /mcp` endpoint or automatic timeout

## Deployment Implications

### Single Instance Deployments ✅
**Works perfectly with current implementation**
- Local development servers
- Single container deployments
- Simple production environments

### Load Balanced Deployments ⚠️
**Requires careful configuration**
- **Requires sticky sessions** - clients must always route to the same server instance
- Configure load balancer with session affinity using `mcp-session-id` header
- Without sticky sessions: "Server not initialized" errors on subsequent requests

**Load Balancer Configuration Examples:**
```nginx
# Nginx with ip_hash for session affinity
upstream mcp_servers {
    ip_hash;
    server 10.0.0.1:3000;
    server 10.0.0.2:3000;
}
```

### Serverless/Functions ❌
**Not suitable for stateless functions**
- AWS Lambda, Vercel Functions: Function restarts lose all session state
- Each function invocation creates isolated memory space
- No persistent memory between invocations

### Container Orchestration ⚠️
**Possible with session affinity**
- Kubernetes/Docker Swarm: Use persistent pods with session affinity
- Horizontal scaling requires sticky session configuration
- Pod restarts lose active sessions

**Kubernetes Configuration Example:**
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
  ports:
  - port: 3000
    targetPort: 3000
  selector:
    app: mcp-server
```

## Recommended Deployment Patterns

### 1. Development
**Single instance** - Current implementation works perfectly
- `npm run dev:http` for local development
- Docker container for isolated development
- No special configuration needed

### 2. Production - Simple
**Single instance with high availability backup**
- Primary instance with health monitoring
- Standby instance for failover (manual process)
- Regular health checks via `/health` endpoint

### 3. Production - Scaled
**Load balancer with sticky sessions**
- Multiple identical server instances
- Load balancer configured for session affinity
- Shared configuration and secrets

### 4. High Scale Alternative
**Stateless mode** (higher overhead, no session benefits)
- Create new transport+server for every request
- No session persistence between requests
- Higher memory and CPU usage per request

## Alternative Approaches

### 1. Stateless Mode Implementation
```typescript
// Create fresh server per request (no session persistence)
app.post('/mcp', async (req, res) => {
  const server = new Server(/* ... */);
  const transport = new StreamableHTTPServerTransport(/* ... */);
  await server.connect(transport);
  // Handle request and cleanup
});
```

### 2. Custom Session Storage
**Complex approach requiring custom MCP state management**
- Implement application-level session state serialization
- Store serialized state in Redis/database
- Reconstruct transport objects from stored state
- Requires deep understanding of MCP SDK internals

### 3. Sticky Sessions
**Recommended for production scaling**
- Configure load balancer to route clients to same server instance
- Use `mcp-session-id` header for routing decisions
- Implement health checks for automatic failover

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
- Each session requires ~1-5MB memory (depending on usage)
- Sessions accumulate until explicitly cleaned up
- Monitor memory usage in production deployments

### Concurrent Sessions
- Single instance can handle 100-1000+ concurrent sessions
- Limited by available memory and CPU resources
- Scale horizontally with sticky sessions for higher load

### Session Cleanup
- Implement automatic session timeout (not currently implemented)
- Use `DELETE /mcp` endpoint for explicit cleanup
- Monitor for memory leaks from orphaned sessions

## Limitations Summary

This limitation is **inherent to the MCP TypeScript SDK design** and affects all projects using StreamableHTTPServerTransport:

1. **Memory-only storage** - Cannot persist to external storage
2. **Instance-specific** - Cannot share sessions between server instances
3. **Non-serializable** - Transport objects contain complex runtime state
4. **Deployment constraints** - Requires careful consideration for scaling

Understanding these limitations is essential for proper deployment planning and troubleshooting session-related issues.