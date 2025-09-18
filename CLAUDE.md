# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
This is a TypeScript-based MCP (Model Context Protocol) server project. MCP servers provide tools and resources that can be used by MCP clients.

## Development Commands
Since this is a new project, the following commands will be needed once initialized:

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run in development mode
npm run dev

# Run tests
npm test

# Lint code
npm run lint

# Type checking
npm run typecheck
```

## Project Architecture
MCP servers typically follow this structure:

- `src/index.ts` - Main server entry point and MCP server setup
- `src/tools/` - Tool implementations (functions exposed to MCP clients)
- `src/resources/` - Resource implementations (data sources)
- `src/types/` - TypeScript type definitions
- `build/` - Compiled JavaScript output
- `package.json` - Dependencies and scripts

## MCP-Specific Patterns
- Use the `@modelcontextprotocol/sdk` package for server implementation
- Tools should be defined with proper schemas for input validation
- Resources should implement proper URI handling
- All async operations should be properly awaited
- Error handling should follow MCP protocol standards

## TypeScript Configuration
- Use strict TypeScript configuration
- Enable `noImplicitAny`, `strictNullChecks`, and other strict options
- Target ES2020 or later for modern JavaScript features
- Use `"moduleResolution": "node"` for proper module resolution

## Testing Strategy
- Unit tests for individual tools and resources
- Integration tests for MCP server functionality
- Mock external dependencies in tests
- Use Jest or similar testing framework

## Key Dependencies
- `@modelcontextprotocol/sdk` - Core MCP SDK
- `typescript` - TypeScript compiler
- `@types/node` - Node.js type definitions