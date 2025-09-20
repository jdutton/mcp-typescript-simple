# Dual-Mode MCP Server Guide

## 🎯 Overview

This MCP server now supports **dual-mode operation**:

1. **STDIO Mode**: Traditional stdin/stdout communication (perfect for development)
2. **SSE Mode**: Server-Sent Events with HTTP endpoints (production-ready with OAuth)

## 🚀 Quick Start

### STDIO Mode (Default)
```bash
# Development mode - traditional MCP
npm run dev
# OR explicitly set mode
MCP_MODE=stdio npm run dev
```

### SSE Mode (Development)
```bash
# SSE mode without authentication (for testing)
MCP_MODE=sse MCP_DEV_SKIP_AUTH=true npm run dev
```

### SSE Mode (Production)
```bash
# SSE mode with Google OAuth
MCP_MODE=sse \
GOOGLE_CLIENT_ID=your-client-id \
GOOGLE_CLIENT_SECRET=your-secret \
npm start
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `MCP_MODE` | Transport mode | `stdio` | `stdio` or `sse` |
| `MCP_DEV_SKIP_AUTH` | Skip auth in dev | `false` | `true` |
| `HTTP_PORT` | HTTP server port | `3000` | `8080` |
| `HTTP_HOST` | HTTP server host | `localhost` | `0.0.0.0` |
| `GOOGLE_CLIENT_ID` | OAuth client ID | - | `your-app.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | OAuth secret | - | `your-secret-key` |
| `GOOGLE_REDIRECT_URI` | OAuth redirect | auto | `https://app.com/auth/callback` |
| `REQUIRE_HTTPS` | Force HTTPS | `false` | `true` |
| `ALLOWED_ORIGINS` | CORS origins | - | `https://app.com,https://dev.app.com` |
| `NODE_ENV` | Environment | `development` | `production` |

### Configuration Examples

#### .env for Development
```bash
# Development with SSE testing
MCP_MODE=sse
MCP_DEV_SKIP_AUTH=true
HTTP_PORT=3000
NODE_ENV=development
```

#### .env for Production
```bash
# Production with OAuth
MCP_MODE=sse
GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-secret-here
GOOGLE_REDIRECT_URI=https://yourdomain.com/auth/callback
REQUIRE_HTTPS=true
ALLOWED_ORIGINS=https://yourdomain.com
NODE_ENV=production
HTTP_PORT=8080
HTTP_HOST=0.0.0.0
```

## 🔐 OAuth Setup

### 1. Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable Google+ API or Google Identity API
4. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client IDs"
5. Set application type to "Web application"
6. Add authorized redirect URIs:
   - `http://localhost:3000/auth/callback` (development)
   - `https://yourdomain.com/auth/callback` (production)

### 2. OAuth Flow

The server provides these OAuth endpoints:

- `GET /auth/google` - Initiate OAuth flow
- `GET /auth/callback` - Handle OAuth callback
- `POST /auth/refresh` - Refresh access token
- `POST /auth/logout` - Logout and revoke token

### 3. Claude Code Integration

For Claude Code compatibility, the server supports:

- **Token Refresh**: Automatic refresh token handling
- **Bearer Auth**: Standard `Authorization: Bearer <token>` headers
- **PKCE**: Secure OAuth flow with code challenge/verifier
- **Session Persistence**: Secure token storage

## 🌐 SSE Endpoints

### Connection Endpoints

- `GET /mcp/sse` - Establish SSE connection
- `POST /mcp/sse/message` - Send MCP messages

### Management Endpoints

- `GET /health` - Health check
- `GET /auth/google` - Start OAuth flow
- `GET /auth/callback` - OAuth callback
- `POST /auth/refresh` - Refresh tokens
- `POST /auth/logout` - Logout

## 🏗️ Architecture

### Transport Layer Abstraction

```typescript
// Transport Factory automatically selects mode
const transportManager = TransportFactory.createFromEnvironment();

// Initialize with MCP server
await transportManager.initialize(server);

// Start the transport
await transportManager.start();
```

### Security Features

- **OAuth 2.1 + PKCE**: Modern secure authentication
- **JWT Verification**: Google-signed token validation
- **Token Refresh**: Automatic token rotation
- **CORS Protection**: Configurable origin validation
- **Rate Limiting**: Built-in Express rate limiting
- **Helmet Security**: Security headers and protections

## 🧪 Testing

### Run All Tests
```bash
# Test both modes
npx tsx examples/test-dual-mode.ts
```

### Manual Testing

#### STDIO Mode
```bash
# Terminal 1: Start server
MCP_MODE=stdio npm run dev

# Terminal 2: Test with interactive client
npx tsx test/interactive-client.ts
```

#### SSE Mode
```bash
# Terminal 1: Start server
MCP_MODE=sse MCP_DEV_SKIP_AUTH=true npm run dev

# Terminal 2: Test endpoints
curl http://localhost:3000/health
curl http://localhost:3000/mcp/sse
```

## 🚀 Deployment

### Docker Deployment

```dockerfile
# Add to your Dockerfile
ENV MCP_MODE=sse
ENV REQUIRE_HTTPS=true
ENV HTTP_PORT=8080
ENV HTTP_HOST=0.0.0.0

EXPOSE 8080
```

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Configure real Google OAuth credentials
- [ ] Set `REQUIRE_HTTPS=true`
- [ ] Configure `ALLOWED_ORIGINS`
- [ ] Set secure `SESSION_SECRET`
- [ ] Configure SSL/TLS certificates
- [ ] Set up reverse proxy (nginx, etc.)
- [ ] Configure monitoring and logging

## 🔍 Troubleshooting

### Common Issues

**"OAuth test timeout"**
- Ensure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set
- Check Google Cloud Console OAuth configuration
- Verify redirect URI matches exactly

**"CORS errors"**
- Set `ALLOWED_ORIGINS` to your client domain
- Ensure `credentials: true` in client requests

**"Connection refused"**
- Check `HTTP_PORT` and `HTTP_HOST` settings
- Ensure no other service is using the port
- Check firewall settings

**"Token verification failed"**
- Verify Google OAuth credentials are correct
- Check token expiration and refresh logic
- Ensure system clock is synchronized

### Debug Mode

```bash
# Enable verbose logging
DEBUG=mcp:* MCP_MODE=sse npm run dev
```

## 📚 Examples

### Client Integration

```typescript
// SSE Client Example
const eventSource = new EventSource('http://localhost:3000/mcp/sse', {
  headers: {
    'Authorization': 'Bearer your-access-token'
  }
});

eventSource.onmessage = (event) => {
  const mcpMessage = JSON.parse(event.data);
  // Handle MCP protocol message
};

// Send message to server
await fetch('http://localhost:3000/mcp/sse/message', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-access-token'
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list'
  })
});
```

## 🎉 Success!

You now have a production-ready MCP server that supports:

✅ **Dual Mode Operation**: STDIO for development, SSE for production
✅ **OAuth Authentication**: Secure Google OAuth integration
✅ **Claude Code Ready**: Full compatibility with Claude Code
✅ **Type Safety**: Complete TypeScript type safety
✅ **Security Hardened**: Production-grade security features
✅ **Backward Compatible**: Existing STDIO functionality unchanged

Your MCP server is ready for both development and production deployment!