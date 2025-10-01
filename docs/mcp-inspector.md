# MCP Inspector Guide

The MCP Inspector is an interactive debugging tool for testing and exploring Model Context Protocol (MCP) servers. It provides a browser-based interface to connect to your MCP server, discover available tools, and test tool invocations.

## What is MCP Inspector?

MCP Inspector is an official tool from the Model Context Protocol team that allows you to:
- **Connect** to MCP servers via HTTP or STDIO transports
- **Discover** available tools and their schemas
- **Test** tool invocations with custom parameters
- **Debug** request/response flows in real-time
- **Validate** MCP protocol compliance

## Installation

MCP Inspector can be run directly via `npx` without installation:

```bash
npx @modelcontextprotocol/inspector@latest <server-url>
```

## Usage

### Testing Local Development Server

When running the MCP server locally in HTTP mode:

```bash
# Start the local server (in one terminal)
npm run dev:http

# Open inspector (in another terminal)
npx @modelcontextprotocol/inspector@latest http://localhost:3000/api/mcp
```

The Inspector will open in your default browser at `http://localhost:5173`.

### Testing Vercel Local Development

When testing with Vercel dev server:

```bash
# Start Vercel dev server (in one terminal)
npm run dev:vercel

# Open inspector (in another terminal)
npx @modelcontextprotocol/inspector@latest http://localhost:3000/api/mcp
```

### Testing Vercel Preview Deployments

After deploying to Vercel preview:

```bash
# Replace with your actual preview URL
npx @modelcontextprotocol/inspector@latest https://mcp-typescript-simple-git-<branch>-<username>.vercel.app/api/mcp
```

### Testing Vercel Production

```bash
npx @modelcontextprotocol/inspector@latest https://your-production-domain.vercel.app/api/mcp
```

## Inspector Interface

Once the Inspector opens in your browser, you'll see:

### 1. Connection Status
- **Green indicator**: Connected to MCP server
- **Red indicator**: Connection failed
- **Server info**: Name, version, capabilities

### 2. Tools Discovery
- **Available tools list**: All tools exposed by your MCP server
- **Tool schemas**: Input parameters, types, and descriptions
- **Tool categories**: Basic tools (echo, hello) and LLM-powered tools (chat, analyze, summarize)

### 3. Tool Testing
- **Parameter form**: Interactive form for tool parameters
- **Invoke button**: Execute the tool with provided parameters
- **Response viewer**: JSON-formatted response from the server
- **Error handling**: Clear error messages for validation failures

### 4. Request/Response Logs
- **Request history**: All invocations made during the session
- **Timing information**: Response times for performance analysis
- **Raw JSON**: View exact request/response payloads

## Example Workflow

### Testing the "echo" Tool

1. **Open Inspector**:
   ```bash
   npx @modelcontextprotocol/inspector@latest http://localhost:3000/api/mcp
   ```

2. **Select "echo" tool** from the tools list

3. **Enter parameters**:
   ```json
   {
     "message": "Hello from MCP Inspector!"
   }
   ```

4. **Click "Invoke"**

5. **View response**:
   ```json
   {
     "content": [
       {
         "type": "text",
         "text": "Hello from MCP Inspector!"
       }
     ]
   }
   ```

### Testing LLM-Powered Tools

For tools like `chat`, `analyze`, or `summarize`:

1. **Ensure LLM API keys are configured**:
   - Local: Check `.env` file has `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_API_KEY`
   - Vercel: Ensure environment variables are set in Vercel dashboard

2. **Select the tool** (e.g., "chat")

3. **Provide required parameters**:
   ```json
   {
     "message": "Explain how MCP works",
     "provider": "gemini",
     "model": "gemini-1.5-flash"
   }
   ```

4. **View AI-generated response**

## Troubleshooting

### Connection Refused

**Error**: "Failed to connect to http://localhost:3000/api/mcp"

**Solutions**:
1. Ensure the MCP server is running (`npm run dev:http`)
2. Verify the server is listening on port 3000 (`curl http://localhost:3000/health`)
3. Check for port conflicts (`lsof -i :3000`)

### CORS Errors

**Error**: "Cross-Origin Request Blocked"

**Solutions**:
1. Ensure CORS is enabled in server configuration
2. Verify `Access-Control-Allow-Origin` header is set
3. Check `Access-Control-Allow-Headers` includes required headers

### Tool Not Found

**Error**: "Tool 'xyz' not found"

**Solutions**:
1. Check tool is registered in `src/server/mcp-setup.ts`
2. Verify tool handler is exported correctly
3. Restart server after code changes

### Authentication Required

**Error**: "401 Unauthorized"

**Solutions**:
1. For local testing, use `npm run dev:http` (auth disabled)
2. For OAuth testing, use `npm run dev:oauth` and complete authentication
3. For Vercel, ensure you're on the whitelist (see sharing guide)

### LLM Tools Unavailable

**Error**: "LLM providers not initialized"

**Solutions**:
1. Check API keys are configured in environment variables
2. Verify at least one LLM provider is available
3. Check server logs for initialization errors

## Advanced Usage

### Custom Inspector Port

Run Inspector on a different port:

```bash
npx @modelcontextprotocol/inspector@latest http://localhost:3000/api/mcp --port 8080
```

### Debug Mode

Enable verbose logging:

```bash
DEBUG=mcp:* npx @modelcontextprotocol/inspector@latest http://localhost:3000/api/mcp
```

### Testing with Authentication

For servers requiring OAuth:

1. First authenticate via browser:
   ```bash
   open http://localhost:3000/auth
   ```

2. Complete OAuth flow and get access token

3. Use token in Inspector (if supported)

## Integration with Development Workflow

### Pre-Deployment Validation

Before deploying to Vercel:

```bash
# Build and start local Vercel dev server
npm run build
npm run dev:vercel

# Test with Inspector
npx @modelcontextprotocol/inspector@latest http://localhost:3000/api/mcp

# Verify all tools work
# Check LLM integration
# Test error handling
```

### Post-Deployment Validation

After deploying to Vercel preview:

```bash
# Get preview URL from Vercel CLI
vercel inspect <deployment-url>

# Test with Inspector
npx @modelcontextprotocol/inspector@latest <preview-url>/api/mcp

# Validate production configuration
# Test with real API keys
# Verify OAuth flow
```

## See Also

- [Vercel Deployment Guide](./vercel-deployment.md)
- [Vercel Local Development](./vercel-local-development.md)
- [Sharing MCP Server](./sharing-mcp-server.md)
- [OAuth Setup Guide](./oauth-setup.md)
