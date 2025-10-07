# Docker Multi-Node Deployment and Testing Guide

This guide covers deploying and testing the MCP server in a horizontally-scaled, load-balanced configuration with Redis session persistence.

## Architecture Overview

The multi-node deployment consists of:

```
┌─────────────────────────────────────────────────┐
│  Client (curl, MCP Inspector, Claude Code)      │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
          ┌──────────────────────┐
          │  Nginx Load Balancer │  Port 8080
          │   (Round Robin)      │
          └──────────┬───────────┘
                     │
         ┌───────────┼───────────┐
         │           │           │
         ▼           ▼           ▼
    ┌────────┐  ┌────────┐  ┌────────┐
    │ MCP    │  │ MCP    │  │ MCP    │
    │Server 1│  │Server 2│  │Server 3│  Port 3000 (internal)
    └───┬────┘  └───┬────┘  └───┬────┘
        │           │           │
        └───────────┼───────────┘
                    │
                    ▼
            ┌───────────────┐
            │ Redis Session │  Port 6379
            │    Storage    │
            └───────────────┘
                    │
                    ▼
          ┌──────────────────────┐
          │ OpenTelemetry OTEL   │  Port 3100 (Grafana)
          │  (Observability)     │  Port 4317-4318 (OTLP)
          └──────────────────────┘
```

### Components

1. **3 MCP Server Instances**: Identical server instances running in parallel
2. **Nginx Load Balancer**: Distributes requests across instances (round-robin)
3. **Redis**: Shared session storage enabling session persistence and recovery
4. **OpenTelemetry Stack**: Optional observability (Grafana, Loki, Tempo, Prometheus)

### Key Features

- **Horizontal Scaling**: Multiple server instances handle concurrent requests
- **Session Persistence**: Redis stores session metadata for cross-instance recovery
- **Load Balancing**: Nginx distributes traffic evenly across instances
- **Session Recovery**: Instances can reconstruct sessions after restart
- **Observability**: OpenTelemetry integration for distributed tracing and logging

## Prerequisites

### Required
- Docker and Docker Compose installed
- Redis available (started automatically by docker-compose)
- Project built: `npm run build`

### Optional
- OpenTelemetry stack for observability: `npm run otel:start`
- OAuth credentials (for production testing with authentication)

## Quick Start

### 1. Start the Multi-Node Deployment

```bash
# Start 3 MCP servers + Redis + Nginx load balancer
docker-compose --profile loadbalanced up -d

# Verify all services are running
docker-compose --profile loadbalanced ps
```

**Expected output:**
```
NAME                                  STATUS
mcp-nginx                             Up
mcp-typescript-simple-mcp-server-1-1  Up
mcp-typescript-simple-mcp-server-2-1  Up
mcp-typescript-simple-mcp-server-3-1  Up
mcp-redis-lb                          Up (healthy)
```

### 2. Verify Health

```bash
# Check load balancer health endpoint
curl http://localhost:8080/health | jq
```

**Expected response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-10-05T16:06:26.289Z",
  "deployment": "local",
  "mode": "streamable_http",
  "auth": "disabled",
  "llm_providers": [],
  "version": "1.0.0",
  "sessions": {
    "totalSessions": 0,
    "activeSessions": 0,
    "expiredSessions": 0
  }
}
```

### 3. Test MCP Protocol

```bash
# List available tools
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }' | jq
```

## Port Reference

**IMPORTANT**: Use the correct ports for each service:

| Port | Service | Purpose | Use This For |
|------|---------|---------|--------------|
| **8080** | **Nginx Load Balancer** | **MCP Requests** | **All MCP protocol testing** |
| 3100 | Grafana (OTEL) | Observability UI | Monitoring/logs (separate service) |
| 6379 | Redis | Session storage | Internal (used by MCP servers) |
| 6380 | Redis LB | Redis load balancer | Alternative Redis endpoint |
| 4317-4318 | OTLP | OpenTelemetry ingestion | Telemetry data (internal) |

**Common Mistake**: Port 3100 is the Grafana observability dashboard, NOT the MCP server. Always use port 8080 for MCP requests.

## Configuration

### Environment Variables (Per Instance)

The multi-node setup uses these environment variables (configured in `docker-compose.yml`):

```bash
# Redis connection (uses host.docker.internal for external Redis)
REDIS_URL=redis://host.docker.internal:6379

# Development mode (auth bypass)
NODE_ENV=development
MCP_DEV_SKIP_AUTH=true

# MCP server mode
MCP_MODE=streamable_http
HTTP_PORT=3000
HTTP_HOST=0.0.0.0

