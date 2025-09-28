# GitHub OAuth Setup Guide for MCP TypeScript Server

## Table of Contents
- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [GitHub OAuth App Registration](#github-oauth-app-registration)
- [Local Development Setup](#local-development-setup)
- [Testing with MCP Inspector](#testing-with-mcp-inspector)
- [API Endpoints](#api-endpoints)
- [Troubleshooting](#troubleshooting)
- [Security Best Practices](#security-best-practices)

## Overview

This guide provides comprehensive instructions for setting up GitHub OAuth authentication with the MCP TypeScript server. GitHub OAuth enables users to authenticate using their GitHub accounts, providing secure access to MCP functionality.

### Features
- ✅ Full OAuth 2.0 flow support (authorization, callback, refresh, logout)
- ✅ PKCE (Proof Key for Code Exchange) for enhanced security
- ✅ User profile retrieval with email access
- ✅ Token management and session handling
- ✅ Compatible with MCP Inspector

## Prerequisites

Before setting up GitHub OAuth, ensure you have:

1. **GitHub Account**: You'll need a GitHub account to create OAuth applications
2. **Node.js**: Version 22.0.0 or higher
3. **MCP TypeScript Server**: Cloned and dependencies installed
4. **MCP Inspector**: For testing OAuth flows (optional but recommended)

## GitHub OAuth App Registration

### Step 1: Create a GitHub OAuth Application

1. **Navigate to GitHub Settings**
   - Go to [GitHub Settings](https://github.com/settings/profile)
   - Click on "Developer settings" in the sidebar
   - Select "OAuth Apps"
   - Click "New OAuth App" (or "Register a new application")

2. **Configure Application Settings**
   ```
   Application name: MCP TypeScript Server (Development)
   Homepage URL: http://localhost:3000
   Application description: OAuth integration for MCP TypeScript server
   Authorization callback URL: http://localhost:3000/auth/github/callback
   ```

3. **Save Application Details**
   - After creating the app, you'll receive:
     - **Client ID**: A public identifier for your app
     - **Client Secret**: Click "Generate a new client secret" and save it securely

### Step 2: Configure Redirect URLs

For different environments, configure these redirect URLs:

| Environment | Redirect URL |
|------------|-------------|
| Local Development | `http://localhost:3000/auth/github/callback` |
| Local with custom port | `http://localhost:PORT/auth/github/callback` |
| Vercel Preview | `https://YOUR-APP-preview.vercel.app/auth/github/callback` |
| Production | `https://YOUR-DOMAIN.com/auth/github/callback` |

## Local Development Setup

### Step 1: Environment Configuration

1. **Create `.env` file** in the project root:
   ```bash
   touch .env
   ```

2. **Add GitHub OAuth configuration**:
   ```bash
   # OAuth Provider Selection
   OAUTH_PROVIDER=github

   # GitHub OAuth Credentials
   GITHUB_CLIENT_ID=your_client_id_here
   GITHUB_CLIENT_SECRET=your_client_secret_here
   GITHUB_REDIRECT_URI=http://localhost:3000/auth/github/callback

   # Optional: Custom scopes (defaults to 'user:email')
   # Available scopes: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
   GITHUB_SCOPES="user:email,read:user"

   # Server Configuration
   MCP_MODE=streamable_http
   HTTP_HOST=localhost
   HTTP_PORT=3000
   ```

### Step 2: Start the Server

```bash
# Development mode with OAuth enabled
npm run dev:oauth

# The server will start with:
# - OAuth enabled for GitHub provider
# - Streamable HTTP transport
# - Available at http://localhost:3000
```

### Step 3: Verify Setup

Test that OAuth is configured correctly:

```bash
# Check health endpoint
curl http://localhost:3000/health

# Check OAuth discovery endpoint
curl http://localhost:3000/.well-known/oauth-authorization-server
```

## Testing with MCP Inspector

### Step 1: Configure MCP Inspector

1. **Open MCP Inspector**
   - Visit the MCP Inspector interface
   - Click on "Connect" or "New Connection"

2. **Configure Connection**:
   ```json
   {
     "url": "http://localhost:3000/mcp",
     "transport": "streamable_http",
     "auth": {
       "type": "oauth",
       "provider": "github"
     }
   }
   ```

### Step 2: Test OAuth Flow

1. **Initiate Authentication**
   - Click "Authenticate" in MCP Inspector
   - You'll be redirected to GitHub's authorization page

2. **Authorize Application**
   - Review the requested permissions
   - Click "Authorize [your-app-name]"

3. **Complete Flow**
   - You'll be redirected back to MCP Inspector
   - The access token will be automatically configured

### Step 3: Verify Authentication

Test authenticated requests:

```javascript
// Example: List available tools
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": 1
}

// Example: Call a tool
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "hello",
    "arguments": {
      "name": "GitHub User"
    }
  },
  "id": 2
}
```

## API Endpoints

### OAuth Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/github` | GET | Initiates GitHub OAuth flow |
| `/auth/github/callback` | GET | Handles OAuth callback with authorization code |
| `/auth/github/refresh` | POST | Refreshes access token (GitHub tokens don't expire) |
| `/auth/github/logout` | POST | Logs out and invalidates token |
| `/.well-known/oauth-authorization-server` | GET | OAuth discovery metadata |
| `/.well-known/oauth-protected-resource` | GET | Protected resource metadata |

### Example cURL Commands

```bash
# Initiate OAuth flow
curl -X GET http://localhost:3000/auth/github

# Logout (with token)
curl -X POST http://localhost:3000/auth/github/logout \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Get user info (authenticated)
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Troubleshooting

### Common Issues and Solutions

#### 1. "Invalid redirect_uri" Error
**Problem**: GitHub returns an error about invalid redirect URI.

**Solution**: Ensure the redirect URI in your `.env` file exactly matches the one configured in GitHub OAuth app settings, including protocol, port, and path.

```bash
# These must match exactly:
# In GitHub: http://localhost:3000/auth/github/callback
# In .env:   GITHUB_REDIRECT_URI=http://localhost:3000/auth/github/callback
```

#### 2. "401 Unauthorized" Response
**Problem**: Requests return 401 even with a token.

**Solution**: Check token validity:
```bash
# Verify token with GitHub API
curl -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Accept: application/vnd.github.v3+json" \
     https://api.github.com/user
```

#### 3. "No email address found" Error
**Problem**: OAuth flow fails because no email is available.

**Solution**: Ensure your GitHub account has a public email or grant `user:email` scope:
```bash
GITHUB_SCOPES="user:email,read:user"
```

#### 4. CORS Issues
**Problem**: Browser blocks requests due to CORS.

**Solution**: The server includes CORS headers. For custom origins:
```bash
# Add to .env if needed
CORS_ORIGIN=http://localhost:3001
```

### Debug Mode

Enable debug logging for troubleshooting:

```bash
# Set debug environment variable
DEBUG=mcp:* npm run dev:oauth

# Or add to .env
DEBUG=mcp:auth:github
```

## Security Best Practices

### 1. Protect Client Secrets
- **Never commit** `.env` files to version control
- Use `.gitignore` to exclude sensitive files
- Rotate secrets regularly

### 2. Use HTTPS in Production
```bash
# Production configuration
GITHUB_REDIRECT_URI=https://your-domain.com/auth/github/callback
```

### 3. Validate Redirect URLs
- Always use exact URL matching
- Never use wildcards in production
- Validate state parameter to prevent CSRF attacks

### 4. Token Storage
- Tokens are stored in-memory by default
- For production, consider:
  - Redis for distributed systems
  - Encrypted database storage
  - Token rotation policies

### 5. Scope Management
- Request minimal scopes needed
- Common GitHub OAuth scopes:
  ```
  user:email     - Access user email addresses
  read:user      - Access user profile information
  repo           - Access repositories (use cautiously)
  ```

### 6. Rate Limiting
GitHub API has rate limits:
- Authenticated: 5,000 requests/hour
- Unauthenticated: 60 requests/hour

Monitor usage and implement caching where appropriate.

## Testing Checklist

Before deploying, ensure these scenarios work:

- [ ] **OAuth Flow**
  - [ ] Authorization redirect works
  - [ ] Callback processes code correctly
  - [ ] Access token is received
  - [ ] User profile is retrieved

- [ ] **Token Management**
  - [ ] Token validation works
  - [ ] Invalid tokens are rejected
  - [ ] Logout invalidates tokens

- [ ] **Error Handling**
  - [ ] Invalid state parameter is rejected
  - [ ] Missing code parameter returns error
  - [ ] Network failures are handled gracefully

- [ ] **MCP Integration**
  - [ ] Tools can be listed with authentication
  - [ ] Tools can be executed with valid token
  - [ ] Unauthorized requests return 401

## Next Steps

1. **Production Deployment**: See [Vercel Deployment Guide](./vercel-deployment.md)
2. **Add Other Providers**: Configure [Google](./oauth-setup.md#google-oauth-setup) or [Microsoft](./oauth-setup.md#microsoft-azure-ad-oauth-setup) OAuth
3. **Custom OAuth Provider**: Implement the [Generic OAuth Provider](./oauth-setup.md#generic-oauth-setup)

## Resources

- [GitHub OAuth Documentation](https://docs.github.com/en/apps/oauth-apps)
- [OAuth 2.0 Specification](https://oauth.net/2/)
- [MCP Protocol Documentation](https://modelcontextprotocol.io)
- [Project Repository](https://github.com/jdutton/mcp-typescript-simple)

---

**Need Help?** Open an issue in the [project repository](https://github.com/jdutton/mcp-typescript-simple/issues) with the `oauth` and `github` labels.