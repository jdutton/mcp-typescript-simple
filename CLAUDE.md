# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
This is a production-ready TypeScript-based MCP (Model Context Protocol) server featuring:
- **Dual-mode operation**: STDIO (traditional) + Streamable HTTP with OAuth
- **Multi-LLM integration**: Claude, OpenAI, and Gemini with type-safe provider selection
- **OAuth Dynamic Client Registration (DCR)**: RFC 7591 compliant automatic client registration
- **Vercel serverless deployment**: Ready for production deployment as serverless functions
- **Comprehensive testing**: Full CI/CD pipeline with protocol compliance testing
- **OpenTelemetry observability**: Structured logging, metrics, and tracing with security-first design
- **Environment Configuration**: Never use dotenv - use Node.js --env-file or --env-file-if-exists flags instead
- **Redis Storage**: NEVER use Vercel KV (@vercel/kv package) - use standard Redis with ioredis + REDIS_URL environment variable

## Development Commands

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Development modes
npm run dev:stdio        # STDIO mode (recommended for MCP development)
npm run dev:http         # Streamable HTTP mode (no auth)
npm run dev:oauth        # Streamable HTTP mode (with OAuth)
npm run dev:vercel       # Vercel local development server

# Testing (Vitest-powered - fast, native TypeScript support)
npm test                 # Vitest unit tests (test/unit/)
npm run test:unit        # Vitest unit tests with coverage
npm run test:integration # Integration tests (test/integration/)
npm run test:ci          # Comprehensive CI/CD test suite
npm run test:mcp         # MCP protocol testing (tools/manual/)
npm run test:interactive # Interactive MCP client (tools/)
npm run test:dual-mode   # Dual-mode functionality test
vitest                   # Watch mode (instant feedback on file changes)

# System Testing (test/system/)
npm run test:system:stdio    # STDIO transport mode system tests
npm run test:system:express  # Express HTTP server system tests
npm run test:system:ci       # Express HTTP server for CI testing (cross-origin)
npm run test:models          # Validate ALL LLM models with real API calls (requires API keys)

# Note: Vitest migration in progress (181/294 tests passing)
# See docs/vitest-migration.md for status and remaining work

npm run validate         # Complete validation (unit → integration → build)
                         # Skips validation if already passed for current worktree
npm run validate -- --force  # Force re-validation even if already passed

# Code quality
npm run lint             # ESLint code checking
npm run typecheck        # TypeScript type checking

# API Documentation
npm run docs:validate    # Validate OpenAPI specification
npm run docs:preview     # Preview docs locally with Redocly
npm run docs:build       # Build static Redoc HTML
npm run docs:bundle      # Bundle OpenAPI spec to JSON

# Branch management and PR workflow
npm run sync-check              # Check if branch is behind origin/main (safe, no auto-merge)
npm run pre-commit              # Complete pre-commit workflow (sync check + validation)
npm run post-pr-merge-cleanup   # Clean up merged branches after PR merge (switches to main, deletes merged branches)

# Development Data Management
npm run dev:clean               # Clean all file-based data stores
npm run dev:clean:sessions      # Clean only MCP session metadata
npm run dev:clean:tokens        # Clean only access tokens
npm run dev:clean:oauth         # Clean only OAuth clients

# Observability and Development Monitoring
npm run otel:start              # Start Grafana OTEL-LGTM stack (port 3200)
npm run otel:stop               # Stop observability stack
npm run otel:ui                 # Open Grafana dashboard (http://localhost:3200)
npm run dev:with-otel           # Start MCP server with observability
npm run otel:test               # Send test telemetry data
npm run otel:validate           # Validate OTEL setup and connectivity

# Production Deployment Testing
npm run build                    # Build for deployment

# Docker (CI-only validation)
# Local: docker run --rm -it mcp-typescript-simple (auto-rebuilds) or npm run docker:dev (always builds fresh)
# CI: .github/workflows/docker.yml validates Docker builds on PRs (separate from npm run validate)

