# Microsoft Azure AD OAuth Setup Guide for MCP TypeScript Server

## Table of Contents
- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Azure AD App Registration](#azure-ad-app-registration)
- [Local Development Setup](#local-development-setup)
- [Testing with MCP Inspector](#testing-with-mcp-inspector)
- [API Endpoints](#api-endpoints)
- [Troubleshooting](#troubleshooting)
- [Security Best Practices](#security-best-practices)

## Overview

This guide provides comprehensive instructions for setting up Microsoft Azure AD OAuth authentication with the MCP TypeScript server. Microsoft OAuth enables users to authenticate using their Microsoft accounts (personal, work, or school), providing secure access to MCP functionality.

### Features
- ✅ Full OAuth 2.0 flow support (authorization, callback, refresh, logout)
- ✅ PKCE (Proof Key for Code Exchange) for enhanced security
- ✅ Multi-tenant support (personal, work, and school accounts)
- ✅ Microsoft Graph API integration for user profile retrieval
- ✅ Token management and session handling
- ✅ Compatible with MCP Inspector

## Prerequisites

Before setting up Microsoft OAuth, ensure you have:

1. **Microsoft Account**: You'll need a Microsoft account to access Azure Portal
2. **Node.js**: Version 22.0.0 or higher
3. **MCP TypeScript Server**: Cloned and dependencies installed
4. **MCP Inspector**: For testing OAuth flows (optional but recommended)

## Azure AD App Registration

### Step 1: Access Azure Portal

1. **Navigate to Azure Portal**
   - Go to [Azure Portal](https://portal.azure.com/)
   - Sign in with your Microsoft account (personal, work, or school)

### Step 2: Create App Registration

1. **Navigate to App Registrations**
   - In the left sidebar, search for and select **"Azure Active Directory"**
   - Under "Manage", click **"App registrations"**
   - Click **"+ New registration"**

2. **Configure Application Settings**
   ```
   Name: MCP TypeScript Server (Development)

   Supported account types:
   • Accounts in any organizational directory and personal Microsoft accounts
     (Recommended for development - supports personal, work, and school accounts)

   Redirect URI:
   • Platform: Web
   • URI: http://localhost:3000/auth/microsoft/callback
   ```

3. **Complete Registration**
   - Click **"Register"**
   - Note your **Application (client) ID** from the Overview page

### Step 3: Configure API Permissions

1. **Add Microsoft Graph Permissions**
   - In your app registration, go to **"API permissions"**
   - Click **"+ Add a permission"**
   - Select **"Microsoft Graph"**
   - Choose **"Delegated permissions"**

2. **Required Permissions**
   Add these permissions:
   - ✅ `openid` - Sign users in and read basic profile
   - ✅ `profile` - View users' basic profile information
   - ✅ `email` - View users' email address
   - ✅ `User.Read` - Read user profile from Microsoft Graph

3. **Grant Permissions**
   - Click **"Add permissions"**
   - Optionally, click **"Grant admin consent"** if you're an admin

### Step 4: Create Client Secret

1. **Generate Secret**
   - Go to **"Certificates & secrets"**
   - Under "Client secrets", click **"+ New client secret"**
   - Description: `MCP Development Secret`
   - Expires: `6 months` (recommended for development)
   - Click **"Add"**

2. **Save Secret Value**
   - **⚠️ CRITICAL**: Copy the secret value immediately
   - You won't be able to see it again after leaving the page
   - Store it securely for the next step

### Step 5: Configure Redirect URLs for Different Environments

For different environments, you may need additional redirect URLs:

| Environment | Redirect URL |
|------------|-------------|
| Local Development | `http://localhost:3000/auth/microsoft/callback` |
| Local with custom port | `http://localhost:PORT/auth/microsoft/callback` |
| Vercel Preview | `https://YOUR-APP-preview.vercel.app/auth/microsoft/callback` |
| Production | `https://YOUR-DOMAIN.com/auth/microsoft/callback` |

To add additional URLs:
- Go to **"Authentication"** in your app registration
- Under "Platform configurations", click your web platform
- Add additional redirect URIs as needed

## Local Development Setup

### Step 1: Environment Configuration

1. **Copy environment template**:
   ```bash
   cp .env.microsoft .env
   ```

2. **Configure your `.env` file**:
   ```bash
   # OAuth Provider Selection
   OAUTH_PROVIDER=microsoft

   # Microsoft OAuth Credentials (fill these in)
   MICROSOFT_CLIENT_ID=your_application_client_id_here
   MICROSOFT_CLIENT_SECRET=your_client_secret_here
   MICROSOFT_REDIRECT_URI=http://localhost:3000/auth/microsoft/callback
   MICROSOFT_TENANT_ID=common
   MICROSOFT_SCOPES=openid,email,profile

   # Server Configuration
   MCP_MODE=streamable_http
   HTTP_HOST=localhost
   HTTP_PORT=3000
   ```

3. **Fill in your credentials**:
   - `MICROSOFT_CLIENT_ID`: Application (client) ID from Azure Portal
   - `MICROSOFT_CLIENT_SECRET`: Client secret value you saved
   - `MICROSOFT_TENANT_ID`: Use `common` for multi-tenant (recommended)

### Step 2: Start the Server

```bash
# Development mode with Microsoft OAuth enabled
npm run dev:oauth:microsoft

# The server will start with:
# - OAuth enabled for Microsoft provider
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
       "provider": "microsoft"
     }
   }
   ```

### Step 2: Test OAuth Flow

1. **Initiate Authentication**
   - Click "Authenticate" in MCP Inspector
   - You'll be redirected to Microsoft's sign-in page

2. **Sign In**
   - Enter your Microsoft credentials (personal, work, or school)
   - Choose the account type if prompted

3. **Grant Permissions**
   - Review the requested permissions
   - Click "Accept" to grant access

4. **Complete Flow**
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
      "name": "Microsoft User"
    }
  },
  "id": 2
}
```

## API Endpoints

### OAuth Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/microsoft` | GET | Initiates Microsoft OAuth flow |
| `/auth/microsoft/callback` | GET | Handles OAuth callback with authorization code |
| `/auth/microsoft/refresh` | POST | Refreshes access token using refresh token |
| `/auth/microsoft/logout` | POST | Logs out and invalidates token |
| `/token` | POST | OAuth 2.0 standard token exchange endpoint |
| `/.well-known/oauth-authorization-server` | GET | OAuth discovery metadata |
| `/.well-known/oauth-protected-resource` | GET | Protected resource metadata |

### Example cURL Commands

```bash
# Initiate OAuth flow
curl -X GET http://localhost:3000/auth/microsoft

# Token exchange (for OAuth clients)
curl -X POST http://localhost:3000/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=YOUR_AUTH_CODE&code_verifier=YOUR_CODE_VERIFIER"

# Refresh token
curl -X POST http://localhost:3000/auth/microsoft/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"YOUR_REFRESH_TOKEN"}'

# Logout (with token)
curl -X POST http://localhost:3000/auth/microsoft/logout \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Get user info (authenticated MCP request)
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Troubleshooting

### Common Issues and Solutions

#### 1. "AADSTS50011: The reply URL specified in the request does not match"
**Problem**: Redirect URI mismatch between your configuration and Azure AD.

**Solution**: Ensure exact URL matching:
```bash
# In Azure Portal: http://localhost:3000/auth/microsoft/callback
# In .env file:   MICROSOFT_REDIRECT_URI=http://localhost:3000/auth/microsoft/callback
```

#### 2. "AADSTS70001: Application is not supported for this API version"
**Problem**: Using deprecated API endpoint or incorrect tenant configuration.

**Solution**: Verify tenant ID configuration:
```bash
# Use 'common' for multi-tenant (recommended)
MICROSOFT_TENANT_ID=common

# Or use specific tenant ID for single-tenant apps
MICROSOFT_TENANT_ID=your_tenant_id_here
```

#### 3. "AADSTS65001: The user or administrator has not consented"
**Problem**: Required permissions not granted.

**Solution**: Check API permissions in Azure Portal:
- Ensure `openid`, `profile`, `email`, and `User.Read` are added
- Grant admin consent if you're an administrator
- User can grant consent during first login

#### 4. "401 Unauthorized" Response
**Problem**: Invalid or expired access token.

**Solution**: Check token validity:
```bash
# Test token with Microsoft Graph API directly
curl -H "Authorization: Bearer YOUR_TOKEN" \
     https://graph.microsoft.com/v1.0/me
```

#### 5. "Invalid client secret" Error
**Problem**: Client secret is incorrect or expired.

**Solution**:
- Verify secret value in `.env` file
- Create new client secret in Azure Portal if expired
- Ensure no extra characters or line breaks

#### 6. CORS Issues in Browser
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
DEBUG=mcp:* npm run dev:oauth:microsoft

# Or add to .env
DEBUG=mcp:auth:microsoft
```

### Advanced Troubleshooting

1. **Check Microsoft Graph API responses**:
   ```bash
   # Test user endpoint directly
   curl -H "Authorization: Bearer YOUR_TOKEN" \
        -H "Accept: application/json" \
        https://graph.microsoft.com/v1.0/me
   ```

2. **Validate token format**:
   - Microsoft access tokens are typically JWT format
   - Can be decoded at [jwt.io](https://jwt.io) for inspection
   - Check expiration (`exp`) and issuer (`iss`) claims

3. **Monitor Azure AD sign-in logs**:
   - Go to Azure Portal → Azure Active Directory → Sign-in logs
   - Look for failed authentication attempts
   - Review error codes and descriptions

## Security Best Practices

### 1. Protect Client Secrets
- **Never commit** `.env` files to version control
- Use `.gitignore` to exclude sensitive files
- Rotate secrets regularly (every 6 months recommended)
- Use different secrets for different environments

### 2. Use HTTPS in Production
```bash
# Production configuration
MICROSOFT_REDIRECT_URI=https://your-domain.com/auth/microsoft/callback
```

### 3. Validate Redirect URLs
- Always use exact URL matching in Azure AD
- Never use wildcards in production
- Validate state parameter to prevent CSRF attacks

### 4. Implement Proper Tenant Configuration
```bash
# For development (allows any tenant)
MICROSOFT_TENANT_ID=common

# For production (restrict to specific tenant)
MICROSOFT_TENANT_ID=your_organization_tenant_id
```

### 5. Scope Management
Request minimal scopes needed:
```
openid      - Basic authentication
profile     - User profile information
email       - User email address
User.Read   - Read user profile via Graph API
```

Additional scopes (use cautiously):
```
User.ReadWrite    - Modify user profile
Mail.Read         - Read user emails
Calendars.Read    - Read user calendar
```

### 6. Token Storage
- Tokens are stored in-memory by default
- For production, consider:
  - Redis for distributed systems
  - Encrypted database storage
  - Secure cookie storage
  - Token rotation policies

### 7. Session Management
- Set appropriate session timeout values
- Implement proper logout functionality
- Monitor active sessions via admin endpoints

### 8. Rate Limiting
Microsoft Graph API has rate limits:
- Per-app limits vary by endpoint
- Implement retry logic with exponential backoff
- Monitor rate limit headers in responses

## Testing Checklist

Before deploying, ensure these scenarios work:

- [ ] **OAuth Flow**
  - [ ] Authorization redirect works
  - [ ] Microsoft sign-in page appears
  - [ ] Callback processes code correctly
  - [ ] Access token is received
  - [ ] User profile is retrieved from Graph API

- [ ] **Token Management**
  - [ ] Token validation works
  - [ ] Token refresh works (if refresh tokens enabled)
  - [ ] Invalid tokens are rejected
  - [ ] Logout invalidates tokens

- [ ] **Multi-Tenant Support**
  - [ ] Personal Microsoft accounts work
  - [ ] Work/school accounts work
  - [ ] Account picker appears when multiple accounts

- [ ] **Error Handling**
  - [ ] Invalid state parameter is rejected
  - [ ] Missing code parameter returns error
  - [ ] Network failures are handled gracefully
  - [ ] Permission denied is handled properly

- [ ] **MCP Integration**
  - [ ] Tools can be listed with authentication
  - [ ] Tools can be executed with valid token
  - [ ] Unauthorized requests return 401

## Next Steps

1. **Production Deployment**: See [Vercel Deployment Guide](./vercel-deployment.md)
2. **Add Other Providers**: Configure [Google](./oauth-setup.md#google-oauth-setup) or [GitHub](./oauth-setup.md#github-oauth-setup) OAuth
3. **Custom Tenant Configuration**: Set up organization-specific tenant restrictions

## Resources

- [Microsoft OAuth 2.0 Documentation](https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow)
- [Microsoft Graph API Documentation](https://docs.microsoft.com/en-us/graph/)
- [Azure AD App Registration Guide](https://docs.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)
- [OAuth 2.0 Specification](https://oauth.net/2/)
- [MCP Protocol Documentation](https://modelcontextprotocol.io)
- [Project Repository](https://github.com/jdutton/mcp-typescript-simple)

---

**Need Help?** Open an issue in the [project repository](https://github.com/jdutton/mcp-typescript-simple/issues) with the `oauth` and `microsoft` labels.