# Manual Testing Guide: Horizontal Scaling & Session Recovery

This guide shows how to manually test the horizontal scalability features and observe session recovery across server instances.

## Test Scenario 1: Session Recovery with Vercel KV (Production Behavior)

### Prerequisites
- Vercel KV configured (or local Redis instance)
- `REDIS_URL` environment variable set (for Redis)
- OR Vercel KV environment variables (for Vercel)

### Setup Vercel KV (Recommended)
```bash
# Link project to Vercel and add KV storage
vercel link
vercel env pull .env.local  # Pull Vercel KV credentials

# Verify KV environment variables are present
grep KV_ .env.local
# Should see: KV_URL, KV_REST_API_URL, KV_REST_API_TOKEN, etc.
```

### Alternatively: Use Local Redis
```bash
# Start local Redis in Docker
docker run -d -p 6379:6379 redis:7-alpine

# Set Redis URL
export REDIS_URL=redis://localhost:6379
```

### Test Steps

#### Step 1: Start First Server Instance
```bash
# Terminal 1: Start server with Vercel KV or Redis
NODE_OPTIONS="--env-file=.env.local" npm run dev:http

# Should see:
# [info] MCPInstanceManager initialized { storeType: 'VercelKVMCPMetadataStore' }
# OR
# [info] MCPInstanceManager initialized { storeType: 'MemoryMCPMetadataStore' }  # if Redis unavailable
```

#### Step 2: Create a Session
```bash
# Terminal 2: Initialize MCP session
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test-client", "version": "1.0.0"}
    }
  }' -i

# Response will include session ID header:
# mcp-session-id: 550e8400-e29b-41d4-a716-446655440000

# Save the session ID for next steps
export SESSION_ID="<session-id-from-response>"
```

#### Step 3: Verify Session Works
```bash
# Use the session to call a tool
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }'

# Should return list of available tools successfully
```

#### Step 4: Kill Server Instance (Simulate Cold Start)
```bash
# Terminal 1: Press Ctrl+C to stop the server
# This simulates a serverless cold start or instance restart
```

#### Step 5: Start New Server Instance
```bash
# Terminal 1: Start server again (new process, empty instance cache)
NODE_OPTIONS="--env-file=.env.local" npm run dev:http

# Should see same metadata store type
# [info] MCPInstanceManager initialized
```

#### Step 6: Test Session Recovery
```bash
# Terminal 2: Use SAME session ID from Step 2
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "hello",
      "arguments": {"name": "World"}
    }
  }'

# ✅ WITH VERCEL KV/REDIS: Should succeed!
# Server logs show:
# [info] Reconstructing MCP server instance { sessionId: '550e8400...', age: '30s', hasAuth: false }
# [debug] MCP instance cached { sessionId: '550e8400...', cacheSize: 1 }

# ❌ WITHOUT EXTERNAL STORAGE: Will fail with "Session not found"
```

## Test Scenario 2: Multi-Instance Session Handoff

This simulates multiple server instances (e.g., Kubernetes pods or Vercel functions) handling the same session.

### Step 1: Start Two Server Instances on Different Ports
```bash
# Terminal 1: First instance on port 3000
PORT=3000 NODE_OPTIONS="--env-file=.env.local" npm run dev:http

# Terminal 2: Second instance on port 3001
PORT=3001 NODE_OPTIONS="--env-file=.env.local" npm run dev:http
```

### Step 2: Create Session on Instance 1
```bash
# Terminal 3: Initialize session on port 3000
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test-client", "version": "1.0.0"}
    }
  }' -i

# Save session ID
export SESSION_ID="<session-id-from-response>"
```

### Step 3: Use Session on Instance 2 (Different Server!)
```bash
# Terminal 3: Use SAME session ID but on port 3001 (different instance)
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "echo",
      "arguments": {"message": "Hello from instance 2!"}
    }
  }'

# ✅ WITH VERCEL KV/REDIS: Should succeed!
# Instance 2 logs show:
# [info] Reconstructing MCP server instance { sessionId: '550e8400...', ... }
# [debug] MCP instance cached { sessionId: '550e8400...', cacheSize: 1 }

# ❌ WITHOUT EXTERNAL STORAGE: Will fail with "Session not found"
```

### Step 4: Alternate Between Instances
```bash
# Request 1: Instance 1 (port 3000)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{"jsonrpc": "2.0", "id": 3, "method": "tools/list", "params": {}}'

# Request 2: Instance 2 (port 3001)
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{"jsonrpc": "2.0", "id": 4, "method": "tools/list", "params": {}}'

# Request 3: Back to Instance 1 (port 3000)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{"jsonrpc": "2.0", "id": 5, "method": "tools/list", "params": {}}'

# All requests should succeed - session is accessible from both instances!
```

