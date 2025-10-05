# OAuth 2.0 Dynamic Client Registration (DCR)

This guide covers OAuth 2.0 Dynamic Client Registration (RFC 7591) implementation for automatic client registration.

## Overview

Dynamic Client Registration allows OAuth clients like Claude.ai and MCP Inspector to automatically register and obtain credentials without manual configuration.

## Features

### Dual-Mode Registration

1. **Public Registration** (`/oauth/register`)
   - Open to all clients (MCP Inspector, Claude.ai, development tools)
   - Rate limited: 5 requests/hour per IP
   - Client secrets expire in 30 days
   - Limited scopes only

2. **Protected Registration** (`/admin/register`)
   - Requires initial access token
   - For trusted clients (enterprise apps, CI/CD pipelines)
   - Higher rate limits: 100 requests/hour
   - Client secrets expire in 1 year
   - All scopes allowed

### Storage Backends

Three pluggable storage implementations with auto-detection:

1. **Hybrid Store** (Development)
   - In-memory + file-backed persistence
   - Survives restarts
   - File location: `./data/oauth-clients.json`

2. **Redis Store** (Production)
   - Multi-instance deployments
   - Auto-scaling with traffic
   - Automatic TTL for secret expiration
   - Works with any Redis deployment

3. **In-Memory Store** (Testing)
   - Fast, ephemeral storage
   - Lost on restart
   - Used in test environments

## Public Client Registration

### Endpoint

```
POST /oauth/register
Content-Type: application/json
```

### Request

```json
{
  "client_name": "MCP Inspector",
  "redirect_uris": ["http://localhost:6274/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "scope": "openid profile email"
}
```

### Response

```json
{
  "client_id": "550e8400-e29b-41d4-a716-446655440000",
  "client_secret": "ZJYCqe3GGRvdrudKyZS0XhGv_Z45DuKhCUk0gBR1vZk",
  "client_id_issued_at": 1735517893,
  "client_secret_expires_at": 1738109893,
  "client_name": "MCP Inspector",
  "redirect_uris": ["http://localhost:6274/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "client_secret_post"
}
```

### Security Constraints

- **Rate Limiting**: 5 registrations per hour per IP address
- **Secret Expiration**: 30 days from issuance
- **Allowed Scopes**: `openid`, `profile`, `email` only
- **Redirect URIs**: Must be valid URLs (localhost allowed for development)

### Example: cURL

```bash
curl -X POST http://localhost:3000/oauth/register \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "My MCP Client",
    "redirect_uris": ["http://localhost:8080/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"]
  }'
```

## Protected Client Registration

### Endpoint

```
POST /admin/register
Authorization: Bearer <initial_access_token>
Content-Type: application/json
```

### Request

```json
{
  "client_name": "Enterprise App",
  "redirect_uris": ["https://app.company.com/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "scope": "openid profile email admin"
}
```

### Response

Same format as public registration, but with extended expiration (1 year).

### Example: cURL

```bash
# First, create an initial access token
curl -X POST http://localhost:3000/admin/tokens \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Enterprise client registration token",
    "expires_in": 2592000,
    "max_uses": 10
  }'

# Use the token to register a client
curl -X POST http://localhost:3000/admin/register \
  -H "Authorization: Bearer <token_from_above>" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Enterprise App",
    "redirect_uris": ["https://app.company.com/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"]
  }'
```

## Admin Token Management

Manage initial access tokens for protected registration.

### Create Token

```bash
POST /admin/tokens
Content-Type: application/json

{
  "description": "CI/CD Pipeline Token",
  "expires_in": 2592000,  # 30 days in seconds
  "max_uses": 100         # 0 or omit for unlimited
}
```

**Response:**
```json
{
  "id": "token-uuid",
  "token": "base64url-encoded-token",
  "description": "CI/CD Pipeline Token",
  "created_at": 1735517893,
  "expires_at": 1738109893,
  "max_uses": 100
}
```

**Note:** The `token` value is only returned on creation. Store it securely.

### List Tokens

```bash
GET /admin/tokens
GET /admin/tokens?include_revoked=true
GET /admin/tokens?include_expired=true
```

### Get Token Details

```bash
GET /admin/tokens/:id
```

### Revoke Token

```bash
DELETE /admin/tokens/:id              # Soft delete (revoke)
DELETE /admin/tokens/:id?permanent=true  # Hard delete (permanent)
```

### Cleanup Expired Tokens

```bash
POST /admin/tokens/cleanup
```

## Client Store Configuration

### Environment Variables

```bash
# Store type (auto-detected by default)
DCR_STORE_TYPE=auto|memory|file|hybrid|redis

# File store path (default: ./data/oauth-clients.json)
DCR_FILE_PATH=./data/oauth-clients.json

# Token store type (auto-detected by default)
DCR_TOKEN_STORE=auto|memory|file|redis

# Token file path (default: ./data/access-tokens.json)
DCR_TOKEN_FILE_PATH=./data/access-tokens.json

# Redis URL for multi-instance deployments
REDIS_URL=redis://localhost:6379
```

### Auto-Detection Logic

1. **Redis Environment**: Uses Redis if `REDIS_URL` is set
2. **Test Environment**: Uses in-memory store if `NODE_ENV=test` or `JEST_WORKER_ID` set
3. **Default**: Uses hybrid (memory + file) store for development

### Storage Backend Comparison