# Vercel deployment (Preview Only)
npm run dev:vercel               # Local Vercel development server
```

### Progressive Production Fidelity

Test with increasing production-like fidelity:

1. **Development (TypeScript)**: `npm run dev:oauth` - Fast iteration with tsx
2. **Docker Container**: `npm run docker:dev` - Containerized deployment
3. **Vercel Serverless**: Production serverless (GitHub Actions only)

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
├── test/                        # Automated test suite (unit/integration tests)
│   ├── helpers/                # Shared test utilities
│   │   ├── port-utils.ts      # Self-healing port management
│   │   ├── test-setup.ts      # Automatic test environment setup
│   │   └── process-utils.ts   # Process group cleanup
│   ├── unit/                  # Unit tests
│   ├── integration/           # Integration tests
│   └── system/                # System tests
├── tools/                       # Manual development and testing utilities
├── docs/                        # Deployment and architecture documentation
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

## API Documentation

This project includes comprehensive OpenAPI 3.1 specification and interactive documentation:

### Available Documentation Endpoints

When running the server locally or in production, access documentation at:

- **`/docs`** - Beautiful read-focused documentation (Redoc)
- **`/api-docs`** - Interactive API testing interface (Swagger UI)
- **`/openapi.yaml`** - OpenAPI specification in YAML format
- **`/openapi.json`** - OpenAPI specification in JSON format

### Documentation Workflow

#### Spec-Driven Development (CRITICAL)
**ALWAYS update `openapi.yaml` FIRST before making any URL/API changes.** The OpenAPI spec is the authoritative API contract - update the spec, then implement the code to match it.

#### When to Update Documentation

Update `openapi.yaml` whenever you:
- Add new API endpoints
- Change request/response schemas
- Modify authentication requirements
- Update error responses
- Add new query parameters or headers
- Change endpoint behavior

#### Validation and Testing

Always validate documentation changes:

```bash
# Validate OpenAPI specification (REQUIRED before commit)
npm run docs:validate

# Preview documentation locally
npm run docs:preview

# Run documentation validation tests
npm test -- test/unit/docs/openapi-validation.test.ts
```

#### Documentation Maintenance Guidelines

1. **Keep openapi.yaml in sync** - Update immediately when changing endpoints
2. **Include examples** - Add request/response examples for all endpoints
3. **Document errors** - Include all possible error responses with examples
4. **Reference RFCs** - Link to relevant specifications (OAuth, MCP, etc.)
5. **Test before commit** - Run `npm run docs:validate` as part of `npm run validate`

#### OpenAPI Specification Structure

The `openapi.yaml` file includes:
- **Health & Status** - Server health check endpoints
- **MCP Protocol** - JSON-RPC 2.0 endpoints for MCP tool invocation
- **OAuth Authentication** - Complete OAuth 2.0 authorization code flow
- **OAuth Discovery** - RFC 8414/9728 metadata endpoints
- **Dynamic Client Registration** - RFC 7591/7592 client management
- **Admin & Monitoring** - Session management and metrics

#### Swagger UI Features

Interactive API documentation at `/api-docs` includes:
- **Try it out** - Test endpoints directly from browser
- **OAuth 2.0 testing** - Complete OAuth flow integration
- **Request/response validation** - Real-time schema validation
- **Persistent authorization** - Stays logged in across page refreshes

## Deployment Options

### Local Development
```bash
npm run dev:stdio        # STDIO mode for MCP clients
npm run dev:http         # HTTP mode without authentication
npm run dev:oauth        # HTTP mode with OAuth
```

### Vercel Deployment Workflow

#### Development/Preview Deployment (PR Testing)
```bash
# Build and deploy to preview environment for testing
npm run build
vercel                    # Deploys to preview URL for testing

# Local testing
npm run dev:vercel        # Local Vercel development server
```

#### Production Deployment (Automated via GitHub Actions)
**IMPORTANT**: Production deployments happen automatically via GitHub Actions when PRs are merged to main.

**Deployment Workflow:**
1. PR is merged to `main` branch
2. GitHub Actions runs validation pipeline (`.github/workflows/validate.yml`)
3. If all validation checks pass, Vercel deployment workflow runs (`.github/workflows/vercel.yml`)
4. Code is deployed to Vercel production: https://mcp-typescript-simple.vercel.app
5. Health check verifies deployment success

**Required GitHub Secrets:**
The repository must have these secrets configured for automated Vercel deployments:
- `VERCEL_TOKEN` - Vercel authentication token (get from: https://vercel.com/account/tokens)
- `VERCEL_ORG_ID` - Vercel organization/team ID (found in project settings)
- `VERCEL_PROJECT_ID` - Vercel project ID (found in project settings)
- `TOKEN_ENCRYPTION_KEY` - 32-byte base64 encryption key for Redis (generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)

**Note**: `TOKEN_ENCRYPTION_KEY` must also be added as a Vercel environment variable. See docs/vercel-deployment.md for detailed instructions.

To configure secrets: Repository Settings → Secrets and variables → Actions → New repository secret

**Deployment Guidelines:**
- **Claude Code should NEVER manually deploy to production**
- **Only GitHub Actions deploys to production after all CI checks pass**
- **Preview deployments are for testing during PR development only**

#### Vercel Deployment Critical Behavior
**CRITICAL**: Vercel deploys from git commits only - local file changes are ignored until committed and pushed.

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
Configure one or more OAuth providers. The server will detect all configured providers and present them as login options:

**Google OAuth:**
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` (optional, auto-generated if not set)
- `GOOGLE_SCOPES` (optional, defaults to: openid,email,profile)