# OpenTelemetry (optional)
OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4318
OTEL_SERVICE_NAME=mcp-server-1  # Unique per instance
```

### Nginx Configuration

Load balancer configuration (`nginx.conf`):

```nginx
upstream mcp_backend {
    # Round-robin load balancing
    server mcp-server-1:3000;
    server mcp-server-2:3000;
    server mcp-server-3:3000;
}

server {
    listen 8080;

    location / {
        proxy_pass http://mcp_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;

        # Preserve session headers
        proxy_pass_request_headers on;
    }
}
```

## Testing Multi-Node Features

### Test 1: Session Persistence Across Instances

This test verifies sessions work across different server instances.

```bash
# Step 1: Create a session
INIT_RESPONSE=$(curl -X POST http://localhost:8080/mcp \
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
  }' -i)

# Extract session ID from response headers
SESSION_ID=$(echo "$INIT_RESPONSE" | grep -i "mcp-session-id:" | awk '{print $2}' | tr -d '\r')

echo "Session ID: $SESSION_ID"

# Step 2: Make multiple requests (will hit different instances via round-robin)
for i in {1..10}; do
  curl -X POST http://localhost:8080/mcp \
    -H "Content-Type: application/json" \
    -H "mcp-session-id: $SESSION_ID" \
    -d "{
      \"jsonrpc\": \"2.0\",
      \"id\": $i,
      \"method\": \"tools/call\",
      \"params\": {
        \"name\": \"hello\",
        \"arguments\": {\"name\": \"Request $i\"}
      }
    }" | jq -r '.result[0].content[0].text'
done
```

**Expected**: All 10 requests succeed, even though they hit different server instances.

### Test 2: Session Recovery After Instance Restart

This test verifies sessions survive server instance restarts.

```bash
# Step 1: Create a session
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test", "version": "1.0"}
    }
  }' -i | grep -i "mcp-session-id:"

# Save the session ID
export SESSION_ID="<session-id-from-above>"

# Step 2: Restart one server instance
docker-compose --profile loadbalanced restart mcp-server-1

# Step 3: Use the session again (might hit restarted instance)
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list"
  }' | jq
```

**Expected**: Request succeeds. If it hits the restarted instance, you'll see reconstruction logs:
```
[info] Reconstructing MCP server instance { sessionId: '...', age: '5s', hasAuth: false }
```

### Test 3: Load Distribution

Verify nginx is distributing requests across all three instances.

```bash
# Watch Docker logs in separate terminal
docker-compose --profile loadbalanced logs -f mcp-server-1 mcp-server-2 mcp-server-3

# In another terminal, send multiple requests
for i in {1..30}; do
  curl -s -X POST http://localhost:8080/mcp \
    -H "Content-Type: application/json" \
    -d '{
      "jsonrpc": "2.0",
      "id": 1,
      "method": "tools/list"
    }' > /dev/null
  sleep 0.1
done
```

**Expected**: Logs show requests distributed roughly equally across all three instances (round-robin).

### Test 4: Redis Session Storage

Verify session metadata is stored in Redis.

```bash
# Step 1: Create a session
SESSION_ID=$(curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test", "version": "1.0"}
    }
  }' -i | grep -i "mcp-session-id:" | awk '{print $2}' | tr -d '\r')

echo "Session ID: $SESSION_ID"

# Step 2: Check Redis for session metadata
docker exec mcp-redis redis-cli KEYS "mcp:session:*"

# Step 3: View session metadata
docker exec mcp-redis redis-cli GET "mcp:session:$SESSION_ID"
```

**Expected**: Redis contains session metadata with protocol version and capabilities.

## Observability Integration

The multi-node deployment integrates with OpenTelemetry for distributed tracing.

### Start Observability Stack

```bash
# Start Grafana OTEL stack (port 3100)
npm run otel:start

# Verify it's running
curl http://localhost:3100/
```

### View Distributed Traces

1. **Open Grafana**: http://localhost:3100
2. **Navigate to Tempo** (distributed tracing)
3. **Filter by service**: `mcp-server-1`, `mcp-server-2`, `mcp-server-3`
4. **View traces**: See requests flowing through load balancer to different instances

### View Logs by Instance

```bash
# View logs from specific instance
docker-compose --profile loadbalanced logs -f mcp-server-1

# View logs from all instances
docker-compose --profile loadbalanced logs -f

# View nginx access logs
docker-compose --profile loadbalanced logs -f nginx
```

## Production Deployment

### With OAuth Authentication

To deploy with OAuth authentication enabled:

```bash
# Step 1: Create .env file with OAuth credentials
cat > .env.google << EOF
# Google OAuth (server auto-detects configured providers)
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8080/auth/callback
EOF