## Test Scenario 3: Cache Behavior and Performance

This shows the 10-minute instance cache in action.

### Step 1: Measure First Request (Cache Miss)
```bash
# Start fresh server
NODE_OPTIONS="--env-file=.env.local" npm run dev:http

# Create session
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0.0"}}}' -i

export SESSION_ID="<session-id>"

# First request after restart - will reconstruct
time curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}'

# Logs show: [info] Reconstructing MCP server instance
# Response time: ~5-10ms (includes reconstruction)
```

### Step 2: Measure Subsequent Requests (Cache Hit)
```bash
# Immediate second request - will hit cache
time curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{"jsonrpc": "2.0", "id": 3, "method": "tools/list", "params": {}}'

# Logs show: [debug] Reusing cached MCP instance
# Response time: ~1-2ms (from cache)
```

### Step 3: Verify Cache Statistics
```bash
# Check instance cache stats
curl http://localhost:3000/health

# Response includes:
# {
#   "status": "healthy",
#   "instances": {
#     "cachedInstances": 1,
#     "oldestInstanceAge": 5000  // milliseconds
#   }
# }
```

## Test Scenario 4: Session Cleanup and TTL

### Step 1: Create Multiple Sessions
```bash
# Create session 1
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "client1", "version": "1.0.0"}}}' -i

export SESSION_1="<session-id-1>"

# Create session 2
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "client2", "version": "1.0.0"}}}' -i

export SESSION_2="<session-id-2>"
```

### Step 2: Verify Both Sessions Exist
```bash
# Check health endpoint
curl http://localhost:3000/health

# Should show:
# "instances": { "cachedInstances": 2, ... }
```

### Step 3: Manually Delete Session
```bash
# Delete session 1
curl -X DELETE http://localhost:3000/mcp \
  -H "mcp-session-id: $SESSION_1"

# Response:
# {"message": "Session successfully terminated", "sessionId": "..."}
```

### Step 4: Verify Session Deleted
```bash
# Try to use deleted session
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_1" \
  -d '{"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}'

# Should fail: "Session not found"

# Session 2 should still work
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_2" \
  -d '{"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}'

# Should succeed ✅
```

## Observing Logs

Enable debug logging to see detailed reconstruction behavior:

```bash
# Start server with debug logging
NODE_ENV=development NODE_OPTIONS="--env-file=.env.local" npm run dev:http
```

**Key log messages to watch for:**

1. **Metadata Store Initialization:**
   ```
   [info] MCPInstanceManager initialized { storeType: 'VercelKVMCPMetadataStore' }
   ```

2. **Session Metadata Storage:**
   ```
   [debug] Session metadata stored { sessionId: '550e8400...', hasAuth: false }
   ```

3. **Cache Hit (Fast Path):**
   ```
   [debug] Reusing cached MCP instance { sessionId: '550e8400...', cacheSize: 1 }
   ```

4. **Cache Miss (Reconstruction):**
   ```
   [info] Reconstructing MCP server instance { sessionId: '550e8400...', age: '30s', hasAuth: false, eventCount: 0 }
   [debug] Transport using existing session ID { sessionId: '550e8400...' }
   [debug] MCP instance cached { sessionId: '550e8400...', cacheSize: 1 }
   ```

5. **Cleanup:**
   ```
   [info] Cleaned up expired MCP instances { count: 3, ttlMinutes: 10 }
   ```

## Expected Behavior Summary

| Scenario | With Vercel KV/Redis | Without (Memory Only) |
|----------|---------------------|----------------------|
| Server restart | ✅ Session survives | ❌ Session lost |
| Multi-instance | ✅ Works seamlessly | ❌ Session not found |
| Cold start | ✅ Auto-recovery | ❌ Client must re-initialize |
| Cache hit | ✅ ~1ms response | ✅ ~1ms response |
| Cache miss | ✅ ~5ms (reconstruction) | N/A (session lost) |
| Session cleanup | ✅ 30-min TTL (Redis) | ✅ 30-min TTL (memory) |

## Troubleshooting

**"Session not found" despite Vercel KV:**
- Check environment variables: `echo $KV_REST_API_URL`
- Verify Vercel KV is accessible: `vercel env pull`
- Check server logs for metadata store type

**Reconstruction not happening:**
- Verify you're testing with different server instances (different ports or restart)
- Check that session was created before server restart
- Enable debug logging: `NODE_ENV=development`

**Performance seems slow:**
- First request to each instance pays reconstruction cost (~5ms)
- Subsequent requests hit cache (<1ms)
- Check cache size: `curl http://localhost:3000/health`