**GitHub OAuth:**
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_REDIRECT_URI` (optional, auto-generated if not set)
- `GITHUB_SCOPES` (optional, defaults to: read:user,user:email)

**Microsoft OAuth:**
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_TENANT_ID` (optional, defaults to: common)
- `MICROSOFT_REDIRECT_URI` (optional, auto-generated if not set)
- `MICROSOFT_SCOPES` (optional, defaults to: openid,email,profile)

### Environment File Conventions

**Local Development:**
- **`.env.oauth`** - OAuth configuration for local TypeScript development
  - Used by `npm run dev:oauth` (runs on `localhost:3000`)
  - Contains OAuth redirect URIs for `localhost:3000` (direct server)
  - Multi-provider support (Google, GitHub, Microsoft)

**Docker Deployment:**
- **`.env.oauth.docker`** - Docker-specific OAuth configuration (NEVER committed to git)
  - EXCLUSIVELY used by `docker-compose.yml` for multi-node load-balanced testing
  - Contains OAuth redirect URIs for `localhost:8080` (nginx load balancer)
  - **Optional** - if not present, Docker runs without OAuth (`MCP_DEV_SKIP_AUTH=true`)
  - To enable OAuth: create `.env.oauth.docker` and set `MCP_DEV_SKIP_AUTH=false`
  - Multi-provider support (Google, GitHub, Microsoft)

**Why separate files?**
- Local development (`npm run dev:oauth`) uses port 3000 → requires `.env.oauth`
- Docker Compose uses nginx on port 8080 → requires `.env.oauth.docker`
- Different OAuth redirect URIs for each deployment method
- Both files covered by `.env.oauth*` in .gitignore (never committed)

## OAuth Client Integration

### Connecting Claude Code to This MCP Server

The MCP server supports **managed OAuth flows** for agentic clients like Claude Code and MCP Inspector through:

1. **Dynamic Client Registration (DCR)**: Automatic OAuth client registration per RFC 7591
2. **OAuth Client State Preservation**: CSRF-safe state parameter handling for OAuth clients
3. **PKCE Support**: Full Proof Key for Code Exchange (RFC 7636) implementation

#### Connection Steps for Claude Code

1. **Start the MCP server with OAuth**:
   ```bash
   npm run dev:oauth    # Development mode with OAuth (uses .env.oauth)
   ```

2. **Register with Claude Code**:
   ```bash
   # In a separate directory (not this project):
   claude mcp add http://localhost:3000
   ```

3. **OAuth Flow**:
   - Claude Code initiates OAuth flow automatically
   - Browser opens for authentication with Google/GitHub/Microsoft
   - Server preserves Claude Code's state parameter for CSRF protection
   - Authentication completes seamlessly

4. **Verify Connection**:
   - Claude Code shows available tools: `hello`, `echo`, `current-time`, etc.
   - Server logs show successful OAuth session creation

#### OAuth Client State Preservation

**CRITICAL**: The server implements OAuth client state preservation to support managed OAuth flows.

**Why this matters:**
- OAuth clients (Claude Code, MCP Inspector) send their own `state` parameter for CSRF protection
- The MCP server acts as an OAuth intermediary between the client and the provider
- Server must return the client's original state, not its own internal state

**How it works:**
```
Claude Code → MCP Server → Google OAuth
  state=abc123    state=xyz789
  (stored in session)

Google → MCP Server → Claude Code
         state=xyz789   state=abc123  ✅ CORRECT!
```

**Implementation:**
- Automatic detection of client-managed vs server-managed OAuth flows
- Full backward compatibility with traditional OAuth
- Works with all providers (Google, GitHub, Microsoft, generic)

**Documentation:**
- Technical details: `docs/oauth-setup.md` (OAuth Client State Preservation section)
- Architecture decision: `docs/adr/002-oauth-client-state-preservation.md`
- Testing: `test/unit/auth/providers/base-provider.test.ts` (lines 282-402)

#### Supported OAuth Clients

- **Claude Code**: Anthropic's AI assistant with managed OAuth
- **MCP Inspector**: Development tool for testing MCP servers (`http://localhost:6274`)
- **Custom Clients**: Any OAuth client following RFC 6749/RFC 9449 (OAuth 2.1)

#### Troubleshooting

