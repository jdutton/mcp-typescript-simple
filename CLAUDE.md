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

# Testing
npm test                 # Jest unit tests (test/unit/)
npm run test:unit        # Jest unit tests with coverage
npm run test:integration # Integration tests (test/integration/)
npm run test:ci          # Comprehensive CI/CD test suite
npm run test:mcp         # MCP protocol testing (tools/manual/)
npm run test:interactive # Interactive MCP client (tools/)
npm run test:dual-mode   # Dual-mode functionality test

# System Testing (test/system/)
npm run test:system:stdio    # STDIO transport mode system tests
npm run test:system:express  # Express HTTP server system tests
npm run test:system:ci       # Express HTTP server for CI testing (cross-origin)
npm run test:models          # Validate ALL LLM models with real API calls (requires API keys)

npm run validate         # Complete validation (unit → integration → build)

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
npm run otel:start              # Start Grafana OTEL-LGTM stack (port 3100)
npm run otel:stop               # Stop observability stack
npm run otel:ui                 # Open Grafana dashboard (http://localhost:3100)
npm run dev:with-otel           # Start MCP server with observability
npm run otel:test               # Send test telemetry data
npm run otel:validate           # Validate OTEL setup and connectivity

# Production Deployment Testing
npm run build                    # Build for deployment

# Production mode (compiled JavaScript with OAuth)
npm run run:oauth:google         # Google OAuth
npm run run:oauth:github         # GitHub OAuth
npm run run:oauth:microsoft      # Microsoft OAuth

# Docker deployment
npm run run:docker:build         # Build Docker image
npm run run:docker:google        # Run Docker with Google OAuth
npm run run:docker:github        # Run Docker with GitHub OAuth
npm run run:docker:microsoft     # Run Docker with Microsoft OAuth

# Vercel deployment (Preview Only)
npm run dev:vercel               # Local Vercel development server
```

### Progressive Production Fidelity

Test with increasing production-like fidelity:

1. **Development (TypeScript)**: `npm run dev:oauth:google` - Fast iteration with tsx
2. **Production Build (JavaScript)**: `npm run run:oauth:google` - Compiled code with Node.js
3. **Docker Container**: `npm run run:docker:google` - Containerized deployment
4. **Vercel Serverless**: `npm run deploy:vercel` - Production serverless (GitHub Actions only)

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

#### Production Deployment (Automated Only)
**IMPORTANT**: Production deployments happen automatically via GitHub Actions when PRs are merged to main.

- **Claude Code should NEVER deploy to production**
- **Only GitHub Actions deploys to production after all CI checks pass**
- **Preview deployments are for testing during PR development**

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
- `OAUTH_PROVIDER` - google, github, microsoft, generic
- Provider-specific client ID/secret pairs

## OAuth Client Integration

### Connecting Claude Code to This MCP Server

The MCP server supports **managed OAuth flows** for agentic clients like Claude Code and MCP Inspector through:

1. **Dynamic Client Registration (DCR)**: Automatic OAuth client registration per RFC 7591
2. **OAuth Client State Preservation**: CSRF-safe state parameter handling for OAuth clients
3. **PKCE Support**: Full Proof Key for Code Exchange (RFC 7636) implementation

#### Connection Steps for Claude Code

1. **Start the MCP server with OAuth**:
   ```bash
   npm run dev:oauth:google    # Development mode with Google OAuth
   # OR
   npm run run:oauth:google    # Production mode with Google OAuth
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
   - Check active sessions: `curl http://localhost:3000/admin/sessions`

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

## Session State Management Limitations

**CRITICAL for Claude Code Development**: The StreamableHTTPServerTransport has important limitations:

- **In-memory only**: Session transports cannot be serialized or persisted to external storage
- **Single-instance**: Each server instance maintains its own session storage
- **Development impact**: When testing/debugging, restarting the server loses all active sessions

**For comprehensive deployment architecture and scaling patterns, see [docs/session-management.md](docs/session-management.md)**

## Testing Strategy

This project requires **comprehensive test coverage** for all features and bug fixes. When developing new features or fixing bugs, you MUST add corresponding tests.

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

## Security Requirements

**CRITICAL**: Never log PII at source. Session IDs (UUIDs) are safe - they contain no personal data.

## Development Workflow

### **MANDATORY Steps for ANY Code Change**
**Every commit must follow this process - no exceptions:**

1. **Create feature branch** (never work on main)
2. **Make your changes**
3. **Run `npm run validate`** (MANDATORY - must pass)
4. **Check if branch is up to date with origin/main** (MANDATORY - before pushing)
5. **Commit and push** (creates or updates PR)
6. **Monitor PR status** (every 15 seconds until all checks pass)
7. **Fix immediately** if any checks fail, then resume monitoring

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

#### Post-Push PR Monitoring (MANDATORY)
**After pushing changes to a PR, Claude Code MUST monitor the PR status:**

```bash
# Monitor PR status every 15 seconds for errors or success
gh pr checks <pr-number>

# Continue monitoring until either:
# 1. All checks pass (✅ SUCCESS - stop monitoring)
# 2. Any check fails (❌ ERROR - analyze and fix immediately)
```

**Monitoring Protocol:**
- **Check every 15 seconds** using `gh pr checks <pr-number>`
- **Stop monitoring when**: All checks are green/passing
- **Immediate action when**: Any check fails or shows error
- **Fix immediately**: Analyze the error, implement fix, test locally, push update
- **Resume monitoring**: After pushing fixes, continue monitoring until all green

**Example monitoring workflow:**
```bash
# Monitor until completion
while true; do
  gh pr checks 7
  # If all pass: break and stop monitoring
  # If any fail: analyze error, fix, commit, push, continue monitoring
  sleep 15
done
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
- Always run CI tests locally before pushing to PR to ensure PR tests will pass
