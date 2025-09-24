# MCP TypeScript Simple - HTTP API Documentation

## Overview

This document describes the HTTP API endpoints for the MCP TypeScript Simple server. These endpoints work identically across all deployment modes:
- **Express Standalone** (`npm start`) - Direct implementation
- **Vercel Serverless** (`vercel` or production) - Via serverless functions with rewrites

## Authentication Requirements

> **IMPORTANT**: All API endpoints require OAuth authenticated access **EXCEPT** for the `/health` endpoint which is public and requires no authentication.

### OAuth Bearer Token Authentication

Protected endpoints require a valid OAuth Bearer token in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

Attempting to access protected endpoints without authentication will return:
- **401 Unauthorized** - Missing or invalid token
- **403 Forbidden** - Valid token but insufficient permissions

## API Endpoints

### Public Endpoints (No Authentication Required)

#### Health Check
- **Endpoint**: `GET /health`
- **Description**: Public health check and status monitoring
- **Authentication**: None required
- **Response**: JSON object with server status, deployment info, and configuration

**Example Request**:
```bash
curl -X GET http://localhost:3000/health
```

**Example Response**:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T12:34:56.789Z",
  "deployment": "local",
  "mode": "streamable_http",
  "auth": "enabled",
  "oauth_provider": "google",
  "llm_providers": ["claude", "openai"],
  "version": "1.0.0",
  "node_version": "v20.11.0",
  "environment": "development",
  "sessions": {
    "total": 10,
    "active": 2,
    "expired": 8
  }
}
```

### Protected Endpoints (OAuth Authentication Required)

#### MCP Protocol Endpoint
- **Endpoint**: `POST /mcp`
- **Description**: Main MCP protocol endpoint for Streamable HTTP transport
- **Authentication**: OAuth Bearer token required
- **Content-Type**: `application/json` or `text/event-stream`
- **Response**: Streaming or JSON response based on configuration

**Example Request**:
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "tools/list", "id": 1}'
```

#### MCP Session Cleanup Endpoint
- **Endpoint**: `DELETE /mcp`
- **Description**: Cleanup and terminate an active MCP session
- **Authentication**: OAuth Bearer token required (dev mode: uses `mcp-session-id` header)
- **Headers**:
  - `mcp-session-id`: Session ID to terminate (required)
- **Response**: JSON confirmation of session termination

**Example Request**:
```bash
curl -X DELETE http://localhost:3000/mcp \
  -H "Authorization: Bearer <access_token>" \
  -H "mcp-session-id: <session-uuid>"
```

**Example Success Response (200)**:
```json
{
  "message": "Session successfully terminated",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "requestId": "req_1642251296789",
  "timestamp": "2024-01-15T12:34:56.789Z"
}
```

**Example Error Responses**:

**400 Bad Request** - Missing session ID:
```json
{
  "error": "Bad Request",
  "message": "DELETE requests require mcp-session-id header",
  "requestId": "req_1642251296789",
  "timestamp": "2024-01-15T12:34:56.789Z"
}
```

**404 Not Found** - Session not found:
```json
{
  "error": "Session Not Found",
  "message": "Session 550e8400-e29b-41d4-a716-446655440000 not found or already terminated",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "requestId": "req_1642251296789",
  "timestamp": "2024-01-15T12:34:56.789Z"
}
```

#### OAuth Authentication Endpoints

##### Authorization (Login)
- **Endpoint**: `GET /auth/{provider}`
- **Providers**: `google`, `github`, `microsoft`, or custom provider
- **Description**: Initiates OAuth authorization flow
- **Authentication**: None (starts auth flow)
- **Response**: Redirects to OAuth provider

**Example**:
```bash
# Browser redirect
http://localhost:3000/auth/google
```

##### Callback
- **Endpoint**: `GET /auth/{provider}/callback`
- **Description**: OAuth provider callback endpoint
- **Authentication**: None (receives auth code)
- **Response**: HTML page with access token or error

##### Token Refresh
- **Endpoint**: `POST /auth/{provider}/refresh`
- **Description**: Refresh an expired access token
- **Authentication**: Refresh token in body
- **Response**: New access token

**Example Request**:
```bash
curl -X POST http://localhost:3000/auth/google/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "<refresh_token>"}'
```

##### Logout
- **Endpoint**: `POST /auth/{provider}/logout`
- **Description**: Revoke tokens and end session
- **Authentication**: OAuth Bearer token required
- **Response**: Confirmation of logout

**Example Request**:
```bash
curl -X POST http://localhost:3000/auth/google/logout \
  -H "Authorization: Bearer <access_token>"
```

#### Administration Endpoints

##### Session Management
- **Endpoint**: `GET /admin/sessions`
- **Description**: List active sessions and statistics
- **Authentication**: OAuth Bearer token required
- **Response**: Session list with metadata

**Example Request**:
```bash
curl -X GET http://localhost:3000/admin/sessions \
  -H "Authorization: Bearer <access_token>"
```

**Example Response**:
```json
{
  "sessions": [
    {
      "sessionId": "session_123",
      "createdAt": "2024-01-15T12:00:00.000Z",
      "lastActivity": "2024-01-15T12:30:00.000Z",
      "hasAuth": true,
      "metadata": {}
    }
  ],
  "stats": {
    "total": 10,
    "active": 2,
    "expired": 8
  }
}
```