**"Invalid state parameter" error:**
- Fixed in current implementation via OAuth client state preservation
- Enable debug logging: `export NODE_ENV=development`
- Check logs for: `[oauth:debug] Returning client original state`

**Connection issues:**
- Verify server is running: `curl http://localhost:3000/health`
- Check OAuth discovery: `curl http://localhost:3000/.well-known/oauth-authorization-server`
- Verify provider credentials in `.env` file

## Horizontal Scalability and Session Management

**Session persistence with Redis**: MCP sessions are stored in Redis when `REDIS_URL` is configured, enabling horizontal scalability across multiple server instances.

**How it works:**
- Session metadata stored in Redis (persistent, shared across instances)
- Server instances cached in memory (reconstructed on-demand from Redis)
- Any server instance can handle any session (load-balanced deployments)

**For comprehensive deployment architecture and scaling patterns, see [docs/session-management.md](docs/session-management.md)**

## Self-Healing Port Management

**NEW**: Automated port cleanup system eliminates manual intervention when tests fail or are interrupted.

### How It Works

Tests automatically clean up leaked processes from previous runs before starting:

```typescript
import { setupTestEnvironment } from '../helpers/test-setup.js';

describe('My System Tests', () => {
  let cleanup: TestEnvironmentCleanup;

  beforeAll(async () => {
    // Automatically cleans up any leaked test processes on these ports
    cleanup = await setupTestEnvironment({
      ports: [3000, 3001, 6274],
    });
  });

  afterAll(async () => {
    await cleanup();
  });
});
```

### Safety Features

The system only kills processes identified as test-related:
- ✅ **Safe to kill**: tsx, node, vitest, playwright, npm, npx, mcp
- ✅ **Checks for "test" or "dev" in command**
- ❌ **Never kills**: postgres, redis, mysql, nginx, docker, systemd

### Benefits

- **No manual cleanup needed**: Ports are automatically freed before tests
- **Safe by default**: Conservative process identification prevents accidents
- **Resilient to interruption**: Handles Ctrl+C and failed test runs
- **Clear logging**: Shows what was cleaned up and why

### Manual Port Cleanup (if needed)

If you need to manually clean up leaked ports:

```bash
# Check what's using a port
lsof -ti:3000

# Kill processes on specific ports
lsof -ti:3000,3001 | xargs -r kill -9

# Or use the automated cleanup
npm run dev:clean
```

## Testing Strategy

This project requires **comprehensive test coverage** for all features and bug fixes. When developing new features or fixing bugs, you MUST add corresponding tests.

**📚 For comprehensive testing guidance, see [docs/testing-guidelines.md](docs/testing-guidelines.md)**

### Test Coverage Requirements
- **New Features**: MUST include unit tests validating the feature works correctly
- **Bug Fixes**: MUST include regression tests that would have caught the bug
- **API Changes**: MUST include tests for all new endpoints, parameters, or behaviors
- **Configuration Changes**: MUST include validation tests for new config options
- **Integration Points**: MUST test interactions between components

### Test Categories

#### Core MCP Testing
- **CI/CD Pipeline**: Comprehensive automated testing via GitHub Actions
- **Protocol Compliance**: Full MCP specification validation
- **Tool Functionality**: Individual and integration tool testing
- **Dual-Mode Testing**: Both STDIO and HTTP transport validation
- **Interactive Testing**: Manual testing client with tool discovery

#### Deployment Testing
- **Vercel Configuration**: `npm run test:vercel-config` - validates serverless deployment setup
- **Transport Layer**: `npm run test:transport` - validates HTTP/streaming transport functionality
- **Docker Build**: Validates containerization works correctly
- **Multi-Environment**: Tests across Node.js versions and deployment targets

#### Integration Testing
- **End-to-End**: Full MCP client-server communication validation
- **Error Scenarios**: Tests error handling and edge cases
- **Performance**: Validates response times and resource usage
- **Security**: Tests authentication and authorization flows

### Test Implementation Guidelines

#### When Adding a New Feature
1. **Write tests FIRST** (TDD approach preferred)
2. **Test the happy path** - normal operation
3. **Test edge cases** - boundary conditions, invalid inputs
4. **Test error scenarios** - what happens when things go wrong
5. **Test integration points** - how it works with other components

#### When Fixing a Bug
1. **Write a test that reproduces the bug** (should fail initially)
2. **Fix the bug**
3. **Verify the test now passes**
4. **Add additional edge case tests** to prevent similar bugs

#### Test Coverage Validation
```bash
# Run before committing ANY changes
npm run validate           # Complete validation pipeline
npm run test:ci           # Full CI test suite
npm run test:vercel-config # Vercel deployment validation
npm run test:transport    # Transport layer validation
```

