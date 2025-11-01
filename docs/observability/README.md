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

### PII Handling and Privacy Considerations

**IMPORTANT**: OCSF audit events include user identification fields such as email addresses. Ensure your OpenTelemetry exporter configuration complies with your organization's data privacy policies.

#### What PII is Logged?

OCSF events may contain:
- **Email addresses** (`ocsf.actor.user.email_addr`) - included in authentication and API activity events
- **Session IDs** (`ocsf.actor.session.uid`) - UUIDs that contain no personal information
- **User names** (`ocsf.actor.user.name`) - typically email or username

#### Privacy-Sensitive Deployments

For deployments requiring PII minimization (GDPR Article 25, CCPA, HIPAA):

**Option 1: Hash email addresses before logging** (future enhancement):
```typescript
// Example of email hashing (not yet implemented)
const hashedEmail = crypto.createHash('sha256')
  .update(email + SALT)
  .digest('hex');
```

**Option 2: Configure SIEM retention policies**:
- Set appropriate retention periods for audit logs containing PII
- Configure data masking/redaction in your SIEM system
- Use OTEL SDK processors to filter sensitive attributes before export

#### SIEM Log Retention Policies

**WARNING**: Once audit events are exported to your SIEM, they follow your SIEM's retention policy. Ensure your retention period complies with:
- **GDPR**: Right to erasure (Article 17) - retain only as long as necessary
- **CCPA**: Right to deletion - provide mechanisms for data deletion
- **HIPAA**: 6-year minimum retention for audit logs
- **SOC 2**: Retain audit logs per your organization's policy

**Recommended retention periods**:
- **Development/Staging**: 30-90 days
- **Production**: 1-2 years (or as required by compliance frameworks)
- **High-security environments**: 3-7 years

#### OTEL Exporter Configuration Examples

**Filter sensitive attributes** (using OTEL SDK processors):
```typescript
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';

// Custom processor to mask email addresses
class PIIMaskingProcessor extends SimpleLogRecordProcessor {
  onEmit(logRecord) {
    // Mask email_addr attribute
    if (logRecord.attributes['ocsf.actor.user.email_addr']) {
      logRecord.attributes['ocsf.actor.user.email_addr'] = '***@***.***';
    }
    super.onEmit(logRecord);
  }
}

const exporter = new OTLPLogExporter({ url: process.env.OTEL_ENDPOINT });
const processor = new PIIMaskingProcessor(exporter);
```

**Configure SIEM-side masking** (Splunk example):
```xml
<!-- props.conf -->
[ocsf]
SEDCMD-mask_email = s/("email_addr":\s*")[^"]+/\1***@***.***"/g
```

#### Compliance Checklist

Before enabling observability in production:

- [ ] Review PII fields included in OCSF events (see [OCSF Event Catalog](ocsf-event-catalog.md))
- [ ] Configure SIEM retention policy per compliance requirements
- [ ] Implement data masking/redaction if required
- [ ] Document PII handling in privacy policy
- [ ] Test data deletion procedures (GDPR/CCPA right to erasure)
- [ ] Review OTEL exporter configuration for security (TLS, authentication)

#### Session IDs are Safe

**Session IDs (UUIDs) contain no personal information** and are safe to log without privacy concerns:
- Random UUIDs (v4) are cryptographically generated
- Cannot be reverse-engineered to identify users
- Used for correlation and tracing only

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
