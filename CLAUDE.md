# CLAUDE.md

This file provides focused guidance to Claude Code when working with this repository.

## Project Overview
Production-ready TypeScript MCP (Model Context Protocol) server featuring:
- **Dual-mode operation**: STDIO + Streamable HTTP with OAuth
- **Multi-LLM integration**: Claude, OpenAI, Gemini with type-safe provider selection
- **Monorepo structure**: 14 npm packages (`@mcp-typescript-simple/*`)
- **Comprehensive testing**: Full CI/CD pipeline with Vitest (181/294 tests passing, migration in progress)
- **Horizontal scalability**: Redis-based session management
- **OpenTelemetry observability**: Structured logging, metrics, and tracing

## Critical Project Constraints

**NEVER:**
- ❌ Use dotenv - use Node.js `--env-file` or `--env-file-if-exists` flags instead
- ❌ Use Vercel KV (`@vercel/kv`) - use standard Redis with `ioredis` + `REDIS_URL` environment variable
- ❌ Work directly on `main` branch - always create feature branches
- ❌ Commit without running `npm run pre-commit` first
- ❌ Log PII (personally identifiable information) - session IDs are safe
- ❌ Make API/URL changes without updating `openapi.yaml` FIRST (spec-driven development)
- ❌ Skip adding tests for new features or bug fixes

**ALWAYS:**
- ✅ Create feature branch before starting work (`feature/`, `fix/`, `docs/`, `refactor/`)
- ✅ Run `npm run pre-commit` before every commit (MANDATORY)
- ✅ Include tests for all new features and bug fixes
- ✅ Update documentation when changing APIs or behavior
- ✅ Update `openapi.yaml` before implementing API changes

## Essential Commands

### Development
```bash
npm install              # Install dependencies
npm run build            # Build all packages

# Development modes (auto-recompile on file changes)
npm run dev:stdio        # STDIO mode (traditional MCP)
npm run dev:http         # HTTP mode (no auth)
npm run dev:oauth        # HTTP mode (with OAuth)
npm run dev:otel         # HTTP mode (with observability)
```

### Testing & Validation
```bash
npm run pre-commit       # MANDATORY before every commit (sync + validate)
npm run validate         # Full validation pipeline (~90s first run, ~288ms cached)
npm test                 # Vitest unit tests
npm run test:ci          # Complete CI test suite
npm run lint             # ESLint checking
npm run typecheck        # TypeScript checking
```

### Workflow Commands
```bash
npm run sync-check       # Check if branch is behind origin/main
npx vibe-validate watch-pr  # Watch PR CI checks in real-time
npm run post-pr-merge-cleanup  # Clean up after PR merge
```

### Publishing (see docs/npm-publication-strategy.md)
```bash
npm run pre-publish      # Validate before publishing
npm run publish:all      # Publish all packages to npm
```

**See `package.json` scripts for complete command list.**

## Quick Development Workflow

### Starting New Work
1. Create feature branch: `git checkout -b feature/my-feature`
2. Make changes and add tests
3. Run validation: `npm run pre-commit` (MANDATORY)
4. Commit and push: `git add . && git commit -m "feat: description"`
5. Create PR: `gh pr create`
6. Monitor PR: `npx vibe-validate watch-pr`

### Testing Requirements
- **New features**: MUST include unit tests
- **Bug fixes**: MUST include regression tests
- **API changes**: MUST update `openapi.yaml` first, then add tests
- Run full validation before committing: `npm run pre-commit`

**See docs/testing-guidelines.md for comprehensive testing guidance.**

## Publishing to npm

### Quick Publishing Workflow
```bash
# 1. Update CHANGELOG.md with release notes
# 2. Validate and publish
npm run pre-publish      # Validates everything
npm run build            # Build all packages
npm run publish:all      # Publish to npm in dependency order
```

### Version Management
```bash
npm run bump-version 0.9.0  # Set specific version
npm run version:patch       # Bump patch (0.9.0 → 0.9.1)
npm run version:minor       # Bump minor (0.9.0 → 0.10.0)
npm run version:major       # Bump major (0.9.0 → 1.0.0)
```

**See docs/npm-publication-strategy.md for complete publishing documentation.**

## Project Architecture

### Monorepo Packages
- `@mcp-typescript-simple/config` - Environment configuration
- `@mcp-typescript-simple/observability` - Logging, metrics, tracing
- `@mcp-typescript-simple/persistence` - Redis-based data storage
- `@mcp-typescript-simple/tools` - Basic MCP tools
- `@mcp-typescript-simple/tools-llm` - LLM-powered tools
- `@mcp-typescript-simple/auth` - OAuth authentication
- `@mcp-typescript-simple/server` - MCP server core
- `@mcp-typescript-simple/http-server` - HTTP transport
- `@mcp-typescript-simple/adapter-vercel` - Vercel serverless adapter

### Key Directories
- `src/` - Main server application code
- `packages/` - Workspace packages (npm publishable)
- `test/` - Automated tests (unit, integration, system)
- `tools/` - Manual development utilities
- `docs/` - Architecture and deployment documentation
- `api/` - Vercel serverless functions

## API Documentation (Spec-Driven Development)

**CRITICAL**: Always update `openapi.yaml` FIRST before making API changes.

```bash
npm run docs:validate    # Validate OpenAPI spec (REQUIRED before commit)
npm run docs:preview     # Preview docs locally
```

**Documentation endpoints** (when server running):
- `/docs` - Redoc documentation
- `/api-docs` - Swagger UI (interactive testing)
- `/openapi.yaml` - OpenAPI specification

## Environment Configuration

