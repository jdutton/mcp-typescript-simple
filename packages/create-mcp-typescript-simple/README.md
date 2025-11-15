# create-mcp-typescript-simple

Scaffolding tool for creating production-ready MCP (Model Context Protocol) servers with TypeScript.

## Quick Start

```bash
# Create a new MCP server
npm create @mcp-typescript-simple@latest my-mcp-server

# Follow the interactive prompts to select features
cd my-mcp-server
npm run dev:stdio
```

## Features

This scaffolding tool generates a **production-ready** MCP server with:

- ✅ **LLM Integration** - Optional Claude, OpenAI, and Gemini support
- ✅ **OAuth Authentication** - Optional Google, GitHub, Microsoft OAuth
- ✅ **Docker Deployment** - nginx + Redis + multi-replica setup
- ✅ **Vercel Serverless** - Optional Vercel deployment with serverless functions
- ✅ **Unique Encryption Key** - Auto-generated TOKEN_ENCRYPTION_KEY for security
- ✅ **Validation Pipeline** - Pre-configured vibe-validate with 2-phase validation
- ✅ **Testing Setup** - Vitest configuration and example tests
- ✅ **CI/CD Ready** - GitHub Actions workflows (optional)

## Usage

### Interactive Mode (Recommended)

```bash
npm create @mcp-typescript-simple@latest my-mcp-server
```

The tool will prompt you for:
- **Project name** - Your MCP server name (kebab-case)
- **Description** - Brief description of your server
- **Author** - Your name (auto-detected from git config)
- **LLM providers** - Select: Claude, OpenAI, Gemini (multi-select)
- **OAuth providers** - Select: Google, GitHub, Microsoft (multi-select)
- **Vercel deployment** - Include Vercel serverless functions? (yes/no)
- **Git initialization** - Initialize git repository? (yes/no)
- **Install dependencies** - Run npm install now? (yes/no)

### Non-Interactive Mode

```bash
# Minimal setup
npm create @mcp-typescript-simple@latest my-server -- --yes --minimal

# Full-featured setup
npm create @mcp-typescript-simple@latest my-server -- \\
  --yes \\
  --llm=claude,openai,gemini \\
  --oauth=google,github,microsoft \\
  --vercel \\
  --no-git \\
  --no-install
```

## Generated Project Structure

```
my-mcp-server/
├── package.json              # With conditional dependencies
├── tsconfig.json             # TypeScript configuration
├── .env.example              # With unique TOKEN_ENCRYPTION_KEY
├── .gitignore               # Comprehensive ignore patterns
├── README.md                # Getting started guide
├── CLAUDE.md                # Claude Code integration guide
├── vibe-validate.config.yaml # Validation configuration
├── src/
│   ├── index.ts            # Production-ready entry point
│   ├── tools/              # Tool registry and implementations
│   └── config.ts           # Environment configuration
├── test/
│   └── tools/              # Example tests
├── docker/                  # Docker deployment (optional)
│   ├── docker-compose.yml
│   ├── nginx.conf
│   └── Dockerfile
└── api/                     # Vercel serverless (optional)
    ├── mcp.ts
    ├── auth.ts
    └── health.ts
```

## Key Features

### Unique Encryption Key

Every scaffolded project gets a unique `TOKEN_ENCRYPTION_KEY` generated automatically:

```bash
# .env.example (generated)
TOKEN_ENCRYPTION_KEY="zJ8kL2mN4pQ6rS8tU0vW1xY3zA5bC7dE9fG1hI3jK5mL7nO9pQ=="
```

This key is used for secure token encryption in Redis-backed sessions. **Never commit this key to git!**

### Production-Ready by Default

Unlike simple "hello world" scaffolding tools, this generates a **production-ready** server:

- ✅ Proper tool registry passing for HTTP mode (avoids session reconstruction bugs)
- ✅ Environment configuration with validation
- ✅ OAuth with Dynamic Client Registration (DCR) support
- ✅ Horizontal scalability with Redis session storage
- ✅ Docker deployment with load balancing
- ✅ CI/CD validation pipeline
- ✅ Comprehensive error handling

### CLAUDE.md Integration