#### Required Test Coverage Areas
- **New Tools**: Must test tool registration, schema validation, execution, and error handling
- **New Transports**: Must test connection, message handling, streaming, and cleanup
- **New Authentication**: Must test login, logout, token refresh, and security
- **New Configuration**: Must test parsing, validation, and environment handling
- **New Integrations**: Must test initialization, communication, and error scenarios

### CI Pipeline Validation
The CI pipeline includes 10 comprehensive test categories:
1. TypeScript Compilation
2. Type Checking
3. Code Linting
4. **Vercel Configuration** (deployment readiness)
5. **Transport Layer** (communication protocols)
6. MCP Server Startup
7. MCP Protocol Compliance
8. Tool Functionality
9. Error Handling
10. Docker Build

**ALL tests must pass** before code can be merged. No exceptions.

## Validation Error Handling

**When `npm run validate` fails:**
1. Check validation status: `npx vibe-validate validate --check`
2. View detailed errors: `npx vibe-validate state`
3. Fix the errors listed in the output
4. Re-run validation: `npx vibe-validate validate`

## Security Requirements

**CRITICAL**: Never log PII at source. Session IDs (UUIDs) are safe - they contain no personal data.

## Development Workflow

### **MANDATORY Steps for ANY Code Change**
**Every commit must follow this process - no exceptions:**

1. **Create feature branch** (never work on main)
2. **Make your changes**
3. **Run `npx vibe-validate pre-commit`** (MANDATORY - validates + syncs with main)
4. **Commit and push** (creates or updates PR)
5. **Monitor PR status**: `npx vibe-validate watch-pr` (auto-detects PR, watches until complete)
6. **Fix immediately** if any checks fail, then resume monitoring

### Branch Management Requirements
**CRITICAL**: All changes MUST be made on feature branches, never directly on `main`.

#### Creating Feature Branches
1. **Always branch from main**: `git checkout main && git pull origin main`
2. **Create descriptive branch name**:
   - `feature/add-new-tool` - for new features
   - `fix/oauth-redirect-bug` - for bug fixes
   - `docs/update-architecture` - for documentation
   - `refactor/cleanup-transport` - for refactoring
3. **If branch topic is unclear**: ASK the user for clarification before proceeding

#### Pull Request Workflow
- **No direct pushes to main** - ALL changes must go through pull requests
- **Branch naming convention**: `type/brief-description` (feature/fix/docs/refactor)
- **Pull request must include**: Tests, documentation updates, and validation
- **All CI checks must pass** before merge approval

#### Example Branch Creation:
```bash
git checkout main
git pull origin main
git checkout -b feature/add-redis-caching
# Make changes, commit, push, create PR
```

### Before Starting Any Work
1. **Create appropriate feature branch** - never work directly on main
2. **Understand the requirement** - feature or bug fix
3. **Identify test coverage gaps** - what tests are missing?
4. **Plan your testing approach** - what tests will you add?

### During Development
1. **Write tests first** (TDD) or **alongside code**
2. **Run tests frequently** with `npm run test:ci`
3. **Verify test coverage** for your changes
4. **Test edge cases and error scenarios**

### Testing with Preview Deployments (Optional)
**For testing deployment functionality during development:**

```bash
# Only if deployment testing is needed
npm run build              # Build the project
vercel                     # Deploy to preview URL (NOT production)
```

**When to use preview deployments:**
- Testing serverless function behavior
- Validating environment variable configuration
- Testing with real HTTP requests and OAuth flows
- **NEVER for production** - only for development/testing

### Committing Changes (New Commits and PR Updates)
**CRITICAL**: These steps are MANDATORY for ALL commits - initial commits and PR updates:

#### Pre-Commit Validation (REQUIRED)
```bash
# MANDATORY validation - NEVER skip this step
npm run validate

# If validation fails, fix ALL issues before proceeding
# Ensure all new changes have corresponding tests
# Update documentation if needed
```

#### Pre-Commit Workflow
**MANDATORY**: Use the automated pre-commit checker before pushing:

```bash
npm run pre-commit
```

**If branch sync is needed:**
```bash
git merge origin/main      # Resolve conflicts manually
npm run pre-commit         # Continue with validation
```

#### Commit and Push Workflow

**Step 1: Validate (MANDATORY)**
```bash
npm run pre-commit      # MUST pass before proceeding
```

**Step 2: Stage Changes**
```bash
git add <files>
```

