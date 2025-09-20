# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
This is a production-ready TypeScript-based MCP (Model Context Protocol) server featuring:
- **Dual-mode operation**: STDIO (traditional) + Streamable HTTP with OAuth
- **Multi-LLM integration**: Claude, OpenAI, and Gemini with type-safe provider selection
- **Vercel serverless deployment**: Ready for production deployment as serverless functions
- **Comprehensive testing**: Full CI/CD pipeline with protocol compliance testing

## Development Commands

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Development modes
npm run dev              # STDIO mode (recommended for MCP development)
npm run dev:sse          # Streamable HTTP mode (no auth)
npm run dev:oauth        # Streamable HTTP mode (with OAuth)
npm run dev:vercel       # Vercel local development server

# Testing
npm test                 # Jest unit tests
npm run test:ci          # Comprehensive CI/CD test suite
npm run test:mcp         # MCP protocol and tool tests
npm run test:interactive # Interactive MCP client
npm run test:dual-mode   # Dual-mode functionality test
npm run validate         # Complete validation (typecheck + lint + build + test)

# Code quality
npm run lint             # ESLint code checking
npm run typecheck        # TypeScript type checking

# Deployment
npm run deploy:vercel    # Deploy to Vercel production
```

## Project Architecture

```
├── src/                          # TypeScript source code
│   ├── index.ts                 # Main MCP server (STDIO + Streamable HTTP)
│   ├── auth/                    # OAuth authentication system
│   ├── config/                  # Environment and configuration management
│   ├── llm/                     # Multi-LLM provider integration
│   ├── secrets/                 # Tiered secret management
│   ├── server/                  # HTTP and MCP server implementations
│   ├── session/                 # Session management
│   ├── tools/                   # MCP tool implementations
│   └── transport/               # Transport layer abstractions
├── api/                         # Vercel serverless functions
│   ├── mcp.ts                  # Main MCP protocol endpoint
│   ├── auth.ts                 # OAuth authentication endpoints
│   ├── health.ts               # Health check and status
│   └── admin.ts                # Administration and metrics
├── test/                        # Comprehensive test suite
├── docs/                        # Deployment documentation
├── build/                       # Compiled JavaScript output
├── vercel.json                  # Vercel deployment configuration
└── package.json                # Dependencies and scripts
```

## MCP-Specific Patterns
- **Protocol Compliance**: Full MCP 1.18.0 specification support
- **Tool Schemas**: Comprehensive input validation with JSON Schema
- **Transport Layers**: Both STDIO and Streamable HTTP transports
- **Error Handling**: Graceful error responses following MCP standards
- **Type Safety**: Full TypeScript integration with MCP SDK types

## Available Tools
### Basic Tools
- `hello` - Greet users by name
- `echo` - Echo back messages
- `current-time` - Get current timestamp

### LLM-Powered Tools (Optional - requires API keys)
- `chat` - Interactive AI assistant with provider/model selection
- `analyze` - Deep text analysis with configurable AI models
- `summarize` - Text summarization with cost-effective options
- `explain` - Educational explanations with adaptive AI models

## Multi-LLM Integration
- **Type-Safe Provider Selection**: Claude, OpenAI, Gemini with compile-time validation
- **Model-Specific Optimization**: Each tool has optimized default provider/model combinations
- **Runtime Flexibility**: Override provider/model per request
- **Automatic Fallback**: Graceful degradation if providers unavailable

## Deployment Options

### Local Development
```bash
npm run dev              # STDIO mode for MCP clients
npm run dev:sse          # HTTP mode without authentication
npm run dev:oauth        # HTTP mode with OAuth
```

### Vercel Serverless Deployment
```bash
# Quick deployment
npm run build
vercel --prod

# Local testing
npm run dev:vercel
```

**Vercel Features:**
- Auto-scaling serverless functions
- Built-in monitoring and metrics
- Multi-provider OAuth support
- Global CDN distribution
- Comprehensive logging

## Environment Variables
### LLM Providers (choose one or more)
- `ANTHROPIC_API_KEY` - Claude models
- `OPENAI_API_KEY` - GPT models
- `GOOGLE_API_KEY` - Gemini models

### OAuth Configuration (optional)
- `OAUTH_PROVIDER` - google, github, microsoft, generic
- Provider-specific client ID/secret pairs

## Testing Strategy
- **CI/CD Pipeline**: Comprehensive automated testing via GitHub Actions
- **Protocol Compliance**: Full MCP specification validation
- **Tool Functionality**: Individual and integration tool testing
- **Dual-Mode Testing**: Both STDIO and HTTP transport validation
- **Interactive Testing**: Manual testing client with tool discovery

## Key Dependencies
- `@modelcontextprotocol/sdk` - Core MCP SDK (v1.18.0)
- `@anthropic-ai/sdk` - Claude AI integration
- `openai` - OpenAI GPT integration
- `@google/generative-ai` - Gemini AI integration
- `express` - HTTP server for Streamable HTTP transport
- `@vercel/node` - Vercel serverless function support
- `typescript` - TypeScript compiler with strict configuration