# SIEM Integration Guide

This guide explains how to integrate MCP TypeScript Simple's OCSF-based audit events with SIEM systems.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [SIEM Integrations](#siem-integrations)
  - [AWS Security Lake](#aws-security-lake)
  - [Splunk](#splunk)
  - [Datadog](#datadog)
  - [Elastic Security](#elastic-security)
  - [Generic SIEM](#generic-siem)
- [Event Filtering](#event-filtering)
- [Performance Tuning](#performance-tuning)
- [Troubleshooting](#troubleshooting)

## Overview

MCP TypeScript Simple emits OCSF (Open Cybersecurity Schema Framework) events via OpenTelemetry logs. This standards-based approach enables:

- **Vendor-neutral audit trail**: Switch SIEM vendors without code changes
- **Zero-config integration**: OTEL exporters handle all data transformation
- **Rich context**: Automatic trace correlation, session tracking, user attribution
- **Compliance-ready**: SOC 2, ISO 27001, GDPR, HIPAA compatible events

### Architecture

```
MCP Server → OCSF Events → OTEL Logs → OTEL Exporter → SIEM
```

All OCSF events are emitted as OpenTelemetry logs with:
- Full OCSF event as JSON in `body` attribute
- Automatic severity mapping (OCSF → OTEL)
- Trace correlation (trace_id, span_id)
- Resource attributes (service name, version, environment)

## Quick Start

### 1. Configure OpenTelemetry

Create or update your OTEL configuration:

```typescript
// src/observability/otel-config.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';

const sdk = new NodeSDK({
  logRecordProcessors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
        headers: {
          'x-api-key': process.env.OTEL_API_KEY,
        },
      })
    ),
  ],
});

sdk.start();
```

### 2. Set Environment Variables

```bash
# OTEL endpoint (SIEM-specific)
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT="https://your-siem.com/v1/logs"

# OTEL API key (if required)
export OTEL_API_KEY="your-api-key"

# Service identification
export OTEL_SERVICE_NAME="mcp-server"
export OTEL_SERVICE_VERSION="1.0.0"
export DEPLOYMENT_ENVIRONMENT="production"
```

### 3. Verify Events

Check your SIEM for events:
- Authentication events (class_uid: 3002)
- API Activity events (class_uid: 6003)

## SIEM Integrations

### AWS Security Lake

AWS Security Lake natively supports OCSF events.

#### Setup

1. **Create Security Lake**:
   ```bash
   aws securitylake create-data-lake \
     --region us-east-1 \
     --configurations dataLakeConfiguration="{regionConfiguration={region=us-east-1}}"
   ```

2. **Configure OTEL Exporter**:
   ```typescript
   import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
   import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';

   const exporter = new OTLPLogExporter({
     url: process.env.AWS_SECURITY_LAKE_ENDPOINT,
     headers: {
       'x-amz-security-lake-source': 'mcp-server',
     },
   });

   const processor = new BatchLogRecordProcessor(exporter);
   ```

3. **Set Environment Variables**:
   ```bash
   export AWS_SECURITY_LAKE_ENDPOINT="https://logs.security-lake.us-east-1.amazonaws.com/v1/logs"
   export AWS_REGION="us-east-1"
   export AWS_ACCESS_KEY_ID="your-access-key"
   export AWS_SECRET_ACCESS_KEY="your-secret-key"
   ```

#### Querying Events

Use Amazon Athena to query OCSF events:

```sql
-- Failed authentication attempts (last 24 hours)
SELECT
  time,
  actor.user.email_addr AS user_email,
  status_detail AS failure_reason,
  src_endpoint.ip AS source_ip
FROM ocsf_authentication_events
WHERE
  activity_id = 1  -- Logon
  AND status_id = 2  -- Failure
  AND time > NOW() - INTERVAL '24' HOUR
ORDER BY time DESC;

-- Tool invocation patterns
SELECT
  resources[0].name AS tool_name,
  COUNT(*) AS invocation_count,
  SUM(CASE WHEN status_id = 1 THEN 1 ELSE 0 END) AS success_count,
  SUM(CASE WHEN status_id = 2 THEN 1 ELSE 0 END) AS failure_count
FROM ocsf_api_activity_events
WHERE
  api.service.name = 'mcp.tool'
  AND time > NOW() - INTERVAL '7' DAY
GROUP BY resources[0].name
ORDER BY invocation_count DESC;
```

### Splunk

Splunk integrates via HTTP Event Collector (HEC).

#### Setup

1. **Enable HEC in Splunk**:
   - Settings → Data Inputs → HTTP Event Collector
   - Create new token for MCP server
   - Note the token and HEC endpoint

2. **Configure OTEL Exporter**:
   ```typescript
   import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
   import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';

   const exporter = new OTLPLogExporter({
     url: process.env.SPLUNK_HEC_ENDPOINT,
     headers: {
       'Authorization': `Splunk ${process.env.SPLUNK_HEC_TOKEN}`,
     },
   });

   const processor = new BatchLogRecordProcessor(exporter);
   ```

3. **Set Environment Variables**:
   ```bash
   export SPLUNK_HEC_ENDPOINT="https://your-splunk.com:8088/services/collector/raw"
   export SPLUNK_HEC_TOKEN="your-hec-token"
   ```

#### Querying Events

Use Splunk SPL (Search Processing Language):

```spl
# Failed authentication attempts
index=ocsf sourcetype=ocsf:authentication
| spath class_uid
| search class_uid=3002 activity_id=1 status_id=2
| table _time, actor.user.email_addr, status_detail, src_endpoint.ip
| sort -_time

# Tool invocation statistics (last 7 days)
index=ocsf sourcetype=ocsf:api_activity earliest=-7d
| spath class_uid
| search class_uid=6003 api.service.name="mcp.tool"
| stats count by resources{}.name, status_id
| eval status=if(status_id=1, "Success", "Failure")
| chart count over resources{}.name by status
```

### Datadog

Datadog integrates via the Datadog Agent or direct API.

#### Setup (Agent)

1. **Install Datadog Agent**:
   ```bash
   DD_API_KEY=your-api-key DD_SITE="datadoghq.com" bash -c "$(curl -L https://s3.amazonaws.com/dd-agent/scripts/install_script_agent7.sh)"
   ```

2. **Configure OTEL Exporter**:
   ```typescript
   import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
   import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';

   const exporter = new OTLPLogExporter({
     url: 'http://localhost:4318/v1/logs',  // Datadog Agent OTLP endpoint
   });

   const processor = new BatchLogRecordProcessor(exporter);
   ```

3. **Configure Datadog Agent** (`/etc/datadog-agent/datadog.yaml`):
   ```yaml
   logs_enabled: true

   otlp_config:
     receiver:
       protocols:
         http:
           endpoint: 0.0.0.0:4318
   ```

#### Setup (Direct API)

```typescript
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';

const exporter = new OTLPLogExporter({
  url: 'https://http-intake.logs.datadoghq.com/api/v2/logs',
  headers: {
    'DD-API-KEY': process.env.DD_API_KEY,
  },
});
```

#### Querying Events

Use Datadog Log Explorer:

```
# Failed authentication attempts
@class_uid:3002 @activity_id:1 @status_id:2

# Tool invocation failures (last hour)
@class_uid:6003 @api.service.name:"mcp.tool" @status_id:2 @timestamp:>now-1h

# Aggregate: Tool invocations by status
source:ocsf @class_uid:6003 | group by @resources.name, @status_id | count
```

### Elastic Security

Elastic Security integrates via Elasticsearch.

#### Setup

1. **Configure OTEL Exporter**:
   ```typescript
   import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
   import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';

   const exporter = new OTLPLogExporter({
     url: `${process.env.ELASTICSEARCH_URL}/_bulk`,
     headers: {
       'Authorization': `ApiKey ${process.env.ELASTICSEARCH_API_KEY}`,
     },
   });

   const processor = new BatchLogRecordProcessor(exporter);
   ```

2. **Set Environment Variables**:
   ```bash
   export ELASTICSEARCH_URL="https://your-cluster.es.us-east-1.aws.found.io:9243"
   export ELASTICSEARCH_API_KEY="your-api-key"
   ```

#### Querying Events

Use Kibana Discover or Elasticsearch Query DSL:

```json
{
  "query": {
    "bool": {
      "must": [
        { "term": { "class_uid": 3002 } },
        { "term": { "activity_id": 1 } },
        { "term": { "status_id": 2 } },
        { "range": { "time": { "gte": "now-24h" } } }
      ]
    }
  }
}
```

### Generic SIEM

For SIEMs without native OTEL support, use file-based integration.

#### Setup

1. **Configure File Exporter**:
   ```typescript
   import { FileLogRecordExporter } from '@opentelemetry/sdk-logs';
   import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';

   const exporter = new FileLogRecordExporter({
     path: '/var/log/mcp-server/ocsf-events.jsonl',
   });

   const processor = new BatchLogRecordProcessor(exporter);
   ```

2. **Configure SIEM File Ingestion**:
   - Set up SIEM to monitor `/var/log/mcp-server/ocsf-events.jsonl`
   - Configure JSON parsing with OCSF schema
   - Set up log rotation (logrotate or similar)

3. **Log Rotation** (`/etc/logrotate.d/mcp-server`):
   ```
   /var/log/mcp-server/*.jsonl {
     daily
     rotate 30
     compress
     delaycompress
     notifempty
     create 0644 mcp-server mcp-server
   }
   ```

## Event Filtering

Control which events are sent to your SIEM:

### By Severity

```typescript
import { LogRecordProcessor } from '@opentelemetry/sdk-logs';

class SeverityFilterProcessor implements LogRecordProcessor {
  constructor(
    private readonly minSeverity: number,
    private readonly delegate: LogRecordProcessor
  ) {}

  onEmit(logRecord: LogRecord): void {
    const body = JSON.parse(logRecord.body as string);
    if (body.severity_id >= this.minSeverity) {
      this.delegate.onEmit(logRecord);
    }
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }
}

// Only send events with severity Medium (3) or higher
const processor = new SeverityFilterProcessor(
  3,
  new BatchLogRecordProcessor(exporter)
);
```

### By Event Class

```typescript
class EventClassFilterProcessor implements LogRecordProcessor {
  constructor(
    private readonly allowedClasses: number[],
    private readonly delegate: LogRecordProcessor
  ) {}

  onEmit(logRecord: LogRecord): void {
    const body = JSON.parse(logRecord.body as string);
    if (this.allowedClasses.includes(body.class_uid)) {
      this.delegate.onEmit(logRecord);
    }
  }

  // ... forceFlush, shutdown
}

// Only send authentication events (3002)
const processor = new EventClassFilterProcessor(
  [3002],
  new BatchLogRecordProcessor(exporter)
);
```

## Performance Tuning

### Batch Configuration

Optimize batch settings for your environment:

```typescript
const processor = new BatchLogRecordProcessor(exporter, {
  maxQueueSize: 2048,           // Max queued events (default: 2048)
  maxExportBatchSize: 512,      // Events per batch (default: 512)
  scheduledDelayMillis: 5000,   // Batch interval (default: 5000ms)
  exportTimeoutMillis: 30000,   // Export timeout (default: 30000ms)
});
```

**Recommendations:**
- **High-volume**: Increase `maxExportBatchSize` to 1024+
- **Low-latency**: Decrease `scheduledDelayMillis` to 1000ms
- **Network issues**: Increase `exportTimeoutMillis` to 60000ms

### Sampling

For extremely high-volume environments, implement sampling:

```typescript
class SamplingProcessor implements LogRecordProcessor {
  constructor(
    private readonly sampleRate: number,  // 0.0 to 1.0
    private readonly delegate: LogRecordProcessor
  ) {}

  onEmit(logRecord: LogRecord): void {
    if (Math.random() < this.sampleRate) {
      this.delegate.onEmit(logRecord);
    }
  }

  // ... forceFlush, shutdown
}

// Send 10% of events
const processor = new SamplingProcessor(
  0.1,
  new BatchLogRecordProcessor(exporter)
);
```

## Troubleshooting

### Events Not Appearing in SIEM

**Check OTEL exporter logs**:
```typescript
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

// Enable debug logging
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
```

**Verify endpoint connectivity**:
```bash
# Test OTLP HTTP endpoint
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"resourceLogs":[]}' \
  $OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
```

**Check SIEM ingestion logs** for parsing errors or quota limits.

### High Memory Usage

**Symptoms**: OOM errors, increasing memory consumption

**Solutions**:
1. Reduce `maxQueueSize` in BatchLogRecordProcessor
2. Implement event filtering (reduce volume)
3. Increase batch export frequency (decrease `scheduledDelayMillis`)
4. Enable sampling for high-volume events

### Missing Trace Correlation

**Symptoms**: `trace_id` or `span_id` missing from events

**Solution**: Ensure OpenTelemetry tracing is enabled:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';

const sdk = new NodeSDK({
  instrumentations: [
    new HttpInstrumentation(),
  ],
  // ... log processors
});

sdk.start();
```

### Event Schema Validation Errors

**Symptoms**: SIEM rejects events due to schema mismatch

**Solution**: Verify OCSF version compatibility:
- This implementation uses OCSF 1.3.0
- Check SIEM's supported OCSF version
- Update builders if SIEM requires different version

## References

- **OCSF Documentation**: https://schema.ocsf.io/
- **OpenTelemetry Logs**: https://opentelemetry.io/docs/specs/otel/logs/
- **AWS Security Lake**: https://docs.aws.amazon.com/security-lake/
- **Splunk OTEL**: https://docs.splunk.com/Observability/gdi/opentelemetry/opentelemetry.html
- **Datadog OTEL**: https://docs.datadoghq.com/opentelemetry/
- **Elastic OTEL**: https://www.elastic.co/guide/en/apm/guide/current/open-telemetry.html
