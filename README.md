# MCP TypeScript Simple

A production-ready MCP (Model Context Protocol) server built with TypeScript featuring both basic tools and advanced LLM-powered capabilities with **type-safe provider and model selection** and **dual-mode operation** (STDIO + Streamable HTTP with OAuth).

## Key Features

### 🔒 **Type-Safe LLM Integration**
- **Provider Selection**: Choose between Claude, OpenAI, and Gemini with compile-time validation
- **Model Selection**: Select specific models per provider with type safety
- **Intelligent Defaults**: Each tool optimized for specific provider/model combinations
- **Runtime Flexibility**: Override provider/model per request
- **Backward Compatibility**: Existing code continues to work unchanged

### 🚀 **Dual-Mode Operation**
- **STDIO Mode**: Traditional stdin/stdout for development and Claude Desktop
- **Streamable HTTP Mode**: HTTP endpoints with streaming support for web applications
- **OAuth Authentication**: Secure Google OAuth integration for production
- **Development Bypass**: Easy auth bypass for local development
- **Claude Code Ready**: Full compatibility with Claude Code integration

## Current State

This project provides a containerized MCP server with comprehensive CI/CD testing and multi-LLM support:

### Basic Tools
- **hello**: Greets a person by name
- **echo**: Echoes back a provided message
- **current-time**: Returns the current timestamp

### LLM-Powered Tools (Optional)
- **chat**: Interactive AI assistant using Claude Haiku (fast responses)
- **analyze**: Deep text analysis using GPT-4 (sentiment, themes, structure)
- **summarize**: Text summarization using Gemini Flash (cost-effective)
- **explain**: Educational explanations using Claude (clear, adaptive to level)

> **Note**: LLM tools require API keys. The server gracefully runs with basic tools only if no API keys are configured.

## Prerequisites

- Node.js 22+ (Current LTS)
- Docker (via Colima on macOS)
- **Optional**: API keys for LLM providers (Anthropic, OpenAI, Google)

## Setup

### 1. Environment Configuration

Copy the example environment file and add your API keys:

```bash
cp .env.example .env
# Edit .env with your API keys
```

**API Key Sources:**
- **Anthropic Claude**: https://console.anthropic.com/
- **OpenAI**: https://platform.openai.com/api-keys
- **Google Gemini**: https://ai.google.dev/

> **Tip**: You can use any combination of providers. The server will automatically detect available APIs and enable corresponding tools.

### 2. Development

### Local Development

```bash
# Install dependencies
npm install

# STDIO Mode (traditional MCP - recommended for development)
npm run dev:stdio

# Streamable HTTP Mode (for web development - no auth)
npm run dev:http

# Streamable HTTP Mode (with OAuth - requires Google credentials)
npm run dev:oauth

# Vercel Serverless Development (test as serverless functions)
npm run dev:vercel

# Build the project
npm run build

# Production STDIO mode
npm start

# Production Streamable HTTP mode
npm run start:http

# Type checking
npm run typecheck

# Linting
npm run lint

# Unit tests with coverage
npm run test:unit

# Integration / CI suite
npm run test:integration

# Test dual-mode functionality
npm run test:dual-mode
```

#### Development Guides
- 📘 **Traditional Development**: Use the commands above for STDIO/Streamable HTTP modes
- 🛠️ **[Vercel Local Development](./docs/vercel-local-development.md)** - Complete guide for developing with Vercel locally
- 🏗️ **[System Architecture](./docs/architecture.md)** - Detailed architecture overview with diagrams
- 🚀 **[Dual-Mode Operation Guide](./docs/dual-mode-guide.md)** - Understanding STDIO and HTTP transport modes
- 🔐 **[OAuth Setup Guide](./docs/oauth-setup.md)** - Configure OAuth authentication

### Docker Development

```bash
# Build Docker image
docker build -t mcp-typescript-simple .

# Run container
docker run mcp-typescript-simple
```

## Project Structure

