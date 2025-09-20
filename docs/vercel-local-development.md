# Vercel Local Development Guide

This guide explains how to develop and test the MCP TypeScript Simple server locally using Vercel's development environment.

## Prerequisites

- Node.js 22+ installed
- Project dependencies installed (`npm install`)
- Project built (`npm run build`)

## Getting Started

### 1. Authentication

First, authenticate with Vercel (required for local development):

```bash
# Login to Vercel
npx vercel login
```

This opens a browser window for authentication. Follow the prompts to log in to your Vercel account.

### 2. Project Setup

You have two options for project setup:

#### Option A: Link to Existing Vercel Project
```bash
# Link to an existing Vercel project
npx vercel link
```

#### Option B: Run Without Linking (Recommended for Development)
```bash
# Skip linking and run locally only
# No additional setup needed
```

### 3. Start Development Server

```bash
# Method 1: Using npm script (recommended)
npm run dev:vercel

# Method 2: Direct Vercel command
npx vercel dev

# Method 3: Specify custom port
npx vercel dev --listen 3000
```

The server will start and display available endpoints:
```
✅ Ready! Available at http://localhost:3000
```

## Available Endpoints

Once the development server is running, you can access:

| Endpoint | Purpose | Method |
|----------|---------|---------|
| `/api/health` | Health check and deployment status | GET |
| `/api/mcp` | Main MCP protocol endpoint | POST |
| `/api/admin` | Administration and metrics | GET |
| `/api/admin/metrics` | Detailed metrics | GET |
| `/api/auth` | OAuth authentication flows | GET/POST |

## Manual Testing

### Health Check
```bash
curl http://localhost:3000/api/health | jq
```

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-20T10:30:00.000Z",
  "deployment": "vercel",
  "mode": "streamable_http",
  "auth": "disabled",
  "llm_providers": ["claude", "openai", "gemini"],
  "version": "1.0.0",
  "performance": {
    "uptime_seconds": 0.123,
    "memory_usage": {...}
  }
}
```

### MCP Protocol Testing

#### List Available Tools
```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
```

#### Call a Tool (Example: Hello)
```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "hello",
      "arguments": {
        "name": "Vercel Developer"
      }
    }
  }'
```

### Admin and Metrics
```bash
# Basic admin info
curl http://localhost:3000/api/admin/info | jq

# Detailed metrics
curl http://localhost:3000/api/admin/metrics | jq
```

## Environment Variables

### Required for Full Functionality

Create a `.env` file in the project root:

```bash
# LLM Providers (choose one or more)
ANTHROPIC_API_KEY=your_claude_api_key
OPENAI_API_KEY=your_openai_api_key
GOOGLE_API_KEY=your_gemini_api_key

# OAuth Configuration (optional)
OAUTH_PROVIDER=google
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Development Mode (optional)
NODE_ENV=development
```

### Setting Environment Variables in Terminal

```bash
# For current session only
export ANTHROPIC_API_KEY="your_key_here"
export OPENAI_API_KEY="your_key_here"
export GOOGLE_API_KEY="your_key_here"

# Then start Vercel dev
npm run dev:vercel
```

## Testing with MCP Clients

### Claude Desktop Configuration

Add to your Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "typescript-simple-local": {
      "command": "npx",
      "args": ["@modelcontextprotocol/client-typescript", "http://localhost:3000/api/mcp"],
      "transport": "streamable_http"
    }
  }
}
```

### Using MCP Inspector

For visual testing with a web interface:

```bash
# Install MCP Inspector globally
npm install -g @modelcontextprotocol/inspector

# Test against your local Vercel server
mcp-inspector http://localhost:3000/api/mcp
```

## Debugging and Development

### Viewing Logs

Vercel dev shows real-time logs in the terminal:

```bash
npm run dev:vercel
# Watch the console for request logs and errors
```

### Development Workflow

1. **Make changes** to source files in `src/` or `api/`
2. **Rebuild if needed** (TypeScript changes require `npm run build`)
3. **Vercel auto-reloads** API functions on file changes
4. **Test endpoints** using curl or MCP clients
5. **Check logs** in the terminal for debugging

### Hot Reloading

- **API Functions**: Auto-reload on file changes
- **TypeScript Source**: Requires manual rebuild (`npm run build`)
- **Configuration**: Restart Vercel dev after changes to `vercel.json`

## Troubleshooting

### Common Issues

#### 1. Authentication Failed
```bash
# Solution: Re-authenticate
npx vercel logout
npx vercel login
```

#### 2. Port Already in Use
```bash
# Solution: Use different port
npx vercel dev --listen 3001
```

#### 3. API Function Errors
```bash
# Solution: Check build and logs
npm run build
npm run dev:vercel
# Check terminal for error details
```

#### 4. Environment Variables Not Working
```bash
# Solution: Verify .env file or export variables
cat .env
# or
env | grep API_KEY
```

#### 5. TypeScript Compilation Errors
```bash
# Solution: Fix TypeScript errors first
npm run typecheck
npm run build
```

### Testing Without Vercel CLI

If Vercel authentication fails, you can still test API functions:

```bash
# Test configuration
npm run test:vercel-config

# Test transport layer
npm run test:transport

# Direct API testing
npx tsx test-api-direct.ts
```

### Development Performance

For faster development cycles:

```bash
# Terminal 1: Watch and rebuild TypeScript
npm run build -- --watch

# Terminal 2: Run Vercel dev
npm run dev:vercel
```

## Advanced Configuration

### Custom Vercel Settings

Create `vercel.json` overrides for local development:

```json
{
  "functions": {
    "api/mcp.ts": {
      "maxDuration": 30
    }
  },
  "env": {
    "NODE_ENV": "development"
  }
}
```

### Debug Mode

Enable verbose logging:

```bash
# Enable debug mode
DEBUG=vercel* npm run dev:vercel
```

### Testing Different Node.js Versions

Specify Node.js version for testing:

```bash
# Test with specific Node version (if needed)
node --version  # Should be 22+
npm run dev:vercel
```

## Integration with Other Services

### Database Testing

If using a database, configure local connection strings:

```bash
# Example for PostgreSQL
DATABASE_URL="postgresql://localhost:5432/mcp_dev"
```

### External API Testing

Test with API mocking services:

```bash
# Use environment variables to point to mock services
LLM_API_BASE_URL="http://localhost:8080/mock"
```

## Production Deployment Testing

Before deploying to production:

```bash
# 1. Test locally
npm run dev:vercel

# 2. Validate configuration
npm run test:vercel-config

# 3. Run full test suite
npm run validate

# 4. Deploy to preview
npx vercel

# 5. Deploy to production
npx vercel --prod
```

## Next Steps

- **Production Deployment**: See [vercel-deployment.md](./vercel-deployment.md)
- **Quick Start**: See [vercel-quickstart.md](./vercel-quickstart.md)
- **MCP Protocol**: See main [README.md](../README.md)
- **Testing**: Run `npm run test:ci` for comprehensive validation