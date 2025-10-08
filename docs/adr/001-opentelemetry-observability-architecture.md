# ADR-001: OpenTelemetry Observability Architecture

## Status
Proposed

## Context

Issue #20 requires implementing structured logging and observability with OpenTelemetry (OTEL) for the MCP TypeScript server. The solution must:

1. **Support multiple deployment targets**: Express.js, Kubernetes, and Vercel serverless
2. **Provide comprehensive observability**: Logging, metrics, tracing, and profiling
3. **Enable local development validation**: Real-time observability during development
4. **Maintain security**: Never log PII at the source
5. **Preserve performance**: Minimal overhead, especially for Vercel serverless functions
6. **Session correlation**: Link operations across requests within user sessions

### Current State
- Basic console-based logging via `src/utils/logger.ts`
- Production-safe sanitization of sensitive data
- Session management with UUID v4 identifiers
- Multi-transport support (STDIO and HTTP)
- OAuth authentication flows

### Requirements Analysis

**Cross-Platform Compatibility**:
- **Express.js**: Full Node.js runtime, supports complete OTEL instrumentation
- **Kubernetes**: Native OTEL Operator support, DaemonSet collectors
- **Vercel Serverless**: Edge runtime limitations, requires conditional instrumentation

**Observability Pillars Needed**:
- **Logging**: Structured JSON logs with trace correlation
- **Metrics**: MCP protocol, tool performance, session lifecycle
- **Tracing**: Distributed traces across tool invocations and LLM calls
- **Profiling**: Performance optimization (via Grafana LGTM)

## Decision

### Architecture Overview

Implement a **multi-tier observability architecture** with environment-aware configuration:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Development   │    │    Production    │    │   Vercel Edge   │
│                 │    │                  │    │                 │
│ Pino → Console  │    │ Pino → OTLP →   │    │ Lightweight →   │
│      → LGTM     │    │        External │    │        OTLP     │
│                 │    │                  │    │                 │
│ Full OTEL       │    │ Sampled OTEL    │    │ Minimal OTEL    │
│ Port 3200       │    │ Batch Export    │    │ Conditional     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Core Components

#### 1. Structured Logging (Pino-based)
- **Replace** existing Logger with Pino wrapper
- **Maintain** backward compatibility with current interface
- **Add** trace context injection (trace_id, span_id, session_id)
- **Preserve** existing security sanitization logic
- **Environment-specific transports**:
  - Development: Pretty console + OTEL transport to Grafana LGTM
  - Production: JSON + OTLP export to external collectors

#### 2. Metrics Collection
**MCP Protocol Metrics**:
- Message types (request/response/notification) by count and latency
- Protocol version distribution
- Transport mode usage (STDIO vs HTTP)
- Error rates by message type

**Tool Performance Metrics**:
- Invocation count and duration per tool
- Success/failure rates
- Parameter validation failures
- LLM provider usage and latency

**Session Metrics**:
- Active session count and duration distribution
- Authentication success/failure rates
- OAuth provider distribution
- Session timeout events

#### 3. Distributed Tracing
- **W3C Trace Context** standard for universal compatibility
- **Session correlation** using secure UUID v4 identifiers
- **Span creation** for:
  - MCP message handling
  - Tool invocations
  - LLM API calls
  - OAuth authentication flows
  - Session lifecycle events

#### 4. Local Development Environment
- **Grafana LGTM** container on **port 3200** (avoiding app port conflicts)
- **Zero configuration** startup with npm scripts
- **Real-time visualization** of logs, metrics, traces, and profiles
- **Telemetry validation** during development

### Implementation Structure

```
src/observability/
├── index.ts              # Main OTEL initialization
├── instrumentation.ts    # Auto-instrumentation (Node.js)
├── instrumentation-edge.ts # Lightweight edge runtime
├── logger.ts             # Pino wrapper with OTEL
├── metrics.ts            # Custom MCP metrics
├── tracing.ts            # Span management
├── config.ts             # Environment detection
└── session-correlation.ts # Secure session tracking
```

### Security Architecture

**PII Prevention at Source**:
- **Never log PII** - prevent at logging statement level
- **Session IDs are safe** - UUID v4 contains no personal information
- **Structured logging** with explicit field selection
- **Code audit requirements** for all logging statements

**Safe to Log**:
- Technical identifiers (UUIDs, trace IDs)
- Timestamps and durations
- Boolean flags (authenticated: true/false)
- Error types (not error messages with user data)
- Performance metrics

**Prohibited from Logging**:
- Email addresses, user names
- Authentication tokens, API keys
- User-provided content
- Personal metadata

### Environment-Specific Configuration

#### Development
- **Grafana LGTM** on port 3200 with full OTEL stack
- **100% sampling** for complete visibility
- **Console logging** with pretty formatting
- **Full session IDs** for maximum debugging capability

#### Production (Express/K8s)
- **OTLP export** to external observability platforms
- **Configurable sampling** (default 10%)
- **JSON logging** for structured processing
- **Session correlation** via secure UUID identifiers

#### Vercel Serverless
- **Runtime detection** (`process.env.NEXT_RUNTIME === 'nodejs'`)
- **Conditional instrumentation** to avoid edge runtime conflicts
- **OTLP export** to external services
- **Minimal overhead** optimizations for cold starts

### Port Allocation Strategy

| Service | Port | Description |
|---------|------|-------------|
| MCP HTTP Server | 3000 | Main application |
| MCP CI Testing | 3001-3002 | Test instances |
| **Grafana UI** | **3200** | **Observability dashboard** |
| OTLP gRPC | 4317 | Telemetry ingestion |
| OTLP HTTP | 4318 | Telemetry ingestion |

## Consequences

### Benefits

**Enhanced Debugging**:
- Complete request tracing across tool invocations
- Session-based correlation for multi-step workflows
- Visual debugging with Grafana dashboards
- Performance bottleneck identification

**Production Readiness**:
- Industry-standard observability practices
- Vendor-neutral OTLP export
- Scalable metrics and tracing
- Security-first approach to PII

**Developer Experience**:
- Zero-configuration local observability
- Single command setup (`npm run otel:start`)
- Real-time feedback during development
- Cross-platform compatibility

### Risks and Mitigations

**Performance Impact**:
- Risk: OTEL overhead in serverless functions
- Mitigation: Environment-aware sampling and lazy loading

**Complexity**:
- Risk: Increased system complexity
- Mitigation: Gradual rollout, comprehensive documentation

**Security**:
- Risk: Accidental PII logging
- Mitigation: Source-level prevention, code audit requirements

### Migration Strategy

**Phase 1**: Core infrastructure and local development setup
**Phase 2**: Structured logging replacement with backward compatibility
**Phase 3**: Metrics collection and custom instrumentation
**Phase 4**: Production deployment and external integrations
**Phase 5**: Advanced features and optimization

## References

- [OpenTelemetry Specification](https://opentelemetry.io/docs/specs/)
- [Grafana OTEL-LGTM Documentation](https://grafana.com/docs/opentelemetry/docker-lgtm/)
- [Vercel OpenTelemetry Integration](https://vercel.com/docs/otel)
- [Pino Logging Documentation](https://getpino.io/)
- [W3C Trace Context Specification](https://www.w3.org/TR/trace-context/)

## Decision Record

**Date**: 2025-09-29
**Participants**: Jeff Dutton (CTO), Claude Code
**Status**: Proposed
**Review Date**: 2025-10-29