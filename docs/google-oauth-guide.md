# Google OAuth Setup Guide for MCP TypeScript Server

## Table of Contents
- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Google Cloud Console Setup](#google-cloud-console-setup)
- [Local Development Setup](#local-development-setup)
- [Vercel Production Setup](#vercel-production-setup)
- [Testing with MCP Inspector](#testing-with-mcp-inspector)
- [API Endpoints](#api-endpoints)
- [Troubleshooting](#troubleshooting)
- [Security Best Practices](#security-best-practices)

## Overview

This guide provides comprehensive instructions for setting up Google OAuth authentication with the MCP TypeScript server. Google OAuth enables users to authenticate using their Google accounts, providing secure access to MCP functionality.

### Features
- ✅ Full OAuth 2.0 flow support (authorization, callback, refresh, logout)
- ✅ PKCE (Proof Key for Code Exchange) for enhanced security
- ✅ Google Identity Services integration
- ✅ Token management and session handling
- ✅ Compatible with MCP Inspector
- ✅ Works with both local development and Vercel deployments

## Prerequisites

Before setting up Google OAuth, ensure you have:

1. **Google Account**: Any personal or workspace Google account
2. **Node.js**: Version 22.0.0 or higher
3. **MCP TypeScript Server**: Cloned and dependencies installed
4. **MCP Inspector**: For testing OAuth flows (optional but recommended)

## Google Cloud Console Setup

### Step 1: Access Google Cloud Console

1. **Navigate to Google Cloud Console**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Sign in with your Google account

### Step 2: Create or Select Project

1. **Create New Project** (or select existing)
   - Click on the project dropdown (top left, next to "Google Cloud")
   - Click **"New Project"**
   - Enter project details:
     ```
     Project name: MCP OAuth Server
     Organization: (leave as "No organization" for personal accounts)
     Location: (leave as default)
     ```
   - Click **"Create"**
   - Wait for project creation (takes a few seconds)
   - Select your newly created project from the dropdown

### Step 3: Configure OAuth Consent Screen

1. **Navigate to OAuth Consent Screen**
   - In the left sidebar, go to **"APIs & Services" > "OAuth consent screen"**

2. **Select User Type**
   - Choose **"External"** (unless you have a Google Workspace account)
   - Click **"Create"**

3. **Configure OAuth Consent Screen (Step 1: App information)**
   ```
   App name: MCP TypeScript Server
   User support email: [Your email address]
   App logo: (optional - skip for development)

   Application home page: http://localhost:3000
   Application privacy policy link: (optional - skip for development)
   Application terms of service link: (optional - skip for development)

   Authorized domains: (leave empty for localhost development)

   Developer contact information:
   Email addresses: [Your email address]
   ```
   - Click **"Save and Continue"**

4. **Configure Scopes (Step 2: Scopes)**
   - Click **"Add or Remove Scopes"**
   - Select these scopes:
     - ✅ `openid` - Associate you with your personal info on Google
     - ✅ `profile` - See your personal info
     - ✅ `email` - See your primary Google Account email address
   - Click **"Update"**
   - Click **"Save and Continue"**

5. **Add Test Users (Step 3: Test users)**
   - Click **"+ Add Users"**
   - Enter your Google email address (the one you'll use for testing)
   - Click **"Add"**
   - Click **"Save and Continue"**

6. **Review Summary (Step 4: Summary)**
   - Review your configuration
   - Click **"Back to Dashboard"**

### Step 4: Create OAuth Credentials

1. **Navigate to Credentials**
   - Go to **"APIs & Services" > "Credentials"**
   - Click **"+ Create Credentials"**
   - Select **"OAuth client ID"**

2. **Configure OAuth Client - Local Development**
   ```
   Application type: Web application

   Name: MCP Local Development

   Authorized JavaScript origins:
   • http://localhost:3000

   Authorized redirect URIs:
   • http://localhost:3000/auth/google/callback
   ```
   - Click **"Create"**
   - **Important**: Copy and save both:
     - **Client ID** (looks like: `123456789-abcdefg.apps.googleusercontent.com`)
     - **Client Secret** (looks like: `GOCSPX-abcdefghijklmnop`)

3. **Create OAuth Client - Vercel Production** (Optional)
   - Repeat the credential creation process with:
   ```
   Application type: Web application

   Name: MCP Production (Vercel)

   Authorized JavaScript origins:
   • https://your-app.vercel.app

   Authorized redirect URIs:
   • https://your-app.vercel.app/auth/google/callback
   ```

## Local Development Setup

### Step 1: Configure Environment Variables

Create a `.env` file in your project root:

```bash
# Google OAuth Configuration (auto-detected by server)
GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

# Optional: Custom scopes (defaults to 'openid,email,profile')
GOOGLE_SCOPES=openid,email,profile

# User Allowlist (comma-separated email addresses)
USER_ALLOWLIST=your.email@gmail.com

# LLM Provider API Keys (optional)
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
GOOGLE_API_KEY=your_key_here
```

### Step 2: Start Development Server

```bash
# Install dependencies (if not already done)
npm install

# Build the project
npm run build

# Start with OAuth enabled
npm run dev:oauth
```

The server will start on `http://localhost:3000`

### Step 3: Verify Configuration

Test the health endpoint:
```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "healthy",
  "mode": "streamable_http",
  "auth": "enabled",
  "oauth_provider": "google",
  "version": "1.0.0"
}
```

## Vercel Production Setup

### Step 1: Configure Vercel Environment Variables

Using Vercel CLI:
```bash
# Set Google credentials (server will auto-detect provider)
vercel env add GOOGLE_CLIENT_ID production
# Enter: your_client_id.apps.googleusercontent.com

vercel env add GOOGLE_CLIENT_SECRET production
# Enter: GOCSPX-your_secret

# Set user allowlist
vercel env add USER_ALLOWLIST production
# Enter: your.email@gmail.com

# Optional: LLM API keys
vercel env add ANTHROPIC_API_KEY production
vercel env add OPENAI_API_KEY production
vercel env add GOOGLE_API_KEY production
```

Or via Vercel Dashboard:
1. Go to https://vercel.com/your-team/your-project/settings/environment-variables
2. Add each variable for "Production" environment
3. Redeploy your application

### Step 2: Update Google OAuth Credentials

1. Go back to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **"APIs & Services" > "Credentials"**
3. Select your production OAuth client ID
4. Add your Vercel domain:
   ```
   Authorized redirect URIs:
   • https://your-app.vercel.app/auth/google/callback
   ```
5. Click **"Save"**

### Step 3: Deploy and Test

```bash
# Deploy to production
vercel --prod

# Test production OAuth
curl https://your-app.vercel.app/health
```

## Testing with MCP Inspector

### Step 1: Install MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

### Step 2: Configure Connection

In MCP Inspector, use these settings:

**For Local Development:**
```json
{
  "command": "node",
  "args": ["build/index.js"],
  "env": {
    "MCP_MODE": "streamable_http",
    "HTTP_SERVER_URL": "http://localhost:3000",
    "GOOGLE_CLIENT_ID": "your_client_id.apps.googleusercontent.com",
    "GOOGLE_CLIENT_SECRET": "GOCSPX-your_secret",
    "USER_ALLOWLIST": "your.email@gmail.com"
  }
}
```

### Step 3: Test OAuth Flow

1. Start MCP Inspector
2. Connect to your server configuration
3. Click the OAuth button
4. You should be redirected to Google's sign-in page
5. Sign in with your Google account
6. Grant permissions when prompted
7. You'll be redirected back and authenticated

## API Endpoints

### OAuth Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/google` | GET | Initiate Google OAuth authorization |
| `/auth/google/callback` | GET | Handle OAuth callback from Google |
| `/auth/google/refresh` | POST | Refresh access token |
| `/auth/google/logout` | POST | End OAuth session |

### Health & Admin Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Server health and configuration status |
| `/admin/sessions` | GET | List active OAuth sessions |
| `/admin/sessions/:id` | DELETE | Revoke specific session |

### Example: Test Authorization Endpoint

```bash
# Initiate OAuth flow
curl -i http://localhost:3000/auth/google
```

Expected: 307 redirect to Google's authorization page

## Troubleshooting

### Error: "redirect_uri_mismatch"

**Cause**: The redirect URI in your request doesn't match what's registered in Google Cloud Console

**Solution**:
1. Check your `.env` file: `GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback`
2. Verify in Google Cloud Console that this exact URI is in the "Authorized redirect URIs" list
3. Ensure no trailing slashes or extra characters

### Error: "Access blocked: This app's request is invalid"

**Cause**: OAuth consent screen is not properly configured or missing required scopes

**Solution**:
1. Go to Google Cloud Console → OAuth consent screen
2. Verify all required fields are filled
3. Ensure scopes `openid`, `email`, `profile` are added
4. Check that your email is added as a test user

### Error: "Access denied - email not authorized"

**Cause**: User's email is not in the `USER_ALLOWLIST`

**Solution**:
1. Check your `.env` file: `USER_ALLOWLIST=your.email@gmail.com`
2. Ensure the email matches exactly (case-sensitive)
3. For multiple users, use comma separation: `user1@gmail.com,user2@gmail.com`

### Error: "Failed to fetch user information"

**Cause**: Network issue or invalid access token

**Solution**:
1. Check server logs for detailed error messages
2. Verify your Google Client ID and Secret are correct
3. Ensure you're using the correct OAuth client (not Service Account)
4. Try revoking and re-authorizing the app

### Error: "Token exchange failed"

**Cause**: Invalid authorization code or client credentials

**Solution**:
1. Verify `GOOGLE_CLIENT_SECRET` is correctly set
2. Check that the authorization code hasn't expired (they expire quickly)
3. Ensure system clock is synchronized (OAuth is time-sensitive)

## Security Best Practices

### For Development

1. **Never commit credentials**
   - Add `.env` to `.gitignore`
   - Use `.env.example` for documentation

2. **Use localhost only**
   - Keep development redirect URIs on `localhost`
   - Don't expose development servers to internet

3. **Test users only**
   - Add specific test users to OAuth consent screen
   - Don't publish consent screen for development

### For Production

1. **Environment variables**
   - Store credentials in Vercel environment variables
   - Use different OAuth clients for dev/staging/prod

2. **User allowlist**
   - Maintain strict user allowlist
   - Review and update regularly

3. **HTTPS only**
   - Always use HTTPS in production
   - Vercel provides this automatically

4. **Token security**
   - Tokens are stored in memory only (serverless)
   - Sessions don't persist between function invocations
   - Implement token refresh logic for long-lived sessions

5. **OAuth consent**
   - Verify OAuth consent screen before production
   - Request minimum necessary scopes
   - Provide clear privacy policy if required

## Additional Resources

- [Google Identity Documentation](https://developers.google.com/identity)
- [OAuth 2.0 for Web Apps](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google Cloud Console](https://console.cloud.google.com/)
- [MCP Specification](https://modelcontextprotocol.io/)
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector)

## Support

For issues or questions:
1. Check server logs: `npm run dev:oauth`
2. Review health endpoint: `http://localhost:3000/health`
3. Verify Google Cloud Console configuration
4. Check GitHub issues: [MCP TypeScript Simple Issues](https://github.com/your-repo/issues)
