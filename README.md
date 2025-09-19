# MCP TypeScript Simple

A production-ready MCP (Model Context Protocol) server built with TypeScript featuring both basic tools and advanced LLM-powered capabilities with **type-safe provider and model selection**.

## Key Features

### 🔒 **Type-Safe LLM Integration**
- **Provider Selection**: Choose between Claude, OpenAI, and Gemini with compile-time validation
- **Model Selection**: Select specific models per provider with type safety
- **Intelligent Defaults**: Each tool optimized for specific provider/model combinations
- **Runtime Flexibility**: Override provider/model per request
- **Backward Compatibility**: Existing code continues to work unchanged

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

# Run in development mode (recommended)
npm run dev

# Alternative: Run directly with npx
npx tsx src/index.ts

# Build the project
npm run build

# Run built version
npm start

# Type checking
npm run typecheck

# Linting
npm run lint
```

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
npx tsx test/test-mcp.ts
```

#### Interactive Testing
Launch an interactive client to manually test tools:

```bash
# Start interactive MCP client
npx tsx test/interactive-client.ts
```

Interactive commands:
- `help` - Show available commands and discovered tools
- `list` - List all available tools dynamically
- `describe <tool>` - Show detailed tool information with parameters
- `<tool-name> <args>` - Call any discovered tool directly
- `call <tool> <json-args>` - Call tools with JSON arguments
- `raw <json>` - Send raw JSON-RPC requests
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