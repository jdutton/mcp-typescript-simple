# MCP TypeScript Simple

A simple, production-ready MCP server that demonstrates how to build Model Context Protocol servers in TypeScript. Use it as an example, reference implementation, or framework for your own MCP projects.

**[View Source on GitHub](https://github.com/jdutton/mcp-typescript-simple)** | **[API Documentation](/docs)**

## What is this?

This project shows you how to build production-quality MCP servers with:
- **Dual Transport Support**: STDIO (for desktop clients) + Streamable HTTP (for web/cloud)
- **Multi-LLM Integration**: Claude, OpenAI, and Gemini with type-safe APIs
- **OAuth Authentication**: Support for Google, GitHub, and Microsoft, or extend with your own
- **Production Ready**: Deploy to Vercel or Docker/K8s with full OTEL observability
- **Comprehensive Testing**: Full test coverage with CI/CD validation

## Try It Out Now

### Connect from Claude Code

```bash
claude mcp add https://mcp-typescript-simple.vercel.app/mcp
```

### Connect from Claude Desktop

Add this to your Claude Desktop `claude_desktop_config.json` configuration file:

```json
{
  "mcpServers": {
    "typescript-simple": {
      "command": "npx",
      "args": ["-y", "@mcp-typescript-simple/example-mcp"]
    }
  }
}
```

### Connect from MCP Inspector

Test the hosted example server:
```bash
npx @modelcontextprotocol/inspector
```

Then in the UI, add: `https://mcp-typescript-simple.vercel.app/mcp`

Or test stdio mode:
```bash
npx @modelcontextprotocol/inspector npx -y @mcp-typescript-simple/example-mcp
```

## Available Tools

This server provides several example tools to demonstrate MCP capabilities:

### Basic Tools (Simple, non-LLM tools for testing)
- **current-time** - Get current timestamp
- **hello** - Greet users by name
- **echo** - Echo back messages

### AI-Powered Tools (Require LLM API Keys Configured)
- **chat** - Interactive AI assistant with multi-provider support
- **analyze** - Deep text analysis
- **summarize** - Text summarization
- **explain** - Educational explanations

## Documentation

- **[API Reference](/docs)** - Complete API documentation with interactive examples
- **[OpenAPI Specification](/openapi.yaml)** - Machine-readable API spec
- **[GitHub Repository](https://github.com/jdutton/mcp-typescript-simple)** - Source code, developer guides, and examples
- **[Report Issues](https://github.com/jdutton/mcp-typescript-simple/issues)** - Bug reports and feature requests

## For Developers

Want to build your own MCP server, see the example code, or contribute? Check out the [GitHub repository](https://github.com/jdutton/mcp-typescript-simple) for:
- Complete TypeScript source code with comprehensive examples
- Step-by-step developer documentation
- Testing and validation guides
- Deployment instructions for Vercel, Docker, and more
- Modular package architecture you can reuse

## License

MIT License - see [LICENSE](https://github.com/jdutton/mcp-typescript-simple/blob/main/LICENSE) for details.