### OAuth Providers (Optional)
Configure one or more: Google, GitHub, Microsoft
- See `.env.oauth.example` for local development
- See `.env.oauth.docker.example` for Docker deployment

### LLM Providers (Optional)
- `ANTHROPIC_API_KEY` - Claude models
- `OPENAI_API_KEY` - GPT models
- `GOOGLE_API_KEY` - Gemini models

### Redis (Required for Production)
- `REDIS_URL` - Standard Redis connection (use ioredis, NOT Vercel KV)
- `REDIS_KEY_PREFIX` - Key prefix for multi-tenancy (default: `mcp`)
  - Run multiple MCP servers on same Redis instance without key conflicts
  - Example values: `mcp-dev`, `mcp-staging`, `mcp-prod`, `mcp-server-1`
  - Trailing colon added automatically (e.g., `mcp-dev` → `mcp-dev:`)

**See `.env.example` for complete environment variable documentation.**

## Key Project Features

### OAuth Integration
- Dynamic Client Registration (DCR) per RFC 7591
- OAuth Client State Preservation for managed flows (Claude Code, MCP Inspector)
- Multi-provider support (Google, GitHub, Microsoft)
- PKCE support (RFC 7636)

**Quick start**: `npm run dev:oauth` then `claude mcp add http://localhost:3000`

**See docs/oauth-setup.md for detailed OAuth configuration.**

### Session Management & Scalability
- Redis-based session persistence (`REDIS_URL`)
- Horizontal scalability across multiple server instances
- Session reconstruction on-demand from Redis

**See docs/session-management.md for deployment architecture.**

### Self-Healing Port Management
Tests automatically clean up leaked processes before starting:
```bash
npm run dev:clean    # Manual cleanup if needed
```

**See test/helpers/test-setup.ts for implementation details.**

## vibe-validate Integration

This project uses [vibe-validate](https://github.com/jdutton-vercel/vibe-validate) for validation orchestration with git tree hash-based state caching.

### Performance
- **Full validation**: ~90 seconds (9 validation steps across 2 parallel phases)
- **Cached validation**: ~288ms (312x speedup when code unchanged!)

### Key Commands
```bash
npx vibe-validate validate       # Run validation
npx vibe-validate validate --check  # Check validation status
npx vibe-validate state          # View detailed validation state
npx vibe-validate pre-commit     # Pre-commit workflow (sync + validate)
npx vibe-validate watch-pr       # Watch PR CI checks in real-time
```

**When validation fails:**
1. Check status: `npx vibe-validate validate --check`
2. View errors: `npx vibe-validate state`
3. Fix errors and re-run: `npx vibe-validate validate`


## Scaffolding New MCP Servers

Create production-ready MCP servers with the scaffolding tool:

```bash
npm create @mcp-typescript-simple@latest my-server
```

**Features included:**
- Full-featured by default (OAuth, LLM, Docker, Redis)
- Graceful degradation (works without API keys)
- Complete test suite (unit + system tests)
- Validation pipeline (vibe-validate)
- Tool Registry Pattern for HTTP session reconstruction

**See packages/create-mcp-typescript-simple/README.md for details.**

## Additional Documentation

### Architecture & Design
- **docs/session-management.md** - Session persistence and horizontal scalability
- **docs/oauth-setup.md** - OAuth configuration and client integration
- **docs/adr/** - Architecture Decision Records

### Development Guides
- **docs/testing-guidelines.md** - Comprehensive testing guidance
- **docs/vitest-migration.md** - Vitest migration status (181/294 tests passing)
- **docs/npm-publication-strategy.md** - Publishing workflow and best practices
- **docs/vercel-deployment.md** - Vercel serverless deployment

### SDLC Tooling
- **docs/agentic-workflow-extraction.md** - SDLC automation tooling (extracted to vibe-validate)
- **docs/pre-commit-hook.md** - Pre-commit workflow integration

## Key Dependencies

- `@modelcontextprotocol/sdk` - Core MCP SDK (v1.18.0)
- `@anthropic-ai/sdk` - Claude AI integration
- `openai` - OpenAI GPT integration
- `@google/generative-ai` - Gemini AI integration
- `express` - HTTP server
- `ioredis` - Redis client (NOT @vercel/kv)
- `vitest` - Fast test runner with native TypeScript/ESM support
- `@vibe-validate/*` - Validation orchestration with state caching

## Project Status

- **Version**: 0.9.2
- **Status**: Release Candidate (pre-1.0.0)
- **Test Coverage**: 181/294 tests passing (Vitest migration in progress)
- **npm Organization**: `@mcp-typescript-simple/*` (14 packages)
- **Production Ready**: Yes (deployed to Vercel: https://mcp-typescript-simple.vercel.app)

## Common Issues & Troubleshooting

### Validation Failures
```bash
npx vibe-validate state          # View detailed errors
npx vibe-validate validate --force  # Force re-validation
```

### Port Conflicts
```bash
npm run dev:clean                # Clean up leaked test processes
lsof -ti:3000 | xargs kill -9   # Manual port cleanup
```

### Redis Connection Issues
- Verify `REDIS_URL` environment variable is set
- Use `ioredis` client, NOT `@vercel/kv` package
- Check Redis server is running: `redis-cli ping`

### OAuth Errors
- Verify provider credentials in `.env.oauth`
- Check redirect URIs match provider configuration
- See docs/oauth-setup.md for detailed troubleshooting

## Getting Help

- **GitHub Issues**: https://github.com/jdutton-vercel/mcp-typescript-simple/issues
- **Discussions**: https://github.com/jdutton-vercel/mcp-typescript-simple/discussions
- **MCP Documentation**: https://modelcontextprotocol.io