**Step 3: Ask Permission (MANDATORY)**
**CRITICAL**: Claude Code MUST ask user permission before committing:
- Ask: "Ready to commit these changes?"
- Only proceed if user explicitly grants permission
- NEVER auto-commit, even after successful pre-commit validation

**Step 4: Commit (Only After Permission)**
```bash
git commit -m "descriptive message

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

**Step 5: Push (Only After Commit Permission)**
```bash
git push origin <branch-name>
```

#### Commit Requirements
- **MANDATORY validation MUST pass** before any commit/push
- **All CI checks MUST pass** after push
- **New functionality MUST include tests**
- **Bug fixes MUST include regression tests**
- **Documentation MUST be updated** for any API/feature changes
- **No exceptions** - failed validation = no commit allowed

### Creating Initial Pull Request
```bash
# After first push, create PR via GitHub CLI or web interface
gh pr create --title "Brief description" --body "Detailed description"

# Or use GitHub web interface
```

#### Pull Request Requirements
- **Title**: Clear, concise description of changes
- **Description**:
  - What was changed and why
  - Testing approach and coverage
  - Any breaking changes or migration notes
- **All CI checks must pass**
- **Documentation must be updated**
- **Tests must be included for all changes**

### Quality Requirements for All Changes

#### Documentation Requirements
**MANDATORY**: All documentation must show **current state only**. Never include status updates, progress indicators, or temporary information in any README.md files, docs/ directory, or .md files.

**When updating documentation:**
- Update for new features, tools, configuration, or deployment changes
- Ensure code examples work and dependencies are accurate
- Keep tool descriptions matching actual implementation

#### Work-in-Progress Tracking
**Use TODO.md for local PR/task tracking - to track progress, blockers and next steps ** - it's git-ignored and won't be committed, it's just for locally persisted TODO state

### Examples of Required Tests

#### Adding a New MCP Tool
```typescript
// Must test:
// 1. Tool registration and schema validation
// 2. Successful execution with valid parameters
// 3. Error handling with invalid parameters
// 4. Integration with LLM providers (if applicable)
// 5. Response format validation
```

#### Fixing a Transport Bug
```typescript
// Must test:
// 1. Reproduce the original bug (test should fail before fix)
// 2. Verify fix resolves the issue
// 3. Test similar scenarios that might have same bug
// 4. Test error conditions and edge cases
// 5. Integration with both STDIO and HTTP transports
```

#### Adding New Configuration Options
```typescript
// Must test:
// 1. Configuration parsing and validation
// 2. Default value handling
// 3. Invalid configuration error handling
// 4. Environment variable precedence
// 5. Integration with existing systems
```

### Test Quality Standards
- **Tests must be deterministic** (no flaky tests)
- **Tests must be isolated** (no dependencies between tests)
- **Tests must be fast** (unit tests < 100ms each)
- **Tests must be readable** (clear test names and structure)
- **Tests must cover real usage scenarios**

## Directory Structure Guidelines

### `test/` - Automated Tests Only
- **Unit tests**: Testing individual functions and components
- **Integration tests**: Testing component interactions
- **CI/CD tests**: Automated regression testing
- **Protocol compliance tests**: MCP specification validation
- **Must be non-interactive** and suitable for automated execution

### `tools/` - Manual Development Utilities
- **Interactive testing scripts**: Require user input or interaction
- **Development servers**: Long-running processes for manual testing
- **OAuth flow testing**: Browser-based authentication testing
- **API debugging tools**: Direct function testing and inspection
- **Local development helpers**: Mock servers, direct API calls
- **Manual validation tools**: Scripts requiring human verification

### Examples of `tools/` vs `test/` Classification:
- ✅ `test/unit/auth/factory.test.ts` - Unit tests for auth factory
- ✅ `test/integration/ci-test.ts` - Automated CI/CD validation
- ✅ `tools/manual/test-mcp.ts` - Manual MCP protocol testing
- ✅ `tools/test-oauth.ts` - Interactive OAuth flow testing (requires browser)

### Development Workflow Convention:
- **Unit testing**: Use `test/unit/` directory and `npm run test:unit` command
- **Integration testing**: Use `test/integration/` directory and `npm run test:integration` command
- **Manual testing/debugging**: Use `tools/` and `tools/manual/` directories for direct script execution
- **Documentation**: Reference `tools/` scripts in development guides
- **CI/CD**: Only `test/` directory files should be run by automated pipelines

## Key Dependencies
- `@modelcontextprotocol/sdk` - Core MCP SDK (v1.18.0)
- `@anthropic-ai/sdk` - Claude AI integration
- `openai` - OpenAI GPT integration
- `@google/generative-ai` - Gemini AI integration
- `express` - HTTP server for Streamable HTTP transport
- `@vercel/node` - Vercel serverless function support
- `typescript` - TypeScript compiler with strict configuration
- `vitest` - Fast test runner with native TypeScript/ESM support (migrating from Jest)
- Always run CI tests locally before pushing to PR to ensure PR tests will pass
- DO NOT ask to commit any code unless you have first run 'npm run validate' on the changes successfully

## SDLC Automation Tooling

This project includes custom-built, **agent-friendly SDLC automation tools** designed to reduce probabilistic decision-making for AI assistants and speed up development workflows.

### Tools Overview

#### `npm run sync-check` - Smart Branch Sync Checker
Safely checks if branch is behind origin/main without auto-merging.

**When to use:**
- Before starting new work
- Before creating commits
- To verify branch is up to date

**Exit codes:**
- `0`: Up to date or no remote
- `1`: Needs merge (stop and merge manually)
- `2`: Error condition

#### `npm run pre-commit` - Pre-Commit Workflow
Combined branch sync + validation with smart state caching.

**What it does:**
1. Checks branch sync → Stops if behind origin/main
2. Checks validation state → Skips if code unchanged
3. Runs fast checks (typecheck + lint) if state valid
4. Runs full validation if state invalid or missing

**When to use:**
- **MANDATORY before every commit**
- Before pushing to GitHub
- To verify code quality

#### `npm run post-pr-merge-cleanup` - Post-PR Cleanup
Cleans workspace after PR merge.

**What it does:**
1. Switches to main branch
2. Syncs main with GitHub origin
3. Deletes only confirmed-merged branches
4. Provides cleanup summary

**When to use:**
- After PR is merged and closed
- To clean up local workspace
- To prepare for next PR

#### `npm run validate` - Full Validation with State Caching
Runs complete validation pipeline with git tree hash state caching.

**Features:**
- Caches results based on git tree hash (includes all changes)
- Skips validation if code unchanged (massive time savings)
- Check status with: `npx vibe-validate validate --check`
- View errors with: `npx vibe-validate state`
- Use `--force` flag to bypass cache

**Validation steps:**
1. TypeScript type checking
2. ESLint code checking
3. Unit tests (Vitest)
4. Build
5. OpenAPI validation
6. Integration tests
7. STDIO system tests
8. HTTP system tests
9. Headless browser tests

### Checking Validation Status

Use these commands to check validation status:

**Quick status check:**
```bash
npx vibe-validate validate --check
# Exit codes: 0 (passed), 1 (failed), 2 (no state), 3 (outdated)
```

**Detailed validation state:**
```bash
npx vibe-validate state
# Returns JSON with: passed, timestamp, treeHash, phases, steps
```


### Why These Tools Exist

**Problem**: AI agents need deterministic, cacheable workflows that don't require probabilistic "should I run this?" decisions.

**Solution**: Custom tooling that:
1. **Uses git tree hashing** for validation state caching
2. **Never auto-merges** - always requires explicit manual action
3. **Provides clear exit codes** for agent decision-making
4. **Embeds error output** in YAML for easy agent consumption
5. **Detects agent context** (Claude Code vs manual) and adapts output

### Agent Context Detection

Tools automatically detect when running in Claude Code or other agents and adapt output:
- **Human mode**: Colorful, verbose output with examples
- **Agent mode**: Structured YAML/JSON output with embedded errors

### Extraction Strategy

Based on architecture research (issue #68), this tooling is **novel and valuable** enough to warrant extraction as an open-source tool: **`@agentic-workflow`**

**See full extraction plan:** `docs/agentic-workflow-extraction.md`

**Competitive advantages:**
- Only tool using git tree hash for validation state caching
- Only tool designed agent-first (not human-first)
- Only tool with safety-first branch management
- Only tool with integrated pre-commit workflow

**Target users:**
- AI agent platforms (Claude Code, Cursor, Aider, Continue)
- Development teams adopting AI pair programming
- Individual developers using AI assistants

### Integration Examples

**Claude Code** (you're using this now!):
```bash
npm run pre-commit   # Claude Code detects context, uses agent-friendly output
```

**CI/CD**:
```yaml
# .github/workflows/ci.yml
- name: Validation with Caching
  run: npm run validate
