# MCP TypeScript Simple

A simple MCP (Model Context Protocol) server built with TypeScript featuring basic Hello World tools.

## Current State

This project provides a containerized MCP server with three basic tools:

- **hello**: Greets a person by name
- **echo**: Echoes back a provided message
- **current-time**: Returns the current timestamp

## Prerequisites

- Node.js 20+
- Docker (via Colima on macOS)

## Development

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

- **Multi-Node Testing**: Tests on Node.js 18.x and 20.x
- **Regression Testing**: Runs `npm run test:ci` on every push/PR
- **Docker Validation**: Builds and tests Docker image
- **Deployment Ready**: Provides deployment checkpoint

**Pipeline triggers:**
- Push to `main` or `develop` branches
- Pull requests to `main`

## MCP Tools

### hello
Greets a person by name.
- **Input**: `name` (string, required)
- **Output**: Greeting message

### echo
Echoes back the provided message.
- **Input**: `message` (string, required)
- **Output**: Echo of the input message

### current-time
Returns the current timestamp.
- **Input**: None
- **Output**: ISO timestamp string