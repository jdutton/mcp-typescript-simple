# OAuth Provider Setup & Testing Guide

This guide explains how to configure and test OAuth authentication with different providers for the MCP TypeScript server.

## Multi-Provider Architecture

The MCP server supports **multi-provider OAuth**, allowing users to choose their preferred authentication method at login time. Configure one or more OAuth providers, and the server will automatically detect and present all available options.

## Quick Start

1. **Set up environment file**:
   ```bash
   # Copy the example file and edit with your credentials
   cp .env.example .env
   # Edit .env with your OAuth provider credentials (see sections below)
   ```

2. **Choose a transport mode** (Streamable HTTP recommended):
   ```bash
   # Add to your .env file:
   MCP_MODE=streamable_http  # Modern (recommended)
   # OR
   MCP_MODE=sse             # Legacy but supported
   ```

3. **Configure OAuth providers** (one or more):
   - The server automatically detects all configured providers
   - Users will see a login page with all available providers
   - No `OAUTH_PROVIDER` variable needed - providers are auto-detected from credentials

   See provider-specific sections below for setup instructions.

4. **Start the server**:
   ```bash
   npm run dev:oauth  # Development with OAuth
   # OR
   npm start         # Production mode
   ```

5. **Test OAuth flow** (see Testing section below)

## Provider Configuration

### 🔵 Google OAuth Setup

**1. Create Google OAuth Application:**

