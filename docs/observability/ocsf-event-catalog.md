# OCSF Event Catalog

This document catalogs all OCSF (Open Cybersecurity Schema Framework) events emitted by the MCP TypeScript Simple server. These events provide a standards-based audit trail compatible with SIEM systems like AWS Security Lake, Splunk, and Datadog.

## Table of Contents

- [Overview](#overview)
- [Event Classes](#event-classes)
- [Authentication Events](#authentication-events)
- [API Activity Events](#api-activity-events)
- [Event Correlation](#event-correlation)
- [Severity Mapping](#severity-mapping)
- [References](#references)

## Overview

All OCSF events are automatically emitted as OpenTelemetry logs with:

- **Automatic trace correlation**: Events include `trace_id` and `span_id` from active OpenTelemetry spans
- **Structured attributes**: Full OCSF event as JSON in log attributes
- **Severity mapping**: OCSF severity automatically mapped to OTEL severity
- **Zero configuration**: Events are emitted automatically via the observability package

### OCSF Version

This implementation follows **OCSF 1.3.0** specification.

## Event Classes

### Authentication Event (Class 3002)

Tracks authentication operations (login, logout, authentication failures).

**Used for:**
- OAuth login success/failure
- Session logout
- Authorization failures (allowlist denials)

### API Activity Event (Class 6003)

Tracks API and tool invocation activities.

**Used for:**
- MCP tool invocations (success/failure)
- Secret read/write operations
- API endpoint calls

## Authentication Events

### Logon Success

**Activity:** `Logon` (1)
**Status:** `Success` (1)
**Severity:** `Informational` (1)

**Example:**
```json
{
  "activity_id": 1,
  "activity_name": "Logon",
  "category_uid": 3,
  "category_name": "Identity & Access Management",
  "class_uid": 3002,
  "class_name": "Authentication",
  "severity_id": 1,
  "severity": "Informational",
  "status": "Success",
  "status_id": 1,
  "time": 1730000000000,
  "type_uid": 300201,
  "type_name": "Authentication: Logon",
  "actor": {
    "user": {
      "name": "user@example.com",
      "email_addr": "user@example.com",
      "uid": "oauth|google|123456789"
    },
    "session": {
      "uid": "550e8400-e29b-41d4-a716-446655440000"
    }
  },
  "auth_protocol": "OAuth 2.0",
  "auth_protocol_id": 4,
  "logon_type": "Interactive",
  "logon_type_id": 2,
  "src_endpoint": {
    "ip": "192.168.1.100",
    "port": 54321
  },
  "http_request": {
    "user_agent": "Mozilla/5.0...",
    "url": {
      "path": "/auth/callback/google"
    }
  }
}
```

**Emitted when:**
- OAuth callback succeeds (`packages/auth/src/providers/base-provider.ts:1084`)
- Token exchange succeeds (`packages/auth/src/providers/base-provider.ts:1175`)

### Logon Failure

**Activity:** `Logon` (1)
**Status:** `Failure` (2)
**Severity:** `Medium` (3)

**Example:**
```json
{
  "activity_id": 1,
  "activity_name": "Logon",
  "status": "Failure",
  "status_id": 2,
  "severity_id": 3,
  "severity": "Medium",
  "status_detail": "Invalid authorization code",
  "actor": {
    "user": {
      "name": "unknown",
      "uid": "unauthenticated"
    }
  },
  "auth_protocol": "OAuth 2.0",
  "auth_protocol_id": 4
}
```

**Emitted when:**
- OAuth callback fails (`packages/auth/src/providers/base-provider.ts:1103`)
- Token exchange fails (`packages/auth/src/providers/base-provider.ts:1197`)

### Authorization Failure (Allowlist Denial)

**Activity:** `Logon` (1)
**Status:** `Failure` (2)
**Severity:** `High` (4)

**Example:**
```json
{
  "activity_id": 1,
  "activity_name": "Logon",
  "status": "Failure",
  "status_id": 2,
  "severity_id": 4,
  "severity": "High",
  "status_detail": "Email not in allowlist: user@example.com",
  "actor": {
    "user": {
      "name": "user@example.com",
      "email_addr": "user@example.com",
      "uid": "oauth|google|123456789"
    }
  },
  "auth_protocol": "OAuth 2.0",
  "auth_protocol_id": 4
}
```

**Emitted when:**
- User email not in allowlist (`packages/auth/src/providers/base-provider.ts:1060-1070`)

### Logoff Success

**Activity:** `Logoff` (2)
**Status:** `Success` (1)
**Severity:** `Informational` (1)

**Example:**
```json
{
  "activity_id": 2,
  "activity_name": "Logoff",
  "status": "Success",
  "status_id": 1,
  "severity_id": 1,
  "severity": "Informational",
  "actor": {
    "user": {
      "name": "user@example.com",
      "email_addr": "user@example.com",
      "uid": "oauth|google|123456789"
    },
    "session": {
      "uid": "550e8400-e29b-41d4-a716-446655440000"
    }
  },
  "auth_protocol": "OAuth 2.0",
  "auth_protocol_id": 4
}
```

**Emitted when:**
- Logout succeeds (`packages/auth/src/providers/base-provider.ts:1223`)

### Logoff Failure

**Activity:** `Logoff` (2)
**Status:** `Failure` (2)
**Severity:** `Low` (2)

**Example:**
```json
{
  "activity_id": 2,
  "activity_name": "Logoff",
  "status": "Failure",
  "status_id": 2,
  "severity_id": 2,
  "severity": "Low",
  "status_detail": "Session not found",
  "actor": {
    "user": {
      "name": "unknown",
      "uid": "unauthenticated"
    }
  },
  "auth_protocol": "OAuth 2.0",
  "auth_protocol_id": 4
}
```

**Emitted when:**
- Logout fails (`packages/auth/src/providers/base-provider.ts:1228`)

## API Activity Events

### MCP Tool Invocation (Success)

**Activity:** `Access` (1)
**Status:** `Success` (1)
**Severity:** `Informational` (1)

**Example:**
```json
{
  "activity_id": 1,
  "activity_name": "Access",
  "category_uid": 6,
  "category_name": "Application Activity",
  "class_uid": 6003,
  "class_name": "API Activity",
  "severity_id": 1,
  "severity": "Informational",
  "status": "Success",
  "status_id": 1,
  "time": 1730000000000,
  "type_uid": 600301,
  "type_name": "API Activity: Access",
  "actor": {
    "user": {
      "name": "system",
      "uid": "system"
    }
  },
  "api": {
    "operation": "invoke",
    "service": {
      "name": "mcp.tool"
    },
    "version": "1.0"
  },
  "resources": [
    {
      "name": "hello",
      "type": "tool"
    }
  ],
  "http_request": {
    "user_agent": "MCP Client/1.0"
  }
}
```

**Emitted when:**
- MCP tool invocation succeeds (`packages/tools/src/tools/registry.ts`)

### MCP Tool Invocation (Failure)

**Activity:** `Access` (1)
**Status:** `Failure` (2)
**Severity:** `Medium` (3)

**Example:**
```json
{
  "activity_id": 1,
  "activity_name": "Access",
  "status": "Failure",
  "status_id": 2,
  "severity_id": 3,
  "severity": "Medium",
  "status_detail": "Tool execution failed: Invalid parameter",
  "actor": {
    "user": {
      "name": "system",
      "uid": "system"
    }
  },
  "api": {
    "operation": "invoke",
    "service": {
      "name": "mcp.tool"
    },
    "version": "1.0"
  },
  "resources": [
    {
      "name": "analyze",
      "type": "tool"
    }
  ]
}
```

**Emitted when:**
- Tool not found
- Tool validation fails
- Tool execution throws error

### Secret Read Operation (Success)

**Activity:** `Access` (1)
**Status:** `Success` (1)
**Severity:** `Informational` (1)

**Example:**
```json
{
  "activity_id": 1,
  "activity_name": "Access",
  "status": "Success",
  "status_id": 1,
  "severity_id": 1,
  "severity": "Informational",
  "actor": {
    "user": {
      "name": "system",
      "uid": "system"
    }
  },
  "api": {
    "operation": "read",
    "service": {
      "name": "secrets"
    },
    "version": "1.0"
  },
  "resources": [
    {
      "name": "ANTHROPIC_API_KEY",
      "type": "secret"
    }
  ]
}
```

**Emitted when:**
- Secret successfully retrieved from secrets provider (`packages/config/src/secrets/base-secrets-provider.ts`)

### Secret Write Operation (Success)

**Activity:** `Create` (2) or `Update` (3)
**Status:** `Success` (1)
**Severity:** `Informational` (1)

**Example:**
```json
{
  "activity_id": 2,
  "activity_name": "Create",
  "status": "Success",
  "status_id": 1,
  "severity_id": 1,
  "severity": "Informational",
  "actor": {
    "user": {
      "name": "admin",
      "uid": "admin"
    }
  },
  "api": {
    "operation": "write",
    "service": {
      "name": "secrets"
    },
    "version": "1.0"
  },
  "resources": [
    {
      "name": "ANTHROPIC_API_KEY",
      "type": "secret"
    }
  ]
}
```

**Emitted when:**
- Secret created or updated in secrets provider (`packages/config/src/secrets/base-secrets-provider.ts`)

## Event Correlation

All OCSF events include OpenTelemetry trace correlation:

```json
{
  "observables": [
    {
      "name": "trace_id",
      "value": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
      "type": "Trace ID",
      "type_id": 99
    },
    {
      "name": "span_id",
      "value": "q7r8s9t0u1v2w3x4",
      "type": "Span ID",
      "type_id": 99
    }
  ]
}
```

This enables:
- **Distributed tracing**: Link audit events to request traces
- **Cross-service correlation**: Track operations across microservices
- **Root cause analysis**: Trace failures back through multiple systems

## Severity Mapping

OCSF severity levels are automatically mapped to OpenTelemetry severity:

| OCSF Severity | ID | OTEL Severity | OTEL Level | Use Case |
|---------------|----|--------------|-----------:|----------|
| Informational | 1  | INFO         | 9          | Normal operations (logon success, tool invocation) |
| Low           | 2  | INFO         | 9          | Minor issues (logoff failure) |
| Medium        | 3  | WARN         | 13         | Authentication failures, tool errors |
| High          | 4  | ERROR        | 17         | Authorization denials (allowlist) |
| Critical      | 5  | FATAL        | 21         | System failures (not currently used) |

## References

- **OCSF Schema Browser**: https://schema.ocsf.io/
- **Authentication Event Class**: https://schema.ocsf.io/1.3.0/classes/authentication?extensions=
- **API Activity Event Class**: https://schema.ocsf.io/1.3.0/classes/api_activity?extensions=
- **OpenTelemetry Logs**: https://opentelemetry.io/docs/specs/otel/logs/
- **OTEL Severity Mapping**: https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber
