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

1. **Node.js**: Version 20.0.0 or higher
2. **Vercel Account**: Free or paid Vercel account
3. **Vercel CLI**: Installed globally (`npm install -g vercel`)
4. **API Keys**: At least one LLM provider API key
5. **OAuth Credentials**: For authentication (optional but recommended)

## Environment Variables

Configure these in your Vercel dashboard or via CLI:

### Required LLM Provider Keys (choose one or more)
```bash
ANTHROPIC_API_KEY=your_claude_api_key
OPENAI_API_KEY=your_openai_api_key
GOOGLE_API_KEY=your_gemini_api_key
```

### OAuth Configuration (optional)
```bash
OAUTH_PROVIDER=google  # google, github, microsoft, generic
```

#### For Google OAuth:
```bash
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

#### For GitHub OAuth:
```bash
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
```

#### For Microsoft OAuth:
```bash
MICROSOFT_CLIENT_ID=your_microsoft_client_id
MICROSOFT_CLIENT_SECRET=your_microsoft_client_secret
```

#### For Generic OAuth:
```bash
OAUTH_CLIENT_ID=your_oauth_client_id
OAUTH_CLIENT_SECRET=your_oauth_client_secret
OAUTH_AUTHORIZATION_URL=https://provider.com/oauth/authorize
OAUTH_TOKEN_URL=https://provider.com/oauth/token
OAUTH_USER_INFO_URL=https://provider.com/oauth/userinfo
```

### Optional Configuration
```bash
NODE_ENV=production
ALLOWED_ORIGINS=https://your-frontend.com,https://another-domain.com
ALLOWED_HOSTS=your-backend.vercel.app
```

## Deployment Steps

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

### 2. Local Development (Optional)

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

### 3. Deploy to Vercel

#### Option A: Using Vercel CLI

```bash
# Login to Vercel (if not already logged in)
vercel login

# Deploy to preview (for testing)
vercel

# Deploy to production
vercel --prod
```

#### Option B: Using Git Integration

1. Connect your GitHub repository to Vercel
2. Push your code to the main branch
3. Vercel will automatically deploy

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

### Environment Variables
- Never commit secrets to version control
- Use Vercel's encrypted environment variables
- Rotate API keys regularly

### CORS Configuration
- Configure `ALLOWED_ORIGINS` for production
- Enable `ALLOWED_HOSTS` for additional security
- Use HTTPS for all production traffic

### OAuth Security
- Use secure redirect URLs (HTTPS only)
- Implement proper session management
- Regular security audits of OAuth flows

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