```
src/
  index.ts          # Main MCP server implementation
test/
  ci-test.ts        # Comprehensive CI/CD test suite
  test-mcp.ts       # MCP protocol and tool tests
  simple-test.ts    # Simple automated test suite
  interactive-client.ts # Interactive testing client
  test-interactive.ts # Interactive client tester
.github/workflows/
  ci.yml            # GitHub Actions CI/CD pipeline
build/              # Compiled TypeScript output
Dockerfile          # Container configuration
eslint.config.js    # ESLint configuration
package.json        # Dependencies and scripts
tsconfig.json       # TypeScript configuration
```

## Testing

### Testing Strategy

This project uses a comprehensive testing approach with multiple layers:

- **Unit Tests**: Individual component testing (`test/unit/`)
- **Integration Tests**: Component interaction testing (`test/integration/`)
- **System Tests**: End-to-end deployment validation (`test/system/`)

### System Testing
End-to-end system tests validate the complete deployed application. See [test/system/README.md](test/system/README.md) for detailed documentation.

```bash
# Run against local development server
npm run test:system:local

# Run against Docker container
npm run test:system:docker

# Run against Vercel preview deployment
npm run test:system:preview

# Run against production deployment
npm run test:system:production
```

System tests cover:
- **Health & Configuration**: Deployment validation and environment detection
- **Authentication**: OAuth provider configuration and security
- **MCP Protocol**: JSON-RPC compliance and tool discovery
- **Tool Functionality**: Basic tools and LLM integration testing

### CI/CD Testing (Regression Testing)
**Primary command for GitHub Actions and automated testing:**

```bash
# Complete regression test suite - USE THIS FOR CI/CD
npm run test:ci

# Alternative: Full validation including build
npm run validate
```

The `test:ci` command runs:
- TypeScript compilation
- Type checking
- Code linting
- MCP server startup validation
- MCP protocol compliance
- All tool functionality tests
- Error handling verification
- Docker build test (if Docker available)

### Development Testing

Unit tests live under `test/unit/` (mirroring `src/**` paths, e.g. `test/unit/config/environment.test.ts`) and feed `npm run test:unit`; integration suites live under `test/integration/` and are exercised by `npm run test:integration`.

```bash
# Individual test commands
npm run test:mcp        # MCP-specific functionality tests
npm run test:interactive # Interactive client testing
npm run typecheck       # TypeScript type validation
npm run lint           # Code quality checks
npm run build          # Compilation test
```

### Manual Testing

#### Automated MCP Testing
```bash
# Run MCP protocol and tool tests
npx tsx tools/manual/test-mcp.ts
```

#### Interactive Testing

##### Local STDIO Client
Launch an interactive client to test tools locally:

```bash
# Start interactive MCP client (STDIO mode)
npx tsx tools/interactive-client.ts
```

##### Remote HTTP Client
Connect to remote MCP servers using Bearer token authentication:

```bash
# Basic usage
npx tsx tools/remote-http-client.ts --url http://localhost:3000/mcp --token your-bearer-token

# With verbose logging
npx tsx tools/remote-http-client.ts --url http://localhost:3000/mcp --token your-token --verbose

# Debug mode with full request/response logging
npx tsx tools/remote-http-client.ts --url http://localhost:3000/mcp --token your-token --debug

# Non-interactive mode (for scripting)
npx tsx tools/remote-http-client.ts --url http://localhost:3000/mcp --token your-token --no-interactive
```

**Remote HTTP Client Features:**
- 🔐 Bearer token authentication (bypasses OAuth flows)
- 📊 Comprehensive logging with multiple debug levels
- 🔍 Error analysis with debugging hints and categorization
- 🛠️ Interactive tool discovery and execution
- ⏱️ Request/response correlation and timing
- 🔒 Secure token display (automatic masking)
- 📡 Full MCP protocol compliance
- 🌐 Works with any remote HTTP MCP server