##### Delete Session
- **Endpoint**: `DELETE /admin/sessions/{sessionId}`
- **Description**: Terminate a specific session
- **Authentication**: OAuth Bearer token required
- **Response**: Confirmation of session closure

**Example Request**:
```bash
curl -X DELETE http://localhost:3000/admin/sessions/session_123 \
  -H "Authorization: Bearer <access_token>"
```

##### Metrics
- **Endpoint**: `GET /admin/metrics`
- **Description**: Detailed metrics and performance data
- **Authentication**: OAuth Bearer token required
- **Response**: Comprehensive metrics object

**Example Request**:
```bash
curl -X GET http://localhost:3000/admin/metrics \
  -H "Authorization: Bearer <access_token>"
```

**Example Response**:
```json
{
  "timestamp": "2024-01-15T12:34:56.789Z",
  "platform": "express-standalone",
  "performance": {
    "uptime_seconds": 3600,
    "memory_usage": {
      "rss": 50331648,
      "heapTotal": 35352576,
      "heapUsed": 20548632
    },
    "cpu_usage": {
      "user": 150000,
      "system": 50000
    }
  },
  "deployment": {
    "mode": "standalone",
    "version": "1.0.0",
    "node_version": "v20.11.0",
    "environment": "development"
  },
  "configuration": {
    "oauth_provider": "google",
    "oauth_configured": true,
    "llm_providers": ["claude", "openai"],
    "transport_mode": "streamable_http"
  },
  "sessions": {
    "total": 10,
    "active": 2,
    "expired": 8
  },
  "endpoints": {
    "health": "/health",
    "mcp": "/mcp",
    "auth": "/auth",
    "admin": "/admin"
  }
}
```

## Error Responses

All endpoints return standard HTTP status codes with JSON error messages:

### Common Error Responses

#### 400 Bad Request
```json
{
  "error": "Bad Request",
  "message": "Invalid request parameters"
}
```

#### 401 Unauthorized
```json
{
  "error": "Unauthorized",
  "message": "Missing or invalid authentication token"
}
```

#### 403 Forbidden
```json
{
  "error": "Forbidden",
  "message": "Insufficient permissions for this resource"
}
```

#### 404 Not Found
```json
{
  "error": "Not found",
  "message": "The requested resource does not exist"
}
```

#### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "message": "An unexpected error occurred"
}
```

## CORS Configuration

The API supports Cross-Origin Resource Sharing (CORS) with the following configuration:

- **Allowed Origins**: Configured via `ALLOWED_ORIGINS` environment variable
- **Allowed Methods**: `GET`, `POST`, `DELETE`, `OPTIONS`
- **Allowed Headers**: `Content-Type`, `Authorization`, `X-Last-Event-ID`
- **Credentials**: Supported

## Rate Limiting

Currently, no rate limiting is implemented. In production deployments:
- Vercel applies automatic rate limiting
- Express standalone should implement rate limiting middleware

## Environment Variables

The following environment variables affect API behavior:

- `MCP_MODE`: Transport mode (`stdio` or `streamable_http`)
- `MCP_DEV_SKIP_AUTH`: Skip authentication in development (not recommended)
- `HTTP_PORT`: Server port (default: 3000)
- `HTTP_HOST`: Server host (default: localhost)
- `OAUTH_PROVIDER`: OAuth provider selection (`google`, `github`, `microsoft`, `generic`)
- `ALLOWED_ORIGINS`: Comma-separated list of allowed CORS origins
- `ALLOWED_HOSTS`: Comma-separated list of allowed hosts
- `SESSION_SECRET`: Secret key for session management

## Security Considerations

1. **Always use HTTPS in production** - OAuth tokens should never be transmitted over unencrypted connections
2. **Validate OAuth tokens** - All protected endpoints verify token validity
3. **Session expiration** - Sessions expire after configured timeout
4. **CORS restrictions** - Configure `ALLOWED_ORIGINS` appropriately for your deployment
5. **Environment isolation** - Never expose production credentials in development

## Testing the API

### Local Development Testing

1. **Start the server**:
   ```bash
   npm start  # Express standalone
   # or
   npm run dev:vercel  # Vercel local
   ```

2. **Check health** (no auth required):
   ```bash
   curl http://localhost:3000/health
   ```

3. **Authenticate** (browser):
   ```
   http://localhost:3000/auth/google
   ```

4. **Use authenticated endpoints**:
   ```bash
   curl -H "Authorization: Bearer <token>" http://localhost:3000/mcp
   ```

### Integration Testing

Run the comprehensive test suite:
```bash
npm run test:system:local
```

## Deployment Differences

While the API interface is identical, implementation differs by deployment:

### Express Standalone
- Direct route implementation
- Routes defined in `src/server/streamable-http-server.ts`
- In-memory session management
- Single process handling all requests

### Vercel Serverless
- Routes implemented as serverless functions in `api/` directory
- URL rewrites map canonical paths to `/api/*` functions
- Stateless execution (no persistent sessions between requests)
- Auto-scaling and global distribution

## Version History

- **1.0.0** - Initial API implementation with OAuth and MCP protocol support