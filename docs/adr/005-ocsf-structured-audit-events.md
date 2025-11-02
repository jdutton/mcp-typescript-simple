# ADR-005: OCSF Structured Audit Events

## Status
Accepted

## Context

The MCP TypeScript server requires comprehensive security audit logging to track:
1. **Authentication events**: OAuth flows, session creation/termination, token usage
2. **API activity**: HTTP requests/responses with security-relevant metadata
3. **Secret management operations**: Secret retrieval, storage, and lifecycle events
4. **Compliance requirements**: GDPR, HIPAA, SOC 2, ISO 27001 audit trails

### Current State (Pre-OCSF)
- **Unstructured logging**: Ad-hoc log messages via Pino logger
- **Inconsistent event structure**: No standardized security event schema
- **Limited querying capability**: Difficult to extract security insights from logs
- **Compliance gaps**: Hard to demonstrate compliance with security frameworks

### Requirements
1. **Standardized schema**: Industry-standard event format for SIEM integration
2. **OpenTelemetry integration**: Must work with existing OTEL observability stack
3. **Security-first design**: PII protection, tamper-evident audit trails
4. **Zero runtime overhead**: Async emission, no blocking on audit events
5. **Production-ready**: Complete test coverage, Grafana dashboard visualization

### Standards Evaluation

**OCSF (Open Cybersecurity Schema Framework)**:
- ✅ **Industry standard**: Backed by AWS, Splunk, IBM, CrowdStrike
- ✅ **Comprehensive security coverage**: 40+ event classes
- ✅ **SIEM compatibility**: Native support in Splunk, Sumo Logic, Datadog
- ✅ **TypeScript support**: Strong typing via `@ocsf/schema` npm package
- ✅ **Extensibility**: Custom attributes via `unmapped` field

**Alternative: CEF (Common Event Format)**:
- ❌ String-based format (harder to parse)
- ❌ Limited type safety
- ❌ Aging standard (superseded by modern alternatives)

**Alternative: Custom JSON Schema**:
- ❌ No SIEM native support
- ❌ Requires custom parsers
- ❌ No community support

**Decision**: OCSF is the clear winner for standardized security audit events.

## Decision

### Architecture Overview

Implement **OCSF-OTEL Bridge** for structured security audit events:

```
┌──────────────────────────────────────────────────────────────┐
│                    Application Layer                          │
│  (auth, secrets, http-server)                                │
└────────────────┬─────────────────────────────────────────────┘
                 │ emitOCSFEvent()
                 ↓
┌──────────────────────────────────────────────────────────────┐
│              OCSF Builder Layer                              │
│  - AuthenticationBuilder (Class 3002)                         │
│  - APIActivityBuilder (Class 6003)                           │
│  - Fluent API with type-safe schema                          │
└────────────────┬─────────────────────────────────────────────┘
                 │ build()
                 ↓
┌──────────────────────────────────────────────────────────────┐
│            OCSFOTELBridge (Singleton)                        │
│  - Converts OCSF → OpenTelemetry LogRecords                  │
│  - Injects trace context (trace_id, span_id)                 │
│  - Adds environment metadata                                 │
└────────────────┬─────────────────────────────────────────────┘
                 │ logRecord.emit()
                 ↓
┌──────────────────────────────────────────────────────────────┐
│         OpenTelemetry Logs SDK                               │
│  - Batch processing                                          │
│  - OTLP export                                               │
│  - Grafana Loki ingestion                                    │
└──────────────────────────────────────────────────────────────┘
```

### Core Components

#### 1. OCSF Event Classes

**Authentication Events (Class 3002 - Authentication)**:
- Logon/logoff events
- OAuth authorization flows
- Token validation and refresh
- Session lifecycle (create, resume, expire)
- PII protection: email hashing, safe IP sanitization

**API Activity Events (Class 6003 - API Activity)**:
- HTTP request/response metadata
- Status codes, methods, paths
- Request/response body sizes
- User agent and client IP
- OAuth provider and session correlation

#### 2. Builder Pattern for Type Safety

**AuthenticationBuilder**:
```typescript
const event = new AuthenticationBuilder()
  .logon()
  .successful()
  .withUser('user@example.com')
  .withAuthProvider('google')
  .withSessionId('session-uuid')
  .withIP('192.0.2.1')
  .build();
```

**APIActivityBuilder**:
```typescript
const event = new APIActivityBuilder()
  .withHTTPRequest(req)
  .withHTTPResponse(res)
  .withStatusCode(200)
  .withDuration(startTime)
  .build();
```