# Step 2: Update docker-compose.yml to use .env.google
# Modify mcp-server-1, mcp-server-2, mcp-server-3:
#   env_file:
#     - .env.google
#   environment:
#     MCP_DEV_SKIP_AUTH: "false"  # Enable OAuth

# Step 3: Start with OAuth
docker-compose --profile loadbalanced up -d
```

### Scaling Instances

To add more server instances:

```bash
# Edit docker-compose.yml and add mcp-server-4, mcp-server-5, etc.
# Update nginx.conf upstream block to include new instances
# Restart deployment
docker-compose --profile loadbalanced up -d --scale mcp-server-1=5
```

## Troubleshooting

### Port 3100 Not Returning JSON

**Problem**: `curl http://localhost:3100/health` returns HTML (Grafana UI) instead of JSON.

**Solution**: Port 3100 is the Grafana observability dashboard, NOT the MCP server. Use port 8080:
```bash
curl http://localhost:8080/health
```

### Session Not Found Error

**Problem**: Requests return "Session not found" error.

**Possible causes**:
1. Redis not running or not accessible
2. Session expired (30-minute TTL)
3. Wrong session ID header

**Debugging**:
```bash
# Check Redis connectivity
docker exec mcp-redis redis-cli ping
# Should return: PONG

# Check if session exists in Redis
docker exec mcp-redis redis-cli KEYS "mcp:session:*"

# Check session TTL
docker exec mcp-redis redis-cli TTL "mcp:session:$SESSION_ID"
# Should return time in seconds (or -1 if no expiry, -2 if key doesn't exist)

# Enable debug logging
docker-compose --profile loadbalanced logs -f | grep -i session
```

### Load Balancer Not Distributing Evenly

**Problem**: All requests go to one instance.

**Possible causes**:
1. Session affinity enabled (should not be for stateless MCP)
2. One or more instances unhealthy

**Debugging**:
```bash
# Check all instances are healthy
docker-compose --profile loadbalanced ps

# Check nginx configuration
docker exec mcp-nginx cat /etc/nginx/nginx.conf

# Watch distribution in real-time
docker-compose --profile loadbalanced logs -f | grep -E "mcp-server-[123]"
```

### Redis Connection Errors

**Problem**: Servers can't connect to Redis.

**Solution**:
```bash
# Check Redis is running
docker ps | grep redis

# Check Redis health
docker exec mcp-redis redis-cli ping

# Check network connectivity
docker-compose --profile loadbalanced exec mcp-server-1 ping host.docker.internal

# Verify REDIS_URL environment variable
docker-compose --profile loadbalanced exec mcp-server-1 env | grep REDIS_URL
```

### Instance Logs Show Reconstruction Too Often

**Problem**: Every request shows "Reconstructing MCP server instance" log.

**Possible causes**:
1. Instance cache disabled or too short
2. Memory pressure causing cache eviction
3. Each request hitting different instance (expected for new sessions)

**Expected behavior**:
- First request to an instance: Reconstruction (5-10ms)
- Subsequent requests to same instance: Cache hit (1-2ms)
- Reconstruction is normal when round-robin sends request to different instance

## Cleanup

### Stop Deployment

```bash
# Stop all services
docker-compose --profile loadbalanced down

# Stop and remove volumes (clears Redis data)
docker-compose --profile loadbalanced down -v
```

### Stop Observability Stack

```bash
npm run otel:stop
```

## Related Documentation

- **[Architecture Overview](./architecture.md)** - System design and patterns
- **[Session Management](./session-management.md)** - Session state architecture
- **[Testing Horizontal Scaling](./testing-horizontal-scaling.md)** - Manual scaling tests
- **[Stateful HTTP Scaling](./stateful-http-scaling.md)** - Scaling considerations
- **[OAuth Setup](./oauth-setup.md)** - OAuth configuration for production

## Summary

The multi-node Docker deployment provides:

- ✅ **Horizontal scalability**: Add more instances as needed
- ✅ **Session persistence**: Sessions survive instance restarts
- ✅ **Load balancing**: Even distribution across instances
- ✅ **High availability**: Multiple instances for redundancy
- ✅ **Observability**: Full OpenTelemetry integration
- ✅ **Production-ready**: Redis-backed session storage

**Quick reference**:
```bash
# Start:  docker-compose --profile loadbalanced up -d
# Test:   curl http://localhost:8080/health
# Logs:   docker-compose --profile loadbalanced logs -f
# Stop:   docker-compose --profile loadbalanced down
```
