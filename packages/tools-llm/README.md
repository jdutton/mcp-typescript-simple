# @mcp-typescript-simple/tools-llm

**LLM Tool Infrastructure** - Core infrastructure for building LLM-powered MCP tools

## Purpose

This package provides the LLM infrastructure for building LLM-powered MCP tools:

- **LLMManager**: Multi-provider LLM client management (Claude, OpenAI, Gemini)
- **Type-safe provider interfaces**: Full TypeScript support for all providers
- **Configuration management**: Environment-based configuration
- **Provider abstraction**: Unified interface across different LLM providers

⚠️ **Note**: This package contains infrastructure only. For example tool implementations, see `@mcp-typescript-simple/example-tools-llm`.

## Components

### LLMManager

Central manager for LLM provider clients:

```typescript
import { LLMManager } from '@mcp-typescript-simple/tools-llm';

const llmManager = new LLMManager();
await llmManager.initialize();

// Make LLM requests
const response = await llmManager.complete({
  message: 'Explain quantum computing',
  provider: 'claude',
  model: 'claude-3-5-sonnet-20241022'
});
```

### Supported Providers

- **Claude** (Anthropic): `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`
- **OpenAI**: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`
- **Gemini** (Google): `gemini-1.5-pro`, `gemini-1.5-flash`, `gemini-2.0-flash-exp`

## Configuration

Set API keys via environment variables:

```bash
# Claude (Anthropic)
export ANTHROPIC_API_KEY=your_key_here

# OpenAI
export OPENAI_API_KEY=your_key_here

# Gemini (Google)
export GOOGLE_API_KEY=your_key_here
```

The LLM manager will automatically detect available providers based on configured API keys.

## Building LLM Tools

This package provides the infrastructure. To build actual LLM-powered tools:

```typescript
import { defineTool } from '@mcp-typescript-simple/tools';
import { LLMManager } from '@mcp-typescript-simple/tools-llm';
import { z } from 'zod';

// Initialize LLM manager
const llmManager = new LLMManager();
await llmManager.initialize();

// Define LLM-powered tool
const myLLMTool = defineTool({
  name: 'my-llm-tool',
  description: 'Does something with LLM',
  inputSchema: z.object({
    prompt: z.string()
  }),
  handler: async ({ prompt }) => {
    const response = await llmManager.complete({
      message: prompt,
      provider: 'claude'
    });

    return {
      content: [{ type: 'text', text: response.content }]
    };
  }
});
```

See `@mcp-typescript-simple/example-tools-llm` for complete examples.

## Dependencies

- `@mcp-typescript-simple/tools` - Core tool system
- `@anthropic-ai/sdk` - Claude API client
- `openai` - OpenAI API client
- `@google/generative-ai` - Gemini API client

## License

MIT