| Backend | Persistent | Multi-Instance | Use Case |
|---------|-----------|---------------|----------|
| **Memory** | ❌ No | ❌ No | Testing only |
| **File** | ✅ Yes | ❌ No | Single-instance dev |
| **Hybrid** | ✅ Yes | ❌ No | Development (default) |
| **Redis** | ✅ Yes | ✅ Yes | Production (multi-instance) |

## Discovery Metadata

DCR endpoints are advertised via OAuth 2.0 Authorization Server Metadata:

```bash
GET /.well-known/oauth-authorization-server
```

**Response includes:**
```json
{
  "issuer": "https://your-server.com",
  "authorization_endpoint": "https://your-server.com/authorize",
  "token_endpoint": "https://your-server.com/token",
  "registration_endpoint": "https://your-server.com/oauth/register",
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "response_types_supported": ["code"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": [
    "client_secret_post",
    "client_secret_basic"
  ]
}
```

## MCP Client Integration

### MCP Inspector

MCP Inspector automatically discovers and uses the `/oauth/register` endpoint:

1. Inspector fetches `/.well-known/oauth-authorization-server`
2. Discovers `registration_endpoint`
3. Registers dynamically with server
4. Uses credentials for OAuth flow

**No manual configuration required!**

### Claude.ai

Claude.ai requires DCR for remote MCP server integration:

1. Add your server URL to Claude.ai
2. Claude.ai auto-registers via `/oauth/register`
3. User authorizes via OAuth flow
4. Claude.ai uses registered credentials

### Custom Clients

Use the `@modelcontextprotocol/sdk` for automatic DCR:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const client = new Client({
  name: 'My MCP Client',
  version: '1.0.0',
}, {
  capabilities: {
    // Enable OAuth with automatic registration
    auth: {
      oauth: {
        auto_register: true,
        redirect_uri: 'http://localhost:8080/callback'
      }
    }
  }
});

// Connect to server - DCR happens automatically
await client.connect({
  url: 'https://your-server.com',
  transport: 'http'
});
```

## Security Best Practices

### Rate Limiting

- **Public endpoint**: Aggressive rate limiting (5/hour) prevents abuse
- **Protected endpoint**: Relaxed limits (100/hour) for trusted clients
- **IP-based tracking**: Uses client IP for rate limit buckets

### Secret Management

- **Secure generation**: Uses `crypto.randomBytes(32)` for 256-bit secrets
- **Hashed storage**: Secrets stored as bcrypt hashes (not plaintext)
- **Automatic expiration**: 30 days (public), 1 year (protected)
- **No secret recovery**: Lost secrets require re-registration

### Redirect URI Validation

- **Exact matching**: No wildcards or pattern matching
- **HTTPS required**: Production servers should enforce HTTPS
- **Localhost allowed**: `http://localhost` permitted for development
- **Private IPs blocked**: No internal network redirect URIs

### Initial Access Tokens

- **One-time use**: Optionally enforce `max_uses` limit
- **Time-limited**: Set reasonable `expires_in` values
- **Auditable**: All token usage logged
- **Revocable**: Admin can revoke compromised tokens

## Troubleshooting

### Registration Fails with 429 (Rate Limited)

**Cause:** Too many registration attempts from same IP

**Solution:**
- Wait for rate limit window to reset (1 hour)
- Use protected endpoint with initial access token
- Contact admin to allowlist your IP (future feature)

### Client Secret Expired

**Cause:** Secret exceeded expiration time (30 days for public clients)

**Solution:**
- Re-register to get new credentials
- Use protected endpoint for longer expiration (1 year)
- Implement automatic re-registration in your client

### Token Store Not Persisting

**Cause:** Using in-memory store or Redis not configured

**Solution:**
```bash
# Development: Use file store
DCR_STORE_TYPE=file

# Production: Configure Redis
REDIS_URL=redis://your-redis-host:6379
# Restart server
```

### Redirect URI Mismatch

**Cause:** Redirect URI in OAuth request doesn't match registered URI

**Solution:**
- Ensure exact match (including trailing slash)
- Re-register with correct URI
- Check for `http` vs `https` mismatch

## API Reference

### Error Responses

All endpoints return RFC 7591 compliant error responses:

```json
{
  "error": "invalid_client_metadata",
  "error_description": "redirect_uris is required and must be a non-empty array"
}
```

**Error Codes:**
- `invalid_request` - Missing required parameters
- `invalid_client_metadata` - Invalid client metadata
- `invalid_redirect_uri` - Invalid or forbidden redirect URI
- `invalid_token` - Initial access token invalid/expired
- `server_error` - Internal server error

### Client Metadata Fields

**Required:**
- `redirect_uris` - Array of redirect URIs

**Optional:**
- `client_name` - Human-readable client name
- `grant_types` - OAuth grant types (default: `["authorization_code", "refresh_token"]`)
- `response_types` - OAuth response types (default: `["code"]`)
- `scope` - Requested scopes (space-separated string)
- `token_endpoint_auth_method` - Client authentication method (default: `client_secret_post`)

**Response-only:**
- `client_id` - Generated UUID
- `client_secret` - Generated cryptographic secret
- `client_id_issued_at` - Unix timestamp
- `client_secret_expires_at` - Unix timestamp (0 = never expires)

## References

- [RFC 7591: OAuth 2.0 Dynamic Client Registration Protocol](https://datatracker.ietf.org/doc/html/rfc7591)
- [RFC 7592: OAuth 2.0 Dynamic Client Registration Management Protocol](https://datatracker.ietf.org/doc/html/rfc7592)
- [MCP Authorization Specification](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- [MCP Blog: Evolving OAuth Client Registration](http://blog.modelcontextprotocol.io/posts/client_registration/)