#### 3. OpenTelemetry Integration

**OCSF-OTEL Bridge**:
- Converts OCSF events to OpenTelemetry `LogRecord` format
- Injects W3C trace context for correlation
- Adds structured attributes (OCSF fields → OTEL attributes)
- Singleton pattern for performance
- Environment-aware (development vs production)

**Trace Correlation**:
- `trace_id`: Links events to distributed traces
- `span_id`: Associates events with specific operations
- `session_id`: Correlates events within user sessions

#### 4. Security Features

**PII Protection**:
- Email hashing (SHA-256) for compliance
- IP address sanitization (IPv6 normalization)
- Token prefix logging (first 10 chars only)
- Configurable PII masking via OTEL processors

**Tamper-Evident Logging**:
- Immutable event structure (OCSF schema validation)
- Cryptographic trace IDs (prevents log injection)
- Structured format (prevents log forging)

**Compliance Support**:
- GDPR: PII minimization, data retention policies
- HIPAA: Audit trail for PHI access
- SOC 2: Complete authentication and API access logs
- ISO 27001: Security event monitoring

### Implementation Details

#### Packages Structure

```
packages/
├── observability/
│   ├── src/
│   │   ├── ocsf/
│   │   │   ├── builders/
│   │   │   │   ├── authentication-builder.ts   # Class 3002
│   │   │   │   ├── api-activity-builder.ts     # Class 6003
│   │   │   │   └── base-builder.ts             # Shared logic
│   │   │   ├── types/
│   │   │   │   ├── authentication.ts           # TypeScript types
│   │   │   │   ├── api-activity.ts
│   │   │   │   └── base.ts
│   │   │   ├── ocsf-otel-bridge.ts            # OCSF → OTEL
│   │   │   └── index.ts
│   │   └── middleware/
│   │       └── ocsf-middleware.ts              # Express middleware
│   └── test/
│       ├── unit/ocsf/                         # 68 unit tests
│       └── integration/                       # 10 integration tests
```

#### Middleware Integration

**Express HTTP Server** (packages/http-server):
- Global OCSF middleware in `server-factory.ts`
- Automatic API activity event emission
- Request/response body size tracking
- Error handling and status code capture

**BaseSecretsProvider** (packages/config):
- Authentication events for secret operations
- Logon/logoff events for cache lifecycle
- Session correlation for audit trail

#### Testing Strategy

**Unit Tests (68 tests)**:
- Builder API validation
- OCSF schema compliance
- Event field correctness
- PII protection mechanisms

**Integration Tests (10 tests)**:
- Real OpenTelemetry setup
- OTEL Logs SDK integration
- Trace context injection
- Multiple event emission
- Singleton pattern validation

**Grafana Dashboard**:
- Visual validation of OCSF events
- Security event timeline
- Authentication success/failure rates
- API activity monitoring

### Configuration

**Environment Variables**:
- `OTEL_EXPORTER_OTLP_ENDPOINT`: Optional OTLP collector endpoint
  - **If set**: OCSF events exported via OTLP (logs, traces, metrics) → Grafana/external collectors
  - **If not set**: OCSF events emitted to console (stdout) → Vercel logs, Docker logs, terminal output
  - **Auto-detection**: System automatically adapts to environment without additional configuration
- `NODE_ENV`: Controls PII hashing and verbosity (development vs production)

**Deployment Behavior Matrix**:

| Environment | OTLP Configured? | OCSF Events Go To | Visible Where |
|---|---|---|---|
| Local dev (`npm run dev:http`) | No | stdout (console) | Terminal |
| Local dev (`npm run dev:otel`) | Yes (localhost:4318) | OTLP → Grafana | Grafana UI (port 3200) |
| **Vercel production** | No | stdout (console) | **Vercel logs dashboard** ✅ |
| Vercel with OTLP | Yes (external URL) | OTLP → Collector | External service |
| Docker Compose | Yes (otel-collector:4318) | OTLP → Loki | Grafana dashboards |
| Standalone Docker | No | stdout (console) | `docker logs` |
| Kubernetes | Yes (cluster collector) | OTLP → Collector | Cluster observability |