##### Interactive Commands (Both Clients)
- `help` - Show available commands and discovered tools
- `list` - List all available tools dynamically
- `describe <tool>` - Show detailed tool information with parameters
- `<tool-name> <args>` - Call any discovered tool directly
- `call <tool> <json-args>` - Call tools with JSON arguments
- `raw <json>` - Send raw JSON-RPC requests
- `debug [on|off]` - Toggle debug logging (HTTP client only)
- `quit` - Exit the client

The interactive client dynamically discovers all available MCP tools and provides context-aware help and parameter guidance.

#### MCP Inspector (Web UI)
For advanced testing with a graphical interface:

```bash
# Install MCP Inspector
npm install -g @modelcontextprotocol/inspector

# Launch with web interface
mcp-inspector npx tsx src/index.ts
```

### Developer Testing Tools

For manual testing and development workflows, several utility scripts are available in the `tools/` directory:

#### OAuth Testing
```bash
# Test OAuth flow interactively
node tools/test-oauth.js --flow

# Test server health
node tools/test-oauth.js

# Test with existing token
node tools/test-oauth.js --token <your_token>
```

#### Vercel Development Testing
```bash
# Start official Vercel development server
npm run dev:vercel

# Test MCP protocol compliance
npm run test:mcp
```

These tools help with:
- **OAuth Flow Validation**: Test authentication flows with real providers
- **Local Vercel Testing**: Mock Vercel environment for development
- **API Function Testing**: Direct testing of serverless functions
- **MCP Protocol Debugging**: Low-level MCP endpoint testing

### GitHub Actions CI/CD
The project includes a complete CI/CD pipeline in `.github/workflows/ci.yml`:

- **Node.js 22 Testing**: Standardized on current LTS
- **Regression Testing**: Runs `npm run test:ci` on every push/PR
- **Docker Validation**: Builds and tests Docker image
- **Deployment Ready**: Provides deployment checkpoint

**Pipeline triggers:**
- Push to `main` or `develop` branches
- Pull requests to `main`

## MCP Tools Reference

### Basic Tools

#### hello
Greets a person by name.
- **Input**: `name` (string, required)
- **Output**: Greeting message

#### echo
Echoes back the provided message.
- **Input**: `message` (string, required)
- **Output**: Echo of the input message

#### current-time
Returns the current timestamp.
- **Input**: None
- **Output**: ISO timestamp string

### LLM-Powered Tools

> **Type-Safe Provider & Model Selection**: All LLM tools support optional `provider` and `model` parameters for fine-grained control over which AI model to use.

#### chat
Interactive AI assistant with flexible provider and model selection.
- **Input**:
  - `message` (string, required): Your message to the AI
  - `system_prompt` (string, optional): Custom system instructions
  - `temperature` (number, optional): Creativity level 0-2 (default: 0.7)
  - `provider` (enum, optional): 'claude' | 'openai' | 'gemini' (default: 'claude')
  - `model` (string, optional): Specific model to use (must be valid for provider)
- **Output**: AI response
- **Default**: Claude Haiku (optimized for speed)
- **Examples**:
  - `claude-3-haiku-20240307`, `claude-3-sonnet-20240229`
  - `gpt-4`, `gpt-4o`, `gpt-4o-mini`
  - `gemini-1.5-flash`, `gemini-1.5-pro`

#### analyze
Deep text analysis with configurable AI models.
- **Input**:
  - `text` (string, required): Text to analyze
  - `analysis_type` (enum, optional): 'sentiment', 'themes', 'structure', 'comprehensive', 'summary'
  - `focus` (string, optional): Specific aspect to focus on
  - `provider` (enum, optional): 'claude' | 'openai' | 'gemini' (default: 'openai')
  - `model` (string, optional): Specific model to use
- **Output**: Detailed analysis based on type
- **Default**: OpenAI GPT-4 (optimized for reasoning)

#### summarize
Text summarization with cost-effective model options.
- **Input**:
  - `text` (string, required): Text to summarize
  - `length` (enum, optional): 'brief', 'medium', 'detailed'
  - `format` (enum, optional): 'paragraph', 'bullets', 'outline'
  - `focus` (string, optional): Specific aspect to focus on
  - `provider` (enum, optional): 'claude' | 'openai' | 'gemini' (default: 'gemini')
  - `model` (string, optional): Specific model to use
