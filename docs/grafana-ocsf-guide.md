# Grafana OCSF Events Guide

**STATUS**: ✅ COMPLETE - OCSF framework integration verified working end-to-end!

This guide shows you how to view OCSF audit events in Grafana when running the Docker Compose production-like environment. The system includes two pre-configured dashboards that automatically visualize all OCSF events from the MCP servers.

## Architecture

The observability stack uses a production-grade setup with separate services:

```
MCP Servers (3 instances)
  ↓ OTLP HTTP (port 4318)
OTEL Collector
  ↓ OTLP HTTP (/otlp endpoint)
Loki (log aggregation)
  ↓ HTTP API
Grafana (visualization)
```

## Quick Start

### 1. Start the Full Stack

```bash
docker-compose up -d
```

This starts:
- **3 MCP server instances** (load-balanced)
- **Redis** (session storage)
- **Nginx** (load balancer on port 8080)
- **OTEL Collector** (receives OTLP logs/metrics/traces)
- **Loki** (log storage and indexing)
- **Grafana** (visualization on port 3200)
- **Prometheus** (metrics storage on port 9090)

All MCP servers automatically send OCSF events to the OTEL Collector via OTLP HTTP.

### 2. Access Grafana

Open your browser to:
```
http://localhost:3200
```

**Default credentials:**
- Username: `admin`
- Password: `admin` (you'll be prompted to change it)

### 3. Generate Some OCSF Events

In a separate terminal, make requests to the MCP server:

```bash
# Health check (generates API activity events)
curl http://localhost:8080/health

# OAuth discovery (generates API activity events)
curl http://localhost:8080/.well-known/oauth-authorization-server

# Admin endpoints (generates authentication events)
curl -X POST http://localhost:8080/admin/tokens \
  -H "Content-Type: application/json" \
  -d '{"expiresInDays": 30}'
```

## Finding OCSF Events in Grafana

### Option 1: Explore Logs (Easiest)

1. **Click "Explore"** in left sidebar (compass icon)
2. **Select "Loki"** as data source (top dropdown)
3. **Click "Label filters"** → Add filter:
   - Label: `service_name`
   - Operator: `=`
   - Value: `mcp-server-1` (or `mcp-server-2`, `mcp-server-3`)
4. **Click "Run query"**
5. **Look for log lines containing `"class_name"` and `"category_name"`** - these are OCSF events

### Option 2: LogQL Query (Advanced)

In the Explore view, use this LogQL query:

```logql
{service_name=~"mcp-server-.*"} |= "class_name"
```

This filters for all logs from MCP servers that contain OCSF schema fields.

### Option 3: Pre-built Dashboards (Recommended)

Two dashboards are automatically provisioned and ready to use:

#### OCSF Security Dashboard
Focus on security events and audit trails:

```
http://localhost:3200/d/ocsf-security/ocsf-security-dashboard
```

**Features:**
- **OCSF Events by Class** - Pie chart showing Authentication vs API Activity events
- **Total OCSF Events** - Overall event count
- **Failed Authentication** - Security alert counter
- **API Errors** - Error rate monitoring
- **OCSF Events Timeline** - Real-time event stream visualization
- **Top Authentication Activities** - Most common auth operations (logon, logoff, etc.)
- **Top API Endpoints** - Most accessed HTTP/MCP endpoints
- **OCSF Event Log Stream** - Raw event details with JSON formatting

Auto-refreshes every 10 seconds, shows the last hour of activity.

#### MCP Server Monitoring Dashboard
Focus on operational metrics and log volume:

```
http://localhost:3200/d/mcp-server-monitoring
```

**Features:**
- **Log Volume by Service** - Time series showing log rates across all MCP server instances
- **Error Logs** - Error rate tracking over time
- **Total Log Lines (5m)** - Stat panel showing recent log volume
- **Error Count (5m)** - Stat panel showing recent error volume
- **Service Distribution** - Pie chart showing log distribution across server instances
- **Recent Error Logs** - Filtered view of ERROR-level logs
- **MCP Request Timeline** - All MCP method calls with JSON-parsed metadata
- **OAuth Flow Events** - OAuth authentication and authorization events
- **All MCP Server Logs** - Complete unfiltered log stream

Auto-refreshes every 5 seconds, shows the last 15 minutes of activity.

Both dashboards are in the "MCP Observability" folder and automatically load when Grafana starts.

## Understanding OCSF Event Structure

### Authentication Events (class_uid: 3002)

```json
{
  "activity_id": 1,
  "activity_name": "Logon",
  "category_name": "Identity & Access Management",
  "category_uid": 3,
  "class_name": "Authentication",
  "class_uid": 3002,
  "severity_id": 1,
  "severity": "Informational",
  "actor": {
    "user": {
      "name": "user@example.com",
      "type": "User",
      "type_id": 1,
      "uid": "uuid-here"
    }
  },
  "auth_protocol": "OAuth 2.0",
  "auth_protocol_id": 3,
  "logon_type": "Interactive",
  "logon_type_id": 2
}
```

### API Activity Events (class_uid: 6003)

```json
{
  "activity_id": 1,
  "activity_name": "Access",
  "category_name": "Application Activity",
  "category_uid": 6,
  "class_name": "API Activity",
  "class_uid": 6003,
  "severity_id": 1,
  "severity": "Informational",
  "api": {
    "operation": "GET /health",
    "request": {
      "uid": "uuid-here"
    },
    "response": {
      "code": 200,
      "message": "OK"
    }
  },
  "http_request": {
    "http_method": "GET",
    "url": {
      "path": "/health"
    }
  }
}
```

## Event Flow Architecture

```
MCP Server (Node.js)
  ↓
packages/observability/ocsf/
  ↓
OpenTelemetry SDK (LoggerProvider)
  ↓
OTLP HTTP Exporter (http://otel-collector:4318)
  ↓
OTEL Collector (receives OTLP)
  ├─ Logs → Loki (via /otlp endpoint)
  ├─ Traces → Debug exporter
  └─ Metrics → Prometheus
       ↓
     Grafana (queries Loki and Prometheus)
```

## Troubleshooting

### Can't Access Grafana UI

**Problem:** Browser can't connect to http://localhost:3200

**Solutions:**
```bash
# 1. Check if Grafana container is running
docker-compose ps grafana

# 2. Check container logs
docker-compose logs grafana

# 3. Verify port isn't blocked (check for stale containers)
lsof -i:3200
docker ps -a | grep grafana

# 4. Clean up stale containers and restart
docker-compose down
docker-compose up -d
```

### No OCSF Events Appearing

**Problem:** Grafana is empty, no logs showing up

**Solutions:**
```bash
# 1. Check MCP servers are sending telemetry
docker-compose logs mcp-server-1 | grep -i otel

# 2. Check OTLP endpoint is reachable
curl -X POST http://localhost:4318/v1/logs \
  -H "Content-Type: application/json" \
  -d '{"resourceLogs":[]}'

# 3. Verify MCP servers started successfully
docker-compose logs mcp-server-1 | grep -i "listening\|started"

# 4. Generate events manually
curl http://localhost:8080/health
```

### Events Are Malformed

**Problem:** Events don't have proper OCSF structure

**Check:**
```bash
# View raw logs from MCP server
docker-compose logs mcp-server-1 --tail=100

# Look for:
# - "class_name": "Authentication" or "API Activity"
# - "category_name": "Identity & Access Management" or "Application Activity"
# - Proper severity_id (1-6)
```

## Verification Steps

### 1. Verify Stack is Running

```bash
docker-compose ps
```

Expected: All 9 containers in "Up" state (mcp-server-1/2/3, nginx, redis, otel-collector, loki, grafana, prometheus)

### 2. Verify OTEL Collector Receiving Logs

```bash
docker-compose logs otel-collector --tail=20 | grep "LogRecord"
```

Expected: You should see "LogRecord #N" entries if logs are being received.

### 3. Verify Loki Ingestion

```bash
curl -s http://localhost:3100/metrics | grep loki_ingester_streams_created_total
```

Expected: `loki_ingester_streams_created_total{tenant="fake"} N` where N > 0

### 4. Send Test OCSF Event

```bash
curl -X POST http://localhost:4318/v1/logs \
  -H "Content-Type: application/json" \
  -d '{
  "resourceLogs": [{
    "resource": {
      "attributes": [{
        "key": "service.name",
        "value": {"stringValue": "test-ocsf"}
      }]
    },
    "scopeLogs": [{
      "scope": {"name": "ocsf-test"},
      "logRecords": [{
        "timeUnixNano": "'$(date +%s)'000000000",
        "observedTimeUnixNano": "'$(date +%s)'000000000",
        "severityNumber": 9,
        "severityText": "INFO",
        "body": {"stringValue": "Test OCSF Event"},
        "attributes": [
          {"key": "ocsf.class_uid", "value": {"intValue": "6003"}},
          {"key": "ocsf.class_name", "value": {"stringValue": "API Activity"}},
          {"key": "ocsf.activity_name", "value": {"stringValue": "Access"}}
        ]
      }]
    }]
  }]
}'
```

Expected: `{"partialSuccess":{}}`

### 5. Verify in Grafana

1. Open http://localhost:3200
2. Go to Explore → Select "Loki" datasource
3. Query: `{service_name=~"mcp-server-.+|test-ocsf"}`
4. You should see log entries with OCSF attributes

## Port Configuration Summary

- **3100**: Loki API
- **3200**: Grafana UI
- **4317**: OTLP gRPC endpoint
- **4318**: OTLP HTTP endpoint (used by MCP servers)
- **8080**: Nginx load balancer (MCP server access)
- **6380**: Redis (exposed for debugging)
- **8889**: Prometheus metrics from OTEL Collector
- **9090**: Prometheus UI

## Next Steps

1. **Create custom dashboard** showing OCSF events
2. **Set up alerting** for authentication failures
3. **Add trace correlation** to link events across services
4. **Export dashboards** for team sharing

## References

- [OCSF Schema Browser](https://schema.ocsf.io/)
- [Grafana Loki Documentation](https://grafana.com/docs/loki/latest/)
- [OpenTelemetry Logs](https://opentelemetry.io/docs/specs/otel/logs/)