**Step 1: Access Google Cloud Console**
- Go to [Google Cloud Console](https://console.cloud.google.com/)
- Sign in with your Google account

**Step 2: Create or Select Project**
- Click on the project dropdown (top left, next to "Google Cloud")
- Either create a new project ("New Project") or select an existing one
- Give it a name like "MCP OAuth Testing" if creating new

**Step 3: Configure OAuth Consent Screen**
- In the left sidebar, go to **"APIs & Services" > "OAuth consent screen"**
- Choose **"External"** (unless you have a Google Workspace account)
- Fill out required fields:
  - **App name**: "MCP TypeScript Simple"
  - **User support email**: Your email address
  - **Developer contact information**: Your email address
- Click **"Save and Continue"**
- Skip "Scopes" section (click "Save and Continue")
- Add test users:
  - Click **"Add Users"**
  - Add your email address as a test user
  - Click **"Save and Continue"**

**Step 4: Create OAuth Credentials**
- Go to **"APIs & Services" > "Credentials"**
- Click **"+ Create Credentials" > "OAuth client ID"**
- Select **"Web application"**
- Configure settings:
  - **Name**: "MCP Local Development"
  - **Authorized JavaScript origins**: `http://localhost:3000`
  - **Authorized redirect URIs**: `http://localhost:3000/api/auth/google/callback`
- Click **"Create"**
- **Save the Client ID and Client Secret** - you'll need these for environment variables!

**2. Environment Variables:**
```bash
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

**1. Create Microsoft Azure AD Application:**

**Step 1: Access Azure Portal**
- Go to [Azure Portal](https://portal.azure.com/)
- Sign in with your Microsoft account (personal or work/school)

**Step 2: Navigate to App Registrations**
- In the left sidebar, search for and select **"Azure Active Directory"**
- Under "Manage", click **"App registrations"**
- Click **"+ New registration"**

**Step 3: Configure Application Settings**
- **Name**: "MCP TypeScript Server (Development)"
- **Supported account types**: Choose based on your needs:
  - *Accounts in this organizational directory only* - Single tenant
  - *Accounts in any organizational directory* - Multi-tenant organizations only
  - *Accounts in any organizational directory and personal Microsoft accounts* - Multi-tenant + personal (recommended for development)
- **Redirect URI**:
  - Platform: **Web**
  - URI: `http://localhost:3000/auth/microsoft/callback`
- Click **"Register"**

**Step 4: Configure API Permissions**
- In your app registration, go to **"API permissions"**
- Click **"+ Add a permission"**
- Select **"Microsoft Graph"**
- Choose **"Delegated permissions"**
- Add these permissions:
  - ✅ `openid` - Sign users in
  - ✅ `profile` - View users' basic profile
  - ✅ `email` - View users' email address
  - ✅ `User.Read` - Read user profile
- Click **"Add permissions"**

**Step 5: Create Client Secret**
- Go to **"Certificates & secrets"**
- Under "Client secrets", click **"+ New client secret"**
- Description: "MCP Development Secret"
- Expires: Choose appropriate duration (6 months recommended for development)
- Click **"Add"**
- **IMPORTANT**: Copy the secret value immediately - you won't be able to see it again!

**Step 6: Note Your Application Details**
- Go to **"Overview"** and copy:
  - **Application (client) ID** - This is your `MICROSOFT_CLIENT_ID`
  - **Directory (tenant) ID** - This is your `MICROSOFT_TENANT_ID` (optional)

**2. Environment Variables:**
```bash
export MICROSOFT_CLIENT_ID=your_application_client_id
export MICROSOFT_CLIENT_SECRET=your_client_secret_value
export MICROSOFT_REDIRECT_URI=http://localhost:3000/auth/microsoft/callback
# Optional: Tenant ID (defaults to 'common' for multi-tenant)
export MICROSOFT_TENANT_ID=common
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
# Note: Generic OAuth provider is not yet implemented
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

### Method 3: OAuth Testing Tool (Recommended)

The project includes a dedicated OAuth testing tool that supports multiple deployment modes:

**Basic Usage:**
```bash
# Test server health
./tools/test-oauth.ts

# Test interactive OAuth flow
./tools/test-oauth.ts --flow --provider google

# Test with existing token
./tools/test-oauth.ts --token <your_access_token>

# Start development server and test
./tools/test-oauth.ts --start
```

**Multi-Environment Testing:**
```bash
# Local development
./tools/test-oauth.ts --flow --provider google

# Docker deployment
./tools/test-oauth.ts --url http://localhost:3000 --flow

# Vercel preview deployment
./tools/test-oauth.ts --url https://your-branch-abc123.vercel.app --flow

# Production deployment
./tools/test-oauth.ts --url https://your-app.vercel.app --flow --provider google
```

**Features:**
- Interactive OAuth flow testing with browser guidance
- Token validation against MCP endpoints
- Multi-provider support (Google, GitHub, Microsoft, generic)
- Cross-deployment testing (local, Docker, Vercel)
- Comprehensive error reporting and troubleshooting guidance

**Get help:** `./tools/test-oauth.ts --help`

### Method 4: MCP Client Testing

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

## OAuth Client State Preservation

### Overview

The MCP server implements **OAuth client state preservation** to support managed OAuth flows for agentic tools like Claude Code and MCP Inspector. This feature ensures compatibility with OAuth clients that manage their own state parameters for CSRF protection.

### Why This Matters

OAuth 2.0/2.1 requires clients to send a `state` parameter for CSRF protection. The authorization server must return this exact state value to the client. However, when the MCP server acts as an **OAuth intermediary** (managing its own sessions between the client and the provider), there are actually **two state values** in play:

1. **Client State**: The state parameter sent by the OAuth client (Claude Code, MCP Inspector, etc.)
2. **Server State**: The state parameter generated by the MCP server for its own session management

**Problem without state preservation:**
```
Claude Code → MCP Server → Google OAuth
   state=abc123     state=xyz789

Google → MCP Server → Claude Code
         state=xyz789   state=xyz789  ❌ WRONG!

Claude Code expects: state=abc123 ✅
```

**Solution with state preservation:**
```
Claude Code → MCP Server → Google OAuth
   state=abc123     state=xyz789
   (stored in session)

Google → MCP Server → Claude Code
         state=xyz789   state=abc123  ✅ CORRECT!
         (lookup client state from session)
```

### How It Works

When an OAuth client initiates authentication:

1. **Client sends state**: `GET /auth/google?state=client-state-123&redirect_uri=http://localhost:6274/callback`
2. **Server stores client state**: Creates OAuth session with both `state` (server) and `clientState` (client)
3. **Server redirects to provider**: Uses server state for its own session management
4. **Provider redirects back**: Server validates using server state
5. **Server redirects to client**: Returns client's original state, not server state

### Configuration

**For Direct Server Usage (No Client State):**
```bash
# Traditional OAuth - server manages everything
curl http://localhost:3000/auth/google
```

**For Client-Managed OAuth (Claude Code, MCP Inspector):**
```bash
# Client sends its own state and redirect_uri
curl "http://localhost:3000/auth/google?state=abc123&redirect_uri=http://localhost:6274/callback"
```

### Testing OAuth Client State Preservation

The feature is comprehensively tested with unit tests in `test/unit/auth/providers/base-provider.test.ts`:

**Test Coverage:**
- ✅ Client state storage and retrieval in OAuth sessions
- ✅ Client redirect with original client state returned
- ✅ Fallback to server state when client state not provided
- ✅ No redirect when clientRedirectUri not provided
- ✅ Direct server usage without client state

**Run tests:**
```bash
npm run test:unit  # All unit tests including OAuth state preservation
npm run validate   # Full validation including tests
```

### Supported OAuth Clients

This feature enables seamless integration with:

- **Claude Code**: Anthropic's AI assistant with managed OAuth
- **MCP Inspector**: Development tool for testing MCP servers
- **Custom MCP Clients**: Any OAuth client using Dynamic Client Registration (RFC 7591)

### Implementation Details

**Data Structures:**
```typescript
interface OAuthSession {
  state: string;              // Server-generated state (for session management)
  clientState?: string;       // Client's original state (for validation)
  clientRedirectUri?: string; // Client's redirect URI
  codeVerifier: string;       // PKCE verifier
  codeChallenge: string;      // PKCE challenge
  // ... other fields
}
```

**State Preservation Flow:**
```typescript
// 1. Extract client state from request
const clientState = req.query.state as string | undefined;

// 2. Store in session
const session = createOAuthSession(
  serverState,
  codeVerifier,
  codeChallenge,
  clientRedirectUri,
  scopes,
  clientState  // ✅ Preserved
);

// 3. Return client state on redirect
const stateToReturn = session.clientState || serverState;
redirectUrl.searchParams.set('state', stateToReturn);
```

### Backward Compatibility

The implementation maintains **full backward compatibility**:

- **With client state**: Returns client's original state (new behavior)
- **Without client state**: Returns server state (original behavior)
- **Direct server usage**: Works unchanged (traditional OAuth flow)

No configuration changes required - the feature activates automatically when clients provide their own state parameter.

### Debugging

Enable OAuth debug logging:
```bash
export NODE_ENV=development
npm run dev:oauth
```

**Debug output shows:**
```
[oauth:debug] Client state parameter { provider: 'Google', clientStatePrefix: '9744e5b2' }
[oauth:debug] Returning client original state { provider: 'Google', clientStatePrefix: '9744e5b2' }
```

### Related Documentation

- **Architecture Decision**: See `docs/adr/` for ADR on OAuth client state preservation
- **Testing Strategy**: See `test/unit/auth/providers/base-provider.test.ts`
- **Integration Guide**: See `CLAUDE.md` for Claude Code connection instructions

## Security Best Practices

1. **Use HTTPS in production**
2. **Set secure session secrets**
3. **Restrict allowed origins/hosts**
4. **Use least-privilege OAuth scopes**
5. **Regularly rotate client secrets**
6. **Monitor session activity via admin endpoints**
7. **Validate state parameters** (handled automatically by OAuth client state preservation)

Need help with a specific provider or issue? Check the server logs or health endpoint for detailed error information.