```

**Pre-commit Hook**:
```bash
# .husky/pre-commit
npm run pre-commit
```

### References

- **Vitest Migration**: `docs/vitest-migration.md`
- **Extraction Strategy**: `docs/agentic-workflow-extraction.md`
- **Pre-commit Hook**: `docs/pre-commit-hook.md`
- **Architecture Research**: Issue #68 (chief-arch agent output)
- **Source Code**: `tools/` directory

## Validation with vibe-validate

**NEW (2025-10-16)**: This project now uses [vibe-validate](https://github.com/jdutton-vercel/vibe-validate) for validation orchestration!

### What is vibe-validate?

vibe-validate is a **language-agnostic validation orchestration tool** with:
- **Git tree hash-based validation state caching** (312x speedup on repeat runs!)
- **Agent-friendly error output** optimized for AI assistants like Claude Code
- **Parallel phase execution** for fast validation
- **Pre-commit workflow integration** with automatic branch sync checking
- **TypeScript/JavaScript presets** for common project types

### Why we switched

The SDLC automation tools in this project (`tools/run-validation-with-state.ts`, `tools/sync-check.ts`, etc.) were **extracted into vibe-validate** as a standalone npm package. We're now using the published package instead of the local scripts.

### Installation

This project uses vibe-validate from npm registry:

```bash
npm install -D @vibe-validate/cli @vibe-validate/config @vibe-validate/core @vibe-validate/formatters @vibe-validate/git
```

### Available Commands

```bash
# Show configuration
npx vibe-validate config

