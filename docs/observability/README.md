# Observability Documentation

This directory contains documentation for the MCP TypeScript Simple observability and audit logging system.

## Table of Contents

### OCSF Structured Audit Events

- **[OCSF Event Catalog](ocsf-event-catalog.md)** - Complete catalog of all OCSF events emitted by the server
  - Authentication events (logon, logoff, failures)
  - API activity events (tool invocations, secret operations)
  - Event correlation and severity mapping

- **[SIEM Integration Guide](siem-integration.md)** - How to integrate with SIEM systems
  - AWS Security Lake (native OCSF support)
  - Splunk (via HTTP Event Collector)
  - Datadog (via Agent or API)
  - Elastic Security (via Elasticsearch)
  - Generic SIEM (file-based integration)
  - Event filtering and performance tuning
  - Troubleshooting

### Getting Started

The MCP server automatically emits OCSF-compliant audit events via OpenTelemetry logs. No configuration required!

**Quick Links:**
- **What events are emitted?** → [OCSF Event Catalog](ocsf-event-catalog.md)
- **How do I send events to my SIEM?** → [SIEM Integration Guide](siem-integration.md)
- **What is OCSF?** → [OCSF Schema Browser](https://schema.ocsf.io/)

### Architecture

```
┌─────────────────┐
│   MCP Server    │
│   Operations    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  OCSF Builders  │  ← Type-safe event construction
│  (Auth, API)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  OCSF-OTEL      │  ← Emit as OpenTelemetry logs
│    Bridge       │     with trace correlation
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ OTEL Exporter   │  ← Configurable destination
│  (HTTP, File)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   SIEM System   │  ← AWS Security Lake, Splunk,
│                 │     Datadog, Elastic, etc.
└─────────────────┘
```

### Key Features

- **Standards-Based**: OCSF 1.3.0 compliance for interoperability
- **Vendor-Neutral**: Switch SIEM vendors without code changes
- **Zero-Config**: Automatic event emission via observability package
- **Rich Context**: Trace correlation, session tracking, user attribution
- **Type-Safe**: Compile-time validation of event structure
- **Compliance-Ready**: SOC 2, ISO 27001, GDPR, HIPAA compatible

### Event Classes

| Class | Name | Purpose | Events |
|-------|------|---------|--------|
| 3002 | Authentication | Track login/logout operations | Logon Success, Logon Failure, Logoff |
| 6003 | API Activity | Track API and tool operations | Tool Invocation, Secret Read/Write |

See [OCSF Event Catalog](ocsf-event-catalog.md) for complete event details.

### Integration Examples

**AWS Security Lake** (native OCSF):
```typescript
const exporter = new OTLPLogExporter({
  url: process.env.AWS_SECURITY_LAKE_ENDPOINT,
  headers: { 'x-amz-security-lake-source': 'mcp-server' },
});
```

**Splunk** (HEC):
```typescript
const exporter = new OTLPLogExporter({
  url: process.env.SPLUNK_HEC_ENDPOINT,
  headers: { 'Authorization': `Splunk ${process.env.SPLUNK_HEC_TOKEN}` },
});
```

**Datadog** (Agent):
```typescript
const exporter = new OTLPLogExporter({
  url: 'http://localhost:4318/v1/logs',  // Datadog Agent OTLP
});
```

See [SIEM Integration Guide](siem-integration.md) for complete setup instructions.

### Compliance Mapping

OCSF events support these compliance frameworks:

- **SOC 2** - Audit logging, access control, session management
- **ISO 27001** - Information security event management
- **GDPR** - User activity tracking, consent events
- **HIPAA** - Access audit trails, authentication events

For detailed control mappings, see [docs/security/compliance-mapping.md](../security/compliance-mapping.md).

### Related Documentation

- **[Security Documentation](../security/)** - Overall security architecture
- **[Deployment Guide](../vercel-deployment.md)** - Production deployment
- **[Testing Guidelines](../testing-guidelines.md)** - Testing audit events

### References

- **OCSF Official Site**: https://ocsf.io/
- **OCSF Schema Browser**: https://schema.ocsf.io/
- **OpenTelemetry Logs**: https://opentelemetry.io/docs/specs/otel/logs/
- **AWS Security Lake**: https://aws.amazon.com/security-lake/
