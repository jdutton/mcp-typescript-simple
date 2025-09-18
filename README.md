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

# Run in development mode
npm run dev

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
build/              # Compiled TypeScript output
Dockerfile          # Container configuration
package.json        # Dependencies and scripts
tsconfig.json       # TypeScript configuration
```

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