Every generated project includes a `CLAUDE.md` file with:
- Project-specific Claude Code guidance
- Common development tasks
- Critical HTTP mode requirements (tool registry parameter)
- Session management best practices
- Links to framework documentation

## Development Workflow

After scaffolding your project:

```bash
cd my-mcp-server

# 1. Configure environment (CRITICAL)
cp .env.example .env
# Edit .env and add your API keys

# 2. Start development
npm run dev:stdio        # STDIO mode (recommended for development)
npm run dev:http         # HTTP mode (skip auth - dev only)
npm run dev:oauth        # HTTP mode with OAuth (production-like)

# 3. Add your tools
# See src/tools/ directory and CLAUDE.md for guidance

# 4. Test
npm test                 # Run tests
npm run validate         # Full validation (REQUIRED before commit)

# 5. Deploy
docker-compose up        # Docker deployment
npm run dev:vercel       # Vercel local testing
```

## CLI Options

```
Usage: create-mcp-typescript-simple [project-name] [options]

Arguments:
  project-name                 Name of the project to create

Options:
  -y, --yes                    Skip prompts and use defaults
  --minimal                    Minimal setup (no OAuth, LLM, Vercel)
  --llm <providers>            LLM providers (claude,openai,gemini)
  --oauth <providers>          OAuth providers (google,github,microsoft)
  --vercel                     Include Vercel deployment
  --no-vercel                  Exclude Vercel deployment
  --git                        Initialize git repository (default)
  --no-git                     Skip git initialization
  --install                    Install dependencies (default)
  --no-install                 Skip npm install
  -h, --help                   Display help
  -v, --version                Display version
```

## Framework Dependencies

Scaffolded projects use these `@mcp-typescript-simple/*` packages:

### Minimal Dependencies
- `@mcp-typescript-simple/config` - Configuration management
- `@mcp-typescript-simple/observability` - Logging and telemetry
- `@mcp-typescript-simple/server` - MCP server core
- `@mcp-typescript-simple/tools` - Tool system
- `@mcp-typescript-simple/http-server` - HTTP transport

### Optional Dependencies
- `@mcp-typescript-simple/auth` - OAuth authentication (if --oauth selected)
- `@mcp-typescript-simple/tools-llm` - LLM infrastructure (if --llm selected)
- `@mcp-typescript-simple/adapter-vercel` - Vercel adapter (if --vercel selected)

## Examples

### Example 1: Minimal MCP Server

```bash
npm create @mcp-typescript-simple@latest hello-mcp -- --yes --minimal
cd hello-mcp
npm install
npm run dev:stdio
```

### Example 2: Full-Featured Production Server

```bash
npm create @mcp-typescript-simple@latest production-mcp -- \\
  --llm=claude,openai,gemini \\
  --oauth=google,github,microsoft \\
  --vercel
cd production-mcp
npm install
# Edit .env with your API keys
npm run dev:oauth
```

### Example 3: OAuth-Only Server

```bash
npm create @mcp-typescript-simple@latest oauth-mcp -- \\
  --oauth=google,github \\
  --no-vercel
cd oauth-mcp
npm install
npm run dev:oauth
```

## Troubleshooting

### "Package name must be lowercase"

Project names must follow npm naming conventions: lowercase, dashes/underscores only.

```bash
# ✅ Good
npm create @mcp-typescript-simple@latest my-mcp-server

# ❌ Bad
npm create @mcp-typescript-simple@latest MyMcpServer
```

### "TOKEN_ENCRYPTION_KEY not set"

After scaffolding, you must create `.env` from `.env.example`:

```bash
cp .env.example .env
```

The `.env.example` file already contains a unique encryption key for your project.

### "Tools vanish on session reconnection"

Make sure your `src/index.ts` passes the tool registry to transport initialization:

```typescript
await transportManager.initialize(server, tools);
                                          ^^^^^
                                     CRITICAL!
```

This is documented in the generated `CLAUDE.md` file.

## License

MIT

## Support

- 📚 Documentation: https://github.com/jdutton/mcp-typescript-simple/docs
- 🐛 Issues: https://github.com/jdutton/mcp-typescript-simple/issues
- 💬 Discussions: https://github.com/jdutton/mcp-typescript-simple/discussions
