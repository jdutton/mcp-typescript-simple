# Vercel Deployment Guide

This guide explains how to deploy the MCP TypeScript Simple server to Vercel as serverless functions.

## Overview

The MCP TypeScript Simple server has been adapted to run on Vercel using serverless functions while maintaining full compatibility with the Model Context Protocol (MCP) Streamable HTTP transport.

### Key Features

- **Serverless Functions**: Each API endpoint runs as an independent serverless function
- **Streamable HTTP Support**: Full MCP streaming support with Vercel's streaming capabilities
- **Multi-Provider OAuth**: Support for Google, GitHub, Microsoft, and generic OAuth providers
- **Multi-LLM Integration**: Claude, OpenAI, and Gemini AI providers
- **Observability**: Built-in health checks, metrics, and request logging
- **Auto-scaling**: Vercel's automatic scaling based on demand
- **Automated CI/CD**: GitHub Actions automatically deploys to production on merge to main

## Automated Deployment (Recommended)

**The recommended deployment method is via GitHub Actions CI/CD pipeline**, which automatically deploys to Vercel production whenever code is merged to the `main` branch.

### Prerequisites for Automated Deployment

1. **Vercel Project**: Create a new Vercel project (see setup instructions below)
2. **GitHub Secrets**: Configure required secrets in your GitHub repository
3. **Vercel Token**: Generate a Vercel API token for CI/CD access

### Initial Vercel Project Setup

**One-time setup to create the Vercel project:**

```bash
# 1. Login to Vercel
vercel login

# 2. Link the project (creates new project if it doesn't exist)
vercel link

# Follow the prompts:
# - Set up and deploy? Yes
# - Which scope? Select your account/team
# - Link to existing project? No (create new)
# - What's your project's name? mcp-typescript-simple
# - In which directory is your code located? ./

# 3. Note the Project ID and Org ID from .vercel/project.json
cat .vercel/project.json
```

### Configure GitHub Secrets

In your GitHub repository settings, add these secrets (Settings → Secrets and variables → Actions):

#### Required Secrets

```bash
VERCEL_TOKEN              # Generate at https://vercel.com/account/tokens
VERCEL_ORG_ID             # From .vercel/project.json (orgId field)
VERCEL_PROJECT_ID         # From .vercel/project.json (projectId field)
TOKEN_ENCRYPTION_KEY      # 32-byte base64 key (see generation instructions above)
```

**Note**: TOKEN_ENCRYPTION_KEY must also be added as a Vercel environment variable (not just GitHub secret). See "Required: Token Encryption Key" section above.

#### Optional LLM Provider Secrets (for AI tools)

```bash
ANTHROPIC_API_KEY     # For Claude models
OPENAI_API_KEY        # For GPT models
GOOGLE_API_KEY        # For Gemini models
```

### How Automated Deployment Works

1. **Pull Request**: When you create a PR, GitHub Actions runs tests but does NOT deploy
2. **Merge to Main**: When PR is merged to `main`, GitHub Actions:
   - Runs complete test suite (unit, integration, Docker, Vercel validation)
   - Builds the project
   - Deploys to Vercel production automatically
3. **Deployment URL**: Check GitHub Actions logs for the production deployment URL

### Verify Automated Deployment

After merging to `main`, monitor the deployment:

```bash
# 1. Check GitHub Actions status
# Go to: https://github.com/<your-org>/mcp-typescript-simple/actions

# 2. Once deployed, verify health endpoint
curl https://your-project.vercel.app/api/health

# 3. Check deployment in Vercel dashboard
# Go to: https://vercel.com/dashboard
```

## Architecture

```
├── api/                     # Vercel serverless functions
│   ├── mcp.ts              # Main MCP protocol handler
│   ├── auth.ts             # OAuth authentication endpoints
│   ├── health.ts           # Health check endpoint
│   └── admin.ts            # Administration and metrics
├── src/                     # Source TypeScript code
├── build/                   # Compiled JavaScript (auto-generated)
├── vercel.json             # Vercel configuration
└── .vercelignore           # Files to exclude from deployment
```

## Prerequisites