# Run full validation (~90s first run)
npx vibe-validate validate

# Run cached validation (~288ms if unchanged)
npx vibe-validate validate

# Check validation state
npx vibe-validate state

# Pre-commit workflow (branch sync + cached validation)
npx vibe-validate pre-commit

# Check if branch is behind origin/main
npx vibe-validate sync-check

# Post-PR merge cleanup
npx vibe-validate cleanup

# RECOMMENDED: Watch PR CI checks in real-time (replaces gh pr checks --watch)
npx vibe-validate watch-pr              # Auto-detect PR from current branch
npx vibe-validate watch-pr 88           # Watch specific PR number
npx vibe-validate watch-pr --fail-fast  # Exit on first failure
```

### Configuration

The validation configuration is in `vibe-validate.config.mjs` (root directory):

- **Preset**: `typescript-nodejs` (optimized for Node.js applications)
- **2 Parallel Phases**:
  - Phase 1: Pre-Qualification + Build (typecheck, lint, OpenAPI validation, build)
  - Phase 2: Testing (unit, integration, STDIO, HTTP, headless browser tests)
- **Caching**: Git tree hash-based (deterministic, content-based)
- **Fail Fast**: Disabled (runs all steps even if one fails, for complete error reporting)

### Performance

**Validation Caching Performance:**
- **Full validation**: ~90 seconds (9 validation steps across 2 parallel phases)
- **Cached validation**: 288ms (git tree hash calculation + state file read)
- **Speedup**: **312x** when code hasn't changed!

### Workflow Integration

**Pre-commit workflow** (`npm run pre-commit` / `npx vibe-validate pre-commit`):
1. Checks branch sync with origin/main
2. Calculates git tree hash of current working tree
3. If hash matches cached state → skip validation (288ms)
4. If hash differs → run full validation (~90s)
5. Cache new state for next run

**When to use:**
- **MANDATORY before every commit** (already integrated in package.json scripts)
- Before pushing to GitHub
- When switching branches or pulling changes

### Migration Status

**Completed:**
- ✅ Installed all 5 vibe-validate packages (@vibe-validate/cli, config, core, formatters, git)
- ✅ Created `vibe-validate.config.mjs` with project-specific configuration
- ✅ Updated package.json scripts to use vibe-validate commands
- ✅ Tested all commands successfully
- ✅ Validated caching performance (312x speedup!)
- ✅ Switched to published npm version
- ✅ CI/CD using published vibe-validate

### Related Documentation

For vibe-validate development and contribution:
- **vibe-validate/CONTRIBUTING.md** - Local development setup
- **vibe-validate/docs/local-development.md** - Multi-mode development workflow
- **vibe-validate/README.md** - User-facing documentation

### Troubleshooting

**Q**: Validation is slow (90s every time)
**A**: Caching might not be working. Check:
1. Check validation status: `npx vibe-validate validate --check`
2. Ensure working tree is clean: `git status`
3. View validation state: `npx vibe-validate state`
4. Try force re-validation: `npx vibe-validate validate --force`

**Q**: How do I check if validation passed?
**A**: `npx vibe-validate validate --check` (returns exit code 0 if passed)

**Q**: How do I see validation errors?
**A**: `npx vibe-validate state` (returns JSON with all error details)

**Q**: How do I force re-validation?
**A**: `npx vibe-validate validate --force` (bypasses cache)

**Q**: Validation fails but old tooling passed
**A**: vibe-validate runs steps in parallel phases - may expose race conditions or timing issues. Check test isolation.