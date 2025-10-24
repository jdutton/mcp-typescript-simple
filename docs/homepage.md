# MCP TypeScript Simple Server

Production-ready Model Context Protocol (MCP) server with dual-mode operation, multi-LLM integration, and OAuth authentication.

## Features

- **Dual Transport**: STDIO (traditional) + Streamable HTTP with OAuth
- **Multi-LLM Support**: Claude, OpenAI, and Gemini with type-safe provider selection
- **OAuth 2.1**: Dynamic Client Registration (DCR) with PKCE support
- **Production Ready**: Vercel serverless deployment with observability
- **Type Safe**: Full TypeScript with comprehensive testing

## Quick Start

### For MCP Clients

Connect to this server from your MCP client:

**STDIO Mode (Local Development):**
```bash
# Add to your MCP client configuration
{
  "mcpServers": {
    "typescript-simple": {
      "command": "npx",
      "args": ["-y", "@mcp-typescript-simple/server"]
    }
  }
}
```

**HTTP Mode (Production):**
```bash
# For Claude Code or MCP Inspector
claude mcp add https://mcp-typescript-simple.vercel.app
```

### For Developers

**Clone and Run:**
```bash
git clone https://github.com/jdutton/mcp-typescript-simple.git
cd mcp-typescript-simple
npm install

# Choose your mode:
npm run dev:stdio        # STDIO mode (MCP Inspector)
npm run dev:http         # HTTP mode (no auth)
npm run dev:oauth        # HTTP mode (with OAuth)
```

**Test the Server:**
```bash
npm test                 # Unit tests
npm run test:integration # Integration tests
npm run validate         # Full validation pipeline
```

## Available Tools

### Basic Tools (Always Available)
- `hello` - Greet users by name
- `echo` - Echo back messages
- `current-time` - Get current timestamp

### LLM-Powered Tools (Requires API Keys)
- `chat` - Interactive AI assistant
- `analyze` - Deep text analysis
- `summarize` - Text summarization
- `explain` - Educational explanations

## API Endpoints

### Core Endpoints
- `GET /` - This homepage
- `GET /health` - Server health check
- `POST /mcp` - MCP JSON-RPC protocol endpoint

### OAuth Endpoints
- `GET /.well-known/oauth-authorization-server` - OAuth discovery
- `GET /auth` - OAuth authorization
- `POST /token` - OAuth token exchange
- `POST /register` - Dynamic client registration

### Documentation
- `GET /docs` - Interactive API documentation (Redoc)
- `GET /api-docs` - Swagger UI for testing
- `GET /openapi.yaml` - OpenAPI specification

### Administration
- `GET /admin/info` - Deployment information
- `GET /admin/sessions` - Active MCP sessions
- `GET /admin/metrics` - Server metrics

## Environment Variables

### LLM Providers (Optional)
Configure one or more LLM providers:
```bash
ANTHROPIC_API_KEY=sk-ant-...    # Claude models
OPENAI_API_KEY=sk-...           # GPT models
GOOGLE_API_KEY=...              # Gemini models
```

### OAuth Providers (Optional)
Configure one or more OAuth providers:
```bash
# Google OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# GitHub OAuth
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...

# Microsoft OAuth
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
MICROSOFT_TENANT_ID=common
```

## Documentation

- **API Reference**: [/docs](/docs) - Complete API documentation
- **OpenAPI Spec**: [/openapi.yaml](/openapi.yaml) - Machine-readable API spec
- **GitHub Repository**: [github.com/jdutton/mcp-typescript-simple](https://github.com/jdutton/mcp-typescript-simple)

## Deployment

**Vercel (Recommended):**
```bash
npm run build
vercel --prod
```

**Docker:**
```bash
docker build -t mcp-server .
docker run -p 3000:3000 mcp-server
```

## Support

- **Issues**: [GitHub Issues](https://github.com/jdutton/mcp-typescript-simple/issues)
- **Discussions**: [GitHub Discussions](https://github.com/jdutton/mcp-typescript-simple/discussions)
- **Documentation**: [docs/](https://github.com/jdutton/mcp-typescript-simple/tree/main/docs)

## License

MIT License - see [LICENSE](https://github.com/jdutton/mcp-typescript-simple/blob/main/LICENSE) for details.

---

**Version**: 1.0.0
**MCP Protocol**: v1.18.0
**Last Updated**: 2025-10-23