1. **Node.js**: Version 22.0.0 or higher
2. **Vercel Account**: Free or paid Vercel account
3. **Vercel CLI**: Installed globally (`npm install -g vercel`)
4. **API Keys**: At least one LLM provider API key
5. **OAuth Credentials**: For authentication (optional but recommended)

## Environment Variables

Configure these in your Vercel dashboard or via CLI:

### Required: Token Encryption Key (Security)

**CRITICAL**: Required for Redis-backed session storage with AES-256-GCM encryption.

```bash
TOKEN_ENCRYPTION_KEY=<32-byte-base64-encoded-key>
```

**How to generate:**
```bash
# Generate a secure 32-byte encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**How to add to Vercel:**
```bash
# Via Vercel CLI
vercel env add TOKEN_ENCRYPTION_KEY

# When prompted:
# - Paste the generated key
# - Select environments: Production, Preview, Development (all three)
```

**Or via Vercel Dashboard:**
1. Go to your project settings → Environment Variables
2. Add new variable: `TOKEN_ENCRYPTION_KEY`
3. Paste the generated key
4. Select all environments (Production, Preview, Development)
5. Save

**Security notes:**
- Generate a unique key for each project
- Never commit the key to version control
- Never share the key publicly
- Rotate the key if compromised (requires re-authentication for all users)

### Required: User Allowlist (Security)

```bash
ALLOWED_USERS=user1@example.com,user2@example.com,admin@company.com
```

**CRITICAL**: This controls who can access your MCP server:
- Comma-separated list of authorized email addresses
- If not set, all authenticated users will be allowed (with warning logged)
- Emails are case-insensitive and automatically normalized
- Use the email address from your OAuth provider (Google, GitHub, Microsoft)

### Required: OAuth Configuration

**Multi-Provider Support**: Configure one or more OAuth providers. The server automatically detects all configured providers and presents them as login options. Users choose their preferred provider at login time.

### Optional: LLM Provider Keys (for AI-powered tools)

Choose one or more LLM providers:

```bash
ANTHROPIC_API_KEY=your_claude_api_key
OPENAI_API_KEY=your_openai_api_key
GOOGLE_API_KEY=your_gemini_api_key
```

**Note**: Without LLM keys, only basic tools (`echo`, `hello`, `current-time`) will work.

#### Google OAuth (Optional)

```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://your-app.vercel.app/auth/google/callback
```

**Setup steps:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create project → APIs & Services → Credentials
3. Create OAuth client ID → Web application
4. Add authorized redirect URI: `https://your-app.vercel.app/auth/google/callback`
5. Copy Client ID and Client Secret to Vercel environment variables

#### GitHub OAuth (Optional)

```bash
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_REDIRECT_URI=https://your-app.vercel.app/auth/github/callback
```

**Setup steps:**
1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. New OAuth App
3. Authorization callback URL: `https://your-app.vercel.app/auth/github/callback`
4. Generate client secret
5. Copy Client ID and Client Secret to Vercel environment variables

#### Microsoft OAuth (Optional)

```bash
MICROSOFT_CLIENT_ID=your-azure-client-id
MICROSOFT_CLIENT_SECRET=your-azure-client-secret
MICROSOFT_REDIRECT_URI=https://your-app.vercel.app/auth/microsoft/callback
MICROSOFT_TENANT_ID=common  # or your-tenant-id for single-tenant
```

