# Vercel Quick Start Guide

Deploy the MCP TypeScript Simple server to Vercel in 5 minutes.

## Prerequisites

- Node.js 22+ installed
- Vercel account (free tier works)
- At least one LLM provider API key

## Quick Deploy

### 1. Install Dependencies

```bash
npm install
npm run build
```

### 2. Install Vercel CLI

```bash
npm install -g vercel
```

### 3. Deploy

```bash
vercel login
vercel --prod
```

### 4. Configure Environment Variables

In Vercel dashboard, add environment variables:

**Required** (choose at least one):
```
ANTHROPIC_API_KEY=your_claude_key
OPENAI_API_KEY=your_openai_key
GOOGLE_API_KEY=your_gemini_key
```

**Optional OAuth**:
```
OAUTH_PROVIDER=google
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

### 5. Test Deployment

Visit your deployment URL:
- `/api/health` - Check server status
- `/api/mcp` - MCP endpoint for clients

## Example MCP Client Config

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

## Available Tools

- `hello` - Say hello to someone
- `echo` - Echo back messages
- `current-time` - Get current timestamp
- `chat` - Interactive AI assistant (if LLM configured)
- `analyze` - Deep text analysis (if LLM configured)
- `summarize` - Text summarization (if LLM configured)
- `explain` - Educational explanations (if LLM configured)

## Need Help?

See the [full deployment guide](./vercel-deployment.md) for detailed instructions.