**Viewing OCSF Events**:
- **Grafana** (with OTLP): Pre-built dashboards at http://localhost:3200 (see docs/grafana-ocsf-guide.md)
- **Vercel**: Logs dashboard → Filter for `class_name` or `category_name` fields
- **Docker**: `docker logs <container>` → OCSF events appear as structured JSON
- **Local terminal**: Console output with ConsoleLogRecordExporter formatting
- **SIEM integration**: Configure OTLP export to Splunk, Sumo Logic, Datadog, etc.

**Zero-Config Design**:
- Automatic OTLP endpoint detection (no hardcoded defaults)
- Console fallback ensures OCSF events always visible
- Works universally: local dev, Docker, Vercel, Kubernetes, bare metal
- No breaking changes to existing deployments

## Consequences

### Benefits

**Security & Compliance**:
- ✅ **Standardized audit trail**: OCSF events for SIEM integration
- ✅ **PII protection**: Email hashing, safe IP sanitization
- ✅ **Compliance ready**: GDPR, HIPAA, SOC 2, ISO 27001
- ✅ **Tamper-evident logging**: Immutable structured events

**Developer Experience**:
- ✅ **Type-safe API**: Builder pattern with strong typing
- ✅ **Zero-config**: Works with existing OTEL setup
- ✅ **Visual validation**: Grafana dashboard for local dev
- ✅ **Comprehensive tests**: 78 tests (68 unit + 10 integration)

**Production Readiness**:
- ✅ **Async emission**: No blocking on audit events
- ✅ **Batch processing**: OTEL SDK handles efficient export
- ✅ **Trace correlation**: Links events to distributed traces
- ✅ **Environment-aware**: Development vs production mode

**Observability**:
- ✅ **SIEM integration**: Native support in Splunk, Sumo Logic, Datadog
- ✅ **Grafana visualization**: Security event dashboards
- ✅ **Query-friendly**: Structured OCSF schema for filtering
- ✅ **Retention policies**: OTEL collector configuration

### Trade-offs

**Payload Size**:
- OCSF events are verbose (100-200 bytes per event)
- Mitigated by: OTLP compression, batch export, sampling

**Learning Curve**:
- Developers need to learn OCSF schema
- Mitigated by: Builder API abstracts complexity, comprehensive docs

**Dependency**:
- Requires OpenTelemetry Logs SDK (`@opentelemetry/api-logs`, `@opentelemetry/sdk-logs`)
- Mitigated by: Already using OTEL for traces/metrics, no new stack

### Alternatives Considered (and Rejected)

**1. Continue with Unstructured Logging**:
- ❌ No SIEM integration
- ❌ Hard to query security events
- ❌ Compliance gaps

**2. Custom JSON Schema**:
- ❌ No SIEM native support
- ❌ Requires custom parsers
- ❌ No community support

**3. Direct OTEL Logs (No OCSF)**:
- ❌ No standardized security schema
- ❌ Ad-hoc event structure
- ❌ Limited SIEM interoperability

## Implementation Timeline

**Phase 1: Core Infrastructure** (Complete):
- ✅ OCSF builders (Authentication, API Activity)
- ✅ OCSF-OTEL bridge
- ✅ TypeScript type definitions
- ✅ Unit tests (68 tests)

**Phase 2: Integration** (Complete):
- ✅ Express middleware (global OCSF events)
- ✅ BaseSecretsProvider integration (secret audit events)
- ✅ Integration tests (10 tests)
- ✅ Grafana dashboard

**Phase 3: Production Hardening** (Complete):
- ✅ PII protection (email hashing, IP sanitization)
- ✅ Error handling (silent failures for audit events)
- ✅ Performance optimization (singleton pattern, async emission)
- ✅ Documentation (README, ADR, inline docs)

**Phase 4: Future Enhancements** (Optional):
- ⏳ Rate limiting for high-volume scenarios (>1000 events/sec)
- ⏳ Additional OCSF event classes (File Activity, Network Activity)
- ⏳ Custom OCSF attributes for MCP-specific metadata

## References

- **OCSF Specification**: https://schema.ocsf.io/
- **OCSF GitHub**: https://github.com/ocsf
- **OpenTelemetry Logs**: https://opentelemetry.io/docs/specs/otel/logs/
- **W3C Trace Context**: https://www.w3.org/TR/trace-context/
- **Grafana Loki**: https://grafana.com/docs/loki/

## Related ADRs

- ADR-001: OpenTelemetry Observability Architecture (OTEL foundation)
- ADR-003: Horizontal Scalability via Metadata Reconstruction (session management)
- ADR-004: Encryption Infrastructure (secret management security)