**Setup steps:**
1. Go to [Azure Portal](https://portal.azure.com/)
2. Azure Active Directory → App registrations → New registration
3. Redirect URI: Web, `https://your-app.vercel.app/auth/microsoft/callback`
4. Certificates & secrets → New client secret
5. Copy Application (client) ID and client secret value to Vercel

#### Generic OAuth (Optional, Not Yet Implemented)

Generic OAuth provider support is planned but not yet implemented. Currently supported providers are Google, GitHub, and Microsoft.

### Optional Configuration

```bash
NODE_ENV=production
SESSION_SECRET=random-secret-at-least-32-chars
SESSION_TIMEOUT_MINUTES=60
REQUIRE_HTTPS=true
```

## Environment-Specific Configuration

### Production Environment

**Recommended settings:**
```bash
NODE_ENV=production
ALLOWED_USERS=your-real-users@company.com

# Configure one or more OAuth providers
GOOGLE_CLIENT_ID=production-client-id
GOOGLE_CLIENT_SECRET=production-secret

# LLM API keys
ANTHROPIC_API_KEY=production-key
```

**Security checklist:**
- ✅ `ALLOWED_USERS` configured with actual user emails
- ✅ OAuth redirect URI matches production domain
- ✅ Separate OAuth app from preview/development
- ✅ Production API keys (not development/test keys)
- ✅ HTTPS enforced (automatic on Vercel)

### Preview Environment (PR Deployments)

**Recommended settings:**
```bash
NODE_ENV=preview
ALLOWED_USERS=test@example.com,dev@example.com

# Configure OAuth providers
GOOGLE_CLIENT_ID=preview-client-id
GOOGLE_CLIENT_SECRET=preview-secret
```

**Notes:**
- Each PR gets a unique preview URL: `https://mcp-typescript-simple-<hash>.vercel.app`
- Use separate OAuth app with wildcard redirect URI or multiple URIs configured

### Development Environment (Local)

**Local development with Vercel:**
```bash
# Create .env.local file
ALLOWED_USERS=dev@example.com

# Configure one or more OAuth providers
GOOGLE_CLIENT_ID=dev-client-id
GOOGLE_CLIENT_SECRET=dev-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

# Run Vercel dev server
npm run dev:vercel
```

## Manual Deployment (Development/Testing Only)

**⚠️ Warning**: Manual deployments should only be used for development and testing. Production deployments MUST go through the automated GitHub Actions CI/CD pipeline.

### 1. Prepare the Project

```bash
# Clone the repository
git clone <repository-url>
cd mcp-typescript-simple

# Install dependencies
npm install

# Build the project
npm run build
```

### 2. Local Development

Test the Vercel functions locally:

```bash
# Start Vercel development server
npm run dev:vercel

# Or use Vercel CLI directly
vercel dev
```

The server will be available at `http://localhost:3000` with these endpoints:
- `http://localhost:3000/api/health` - Health check
- `http://localhost:3000/api/mcp` - MCP protocol endpoint
- `http://localhost:3000/api/auth` - OAuth endpoints
- `http://localhost:3000/api/admin` - Admin and metrics

### 3. Preview Deployment (Testing Only)

For testing purposes, you can deploy to a preview environment:

```bash
# Login to Vercel (if not already logged in)
vercel login

# Deploy to preview environment (for testing)
vercel

# ⚠️ DO NOT use --prod flag
# Production deployments MUST go through GitHub Actions
```

**Important Notes:**
- Preview deployments get a unique URL (e.g., `mcp-typescript-simple-abc123.vercel.app`)
- Use preview deployments to test changes before creating a PR
- Never manually deploy to production - always use GitHub Actions
- Production deployments require all CI checks to pass

### 4. Configure Environment Variables

In the Vercel dashboard:

1. Go to your project settings
2. Navigate to "Environment Variables"
3. Add the required variables listed above
4. Redeploy if variables were added after initial deployment

### 5. Configure Custom Domain (Optional)

1. In Vercel dashboard, go to "Domains"
2. Add your custom domain
3. Configure DNS records as instructed
4. Update OAuth redirect URLs to use your custom domain

## API Endpoints

After deployment, your MCP server will be available at:

### Core Endpoints
- `https://your-project.vercel.app/api/mcp` - MCP protocol endpoint
- `https://your-project.vercel.app/api/health` - Health check
- `https://your-project.vercel.app/api/auth/*` - OAuth authentication
- `https://your-project.vercel.app/api/admin/*` - Administration

### Health Check Response
```json
{
  "status": "healthy",
  "timestamp": "2023-12-07T10:30:00.000Z",
  "deployment": "vercel",
  "mode": "streamable_http",
  "auth": "enabled",
  "oauth_provider": "google",
  "llm_providers": ["claude", "openai", "gemini"],
  "version": "1.0.0",
  "node_version": "v20.10.0",
  "region": "iad1",
  "vercel_deployment_id": "dpl_abc123",
  "performance": {
    "uptime_seconds": 0.123,
    "memory_usage": {...},
    "cpu_usage": {...}
  }
}
```

## MCP Client Configuration

Configure your MCP client to connect to the deployed server:

```json
{
  "mcpServers": {
    "typescript-simple": {
      "command": "npx",
      "args": ["@modelcontextprotocol/client-typescript", "https://your-project.vercel.app/api/mcp"],
      "transport": "streamable_http"
    }
  }
}
```

## Monitoring and Observability

### Built-in Monitoring

- **Health Endpoint**: `/api/health` - Real-time health status
- **Metrics Endpoint**: `/api/admin/metrics` - Performance and deployment metrics
- **Request Logging**: All requests are logged with unique IDs and timing

### Vercel Analytics

Enable Vercel Analytics in your dashboard for:
- Request volume and latency
- Error rates and debugging
- Geographic distribution
- Function performance

### Log Access

```bash
# View function logs
vercel logs

# View logs for specific function
vercel logs --follow
```

## Troubleshooting

### Common Issues

#### 1. Build Failures
```bash
# Check TypeScript compilation
npm run typecheck

# Fix and rebuild
npm run build
```

#### 2. Environment Variable Issues
- Verify all required environment variables are set in Vercel dashboard
- Check variable names for typos
- Ensure values don't contain hidden characters

#### 3. OAuth Redirect Issues
- Update OAuth app redirect URLs to match your Vercel domain
- Ensure HTTPS is used in production
- Check that OAuth provider is correctly configured

#### 4. Function Timeouts
- Vercel free tier: 10-second timeout
- Vercel Pro tier: 60-second timeout
- Optimize LLM requests for faster responses

#### 5. Memory Limits
- Vercel free tier: 1024MB memory
- Monitor memory usage via `/api/admin/metrics`
- Optimize dependencies if needed

### Debug Commands

```bash
# Check Vercel CLI version
vercel --version

# Inspect function configuration
vercel inspect

# View deployment logs
vercel logs --follow

# Test health endpoint
curl https://your-project.vercel.app/api/health
```

## Performance Optimization

### Function Cold Starts
- Keep global variable initialization minimal
- Use function instance caching where appropriate
- Consider Vercel Pro for faster cold starts

### Memory Usage
- Monitor via `/api/admin/metrics`
- Optimize imports and dependencies
- Use streaming for large responses

### Response Times
- Enable Vercel Edge Functions for global distribution
- Use appropriate LLM models for your use case
- Implement request caching where beneficial

## Security Considerations

### User Allowlist (Critical)
- **Always configure `ALLOWED_USERS` in production** - Never leave it unset
- Use actual user email addresses from your OAuth provider
- Regularly review and update the allowlist
- Monitor logs for unauthorized access attempts
- Remove users who no longer need access

### Environment Variables
- Never commit secrets to version control
- Use Vercel's encrypted environment variables
- Rotate API keys and OAuth secrets regularly
- Use separate credentials for production/preview/development

### OAuth Security
- Use secure redirect URLs (HTTPS only in production)
- Separate OAuth apps for production vs preview/development
- Implement proper session management
- Regular security audits of OAuth flows
- Monitor for suspicious authentication patterns

### API Key Protection
- Store all API keys in Vercel environment variables
- Never log or expose API keys in responses
- Set up billing alerts with LLM providers
- Implement rate limiting for production use

## Cost Optimization

### Vercel Usage
- Monitor function invocations and bandwidth
- Use appropriate function regions
- Consider Vercel Pro for higher limits

### LLM API Costs
- Monitor LLM provider usage
- Implement request caching
- Use appropriate models for different use cases
- Set up billing alerts

## Support and Resources

- [Vercel Documentation](https://vercel.com/docs)
- [MCP Specification](https://modelcontextprotocol.io)
- [Project Repository Issues](https://github.com/jdutton/mcp-typescript-simple/issues)
- [Vercel Community](https://github.com/vercel/vercel/discussions)

## Next Steps

After successful deployment:

1. **Configure Monitoring**: Set up alerts for health endpoints
2. **Implement Caching**: Add Redis or similar for session/response caching
3. **Add Rate Limiting**: Implement request rate limiting for production
4. **Database Integration**: Add persistent storage if needed
5. **Custom Domain**: Configure your own domain for professional use
6. **CI/CD Pipeline**: Set up automated testing and deployment