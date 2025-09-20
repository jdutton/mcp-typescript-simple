# OAuth Provider Setup & Testing Guide

This guide explains how to configure and test OAuth authentication with different providers for the MCP TypeScript server.

## Quick Start

1. **Choose a transport mode** (Streamable HTTP recommended):
   ```bash
   export MCP_MODE=streamable_http  # Modern (recommended)
   # OR
   export MCP_MODE=sse             # Legacy but supported
   ```

2. **Choose an OAuth provider**:
   ```bash
   export OAUTH_PROVIDER=google    # Default
   # OR
   export OAUTH_PROVIDER=github
   # OR
   export OAUTH_PROVIDER=microsoft
   # OR
   export OAUTH_PROVIDER=generic
   ```

3. **Configure provider credentials** (see provider-specific sections below)

4. **Start the server**:
   ```bash
   npm start
   ```

5. **Test OAuth flow** (see Testing section below)

## Provider Configuration

### 🔵 Google OAuth Setup

**1. Create Google OAuth Application:**
- Go to [Google Cloud Console](https://console.cloud.google.com/)
- Create a new project or select existing one
- Enable the Google+ API or Google Identity API
- Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client IDs"
- Choose "Web application"
- Add authorized redirect URIs:
  - `http://localhost:3000/auth/google/callback` (development)
  - `https://yourdomain.com/auth/google/callback` (production)

**2. Environment Variables:**
```bash
export OAUTH_PROVIDER=google
export GOOGLE_CLIENT_ID=your_google_client_id
export GOOGLE_CLIENT_SECRET=your_google_client_secret
export GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
# Optional: Custom scopes (defaults to 'openid email profile')
export GOOGLE_SCOPES="openid,email,profile"
```

**3. Test URLs:**
- Authorization: `http://localhost:3000/auth/google`
- Health check: `http://localhost:3000/health`

### 🐙 GitHub OAuth Setup

**1. Create GitHub OAuth App:**
- Go to GitHub Settings → Developer settings → OAuth Apps
- Click "New OAuth App"
- Set Authorization callback URL: `http://localhost:3000/auth/github/callback`
- Note down Client ID and Client Secret

**2. Environment Variables:**
```bash
export OAUTH_PROVIDER=github
export GITHUB_CLIENT_ID=your_github_client_id
export GITHUB_CLIENT_SECRET=your_github_client_secret
export GITHUB_REDIRECT_URI=http://localhost:3000/auth/github/callback
# Optional: Custom scopes (defaults to 'user:email')
export GITHUB_SCOPES="user:email,read:user"
```

**3. Test URLs:**
- Authorization: `http://localhost:3000/auth/github`
- Health check: `http://localhost:3000/health`

### 🏢 Microsoft Azure AD OAuth Setup

**1. Create Azure AD Application:**
- Go to [Azure Portal](https://portal.azure.com/)
- Navigate to Azure Active Directory → App registrations
- Click "New registration"
- Set Redirect URI: `http://localhost:3000/auth/microsoft/callback`
- Note down Application (client) ID and create a client secret

**2. Environment Variables:**
```bash
export OAUTH_PROVIDER=microsoft
export MICROSOFT_CLIENT_ID=your_azure_app_id
export MICROSOFT_CLIENT_SECRET=your_azure_client_secret
export MICROSOFT_REDIRECT_URI=http://localhost:3000/auth/microsoft/callback
# Optional: Tenant ID (defaults to 'common' for multi-tenant)
export MICROSOFT_TENANT_ID=your_tenant_id
# Optional: Custom scopes (defaults to 'openid profile email')
export MICROSOFT_SCOPES="openid,profile,email,User.Read"
```

**3. Test URLs:**
- Authorization: `http://localhost:3000/auth/microsoft`
- Health check: `http://localhost:3000/health`

### ⚙️ Generic OAuth Provider Setup

For custom OAuth providers (GitLab, Okta, Auth0, etc.)

**Environment Variables:**
```bash
export OAUTH_PROVIDER=generic
export OAUTH_CLIENT_ID=your_client_id
export OAUTH_CLIENT_SECRET=your_client_secret
export OAUTH_REDIRECT_URI=http://localhost:3000/auth/oauth/callback
export OAUTH_AUTHORIZATION_URL=https://your-provider.com/oauth/authorize
export OAUTH_TOKEN_URL=https://your-provider.com/oauth/token
export OAUTH_USER_INFO_URL=https://your-provider.com/api/user
export OAUTH_REVOCATION_URL=https://your-provider.com/oauth/revoke  # Optional
export OAUTH_PROVIDER_NAME="Your Custom Provider"
export OAUTH_SCOPES="openid,profile,email"
```

**Test URLs:**
- Authorization: `http://localhost:3000/auth/oauth`
- Health check: `http://localhost:3000/health`

## Testing OAuth Flow

### Method 1: Browser Testing (Easiest)

1. **Start the server**:
   ```bash
   npm start
   ```

2. **Check server health**:
   ```bash
   curl http://localhost:3000/health
   ```
   Should return JSON with OAuth provider info and status.

3. **Initiate OAuth flow**:
   - Open browser to: `http://localhost:3000/auth/[provider]`
   - Replace `[provider]` with: `google`, `github`, `microsoft`, or `oauth`
   - Follow the OAuth flow in your browser
   - You should be redirected back with an access token

4. **Verify token** (if using Streamable HTTP):
   ```bash
   # Check active sessions
   curl http://localhost:3000/admin/sessions
   ```

### Method 2: Command Line Testing

1. **Get authorization URL**:
   ```bash
   curl -v http://localhost:3000/auth/google
   # Follow the Location header to complete OAuth in browser
   ```

2. **Test with existing token** (if you have one):
   ```bash
   curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
        http://localhost:3000/mcp
   ```

### Method 3: MCP Client Testing

1. **Create a test client** (create `test-oauth-client.js`):
   ```javascript
   import { Client } from '@modelcontextprotocol/sdk/client/index.js';
   import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

   async function testOAuth() {
     // First get OAuth token via browser flow
     console.log('1. Go to: http://localhost:3000/auth/google');
     console.log('2. Complete OAuth flow');
     console.log('3. Copy the access_token from response');

     const token = process.argv[2];
     if (!token) {
       console.log('Usage: node test-oauth-client.js <access_token>');
       return;
     }

     // Test with your access token
     const transport = new StdioClientTransport({
       command: 'npm',
       args: ['start'],
       env: {
         ...process.env,
         MCP_MODE: 'stdio' // Use stdio for testing
       }
     });

     const client = new Client({
       name: 'test-client',
       version: '1.0.0'
     }, {
       capabilities: {}
     });

     await client.connect(transport);
     console.log('Connected to MCP server!');

     // Test some tools
     const tools = await client.listTools();
     console.log('Available tools:', tools);
   }

   testOAuth().catch(console.error);
   ```

2. **Run the test**:
   ```bash
   node test-oauth-client.js YOUR_ACCESS_TOKEN
   ```

## Development Mode (Skip OAuth)

For development/testing without OAuth:

```bash
export MCP_MODE=stdio              # Use stdio (no HTTP)
# OR
export MCP_MODE=streamable_http    # Use HTTP but skip auth
export MCP_DEV_SKIP_AUTH=true
```

## Troubleshooting

### Common Issues

1. **"OAuth provider could not be created"**
   - Check that required environment variables are set
   - Verify client ID/secret are correct
   - Check redirect URI matches exactly

2. **"Authorization failed"**
   - Verify redirect URI in provider settings
   - Check scopes are valid for the provider
   - Ensure HTTPS in production

3. **"Token verification failed"**
   - Token might be expired
   - Check provider-specific token validation

### Debug Mode

Enable verbose logging:
```bash
export NODE_ENV=development
export DEBUG=mcp:*
npm start
```

### Health Check Endpoints

- **Server health**: `GET /health`
- **Active sessions**: `GET /admin/sessions` (Streamable HTTP only)
- **Provider info**: Check the health endpoint for OAuth provider status

### Provider-Specific Notes

**Google:**
- Requires Google+ API or Google Identity API enabled
- Tokens don't expire by default
- Supports refresh tokens

**GitHub:**
- Tokens don't expire by default
- Email scope required for user email access
- Rate limiting applies

**Microsoft:**
- Tokens expire after 1 hour by default
- Supports refresh tokens
- Tenant ID affects available users

**Generic:**
- Highly configurable for custom providers
- User info endpoint must return `id`, `email` fields minimum
- Token refresh support depends on provider

## Production Deployment

For production:

```bash
export NODE_ENV=production
export MCP_MODE=streamable_http
export REQUIRE_HTTPS=true
export ALLOWED_ORIGINS=https://yourdomain.com
export SESSION_SECRET=your-secure-session-secret
# Set provider-specific credentials
```

## Security Best Practices

1. **Use HTTPS in production**
2. **Set secure session secrets**
3. **Restrict allowed origins/hosts**
4. **Use least-privilege OAuth scopes**
5. **Regularly rotate client secrets**
6. **Monitor session activity via admin endpoints**

Need help with a specific provider or issue? Check the server logs or health endpoint for detailed error information.