- **Output**: Formatted summary
- **Default**: Gemini Flash (optimized for cost and speed)

#### explain
Educational explanations with adaptive AI models.
- **Input**:
  - `topic` (string, required): Topic, concept, or code to explain
  - `level` (enum, optional): 'beginner', 'intermediate', 'advanced'
  - `context` (string, optional): Additional context or domain
  - `include_examples` (boolean, optional): Include examples (default: true)
  - `provider` (enum, optional): 'claude' | 'openai' | 'gemini' (default: 'claude')
  - `model` (string, optional): Specific model to use
- **Output**: Clear explanation adapted to level
- **Default**: Claude Sonnet (optimized for clarity and detail)

## Architecture

### Type-Safe Multi-LLM Strategy
- **Flexible Provider Selection**: Choose between Claude, OpenAI, and Gemini at runtime
- **Model-Specific Optimization**: Each provider supports multiple models with different capabilities
- **Intelligent Defaults**: Each tool has an optimized default provider/model combination
- **Automatic Fallback**: Graceful degradation if providers unavailable
- **Type Safety**: Compile-time validation prevents invalid provider/model combinations

### Available Models by Provider

#### Claude (Anthropic)
- **claude-3-haiku-20240307**: Fast, cost-effective responses
- **claude-3-sonnet-20240229**: Balanced performance and capability
- **claude-3-opus-20240229**: Highest capability for complex tasks

#### OpenAI
- **gpt-3.5-turbo**: Fast, cost-effective general purpose
- **gpt-4**: High capability reasoning and analysis
- **gpt-4-turbo**: Enhanced performance with larger context
- **gpt-4o**: Optimized multimodal capabilities
- **gpt-4o-mini**: Efficient version of GPT-4o

#### Google Gemini
- **gemini-1.5-flash**: Fast, cost-effective processing
- **gemini-1.5-pro**: High capability with large context
- **gemini-1.0-pro**: Standard performance model

### Usage Examples

#### Basic Usage (Uses Tool Defaults)
```json
{
  "name": "chat",
  "arguments": {
    "message": "Hello, how are you?"
  }
}
```

#### Override Provider Only
```json
{
  "name": "analyze",
  "arguments": {
    "text": "Sample text to analyze",
    "provider": "claude"
  }
}
```

#### Override Both Provider and Model
```json
{
  "name": "chat",
  "arguments": {
    "message": "Complex question requiring deep reasoning",
    "provider": "openai",
    "model": "gpt-4"
  }
}
```

### Secret Management
- **Tiered Approach**: Environment variables → File-based (.env) → Fallback
- **Runtime Detection**: Automatically detects available providers
- **Secure Defaults**: No hardcoded secrets, graceful failure modes
- **Multi-Provider Support**: Works with any combination of available API keys

## Deployment Options

### Vercel Serverless Deployment

Deploy the MCP server as Vercel serverless functions with full streaming support.

#### Features
- **Serverless Functions**: Auto-scaling serverless endpoints
- **Streamable HTTP**: Full MCP streaming protocol support
- **Multi-Provider OAuth**: Google, GitHub, Microsoft authentication
- **Built-in Monitoring**: Health checks, metrics, and request logging
- **Global CDN**: Vercel's edge network for optimal performance

#### Available Endpoints
- `/api/mcp` - MCP protocol endpoint
- `/api/health` - Health and status checks
- `/api/auth` - OAuth authentication flows
- `/api/admin` - Metrics and administration

#### Documentation
- 🚀 **[Quick Start](./docs/vercel-quickstart.md)** - 5-minute deployment
- 📖 **[Complete Deployment Guide](./docs/vercel-deployment.md)** - Detailed deployment instructions
- 🛠️ **[Local Development](./docs/vercel-local-development.md)** - Develop and test locally with Vercel

### Traditional Deployment

For traditional server deployment, use the standard Node.js build:

```bash
npm run build
npm start
```
