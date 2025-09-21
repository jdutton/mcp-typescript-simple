# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
This is a production-ready TypeScript-based MCP (Model Context Protocol) server featuring:
- **Dual-mode operation**: STDIO (traditional) + Streamable HTTP with OAuth
- **Multi-LLM integration**: Claude, OpenAI, and Gemini with type-safe provider selection
- **Vercel serverless deployment**: Ready for production deployment as serverless functions
- **Comprehensive testing**: Full CI/CD pipeline with protocol compliance testing

## Development Commands

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Development modes
npm run dev              # STDIO mode (recommended for MCP development)
npm run dev:sse          # Streamable HTTP mode (no auth)
npm run dev:oauth        # Streamable HTTP mode (with OAuth)
npm run dev:vercel       # Vercel local development server

# Testing
npm test                 # Jest unit tests
npm run test:ci          # Comprehensive CI/CD test suite
npm run test:mcp         # MCP protocol and tool tests
npm run test:interactive # Interactive MCP client
npm run test:dual-mode   # Dual-mode functionality test
npm run validate         # Complete validation (typecheck + lint + build + test)

# Code quality
npm run lint             # ESLint code checking
npm run typecheck        # TypeScript type checking

# Development Deployment (Preview Only)
npm run build            # Build for deployment
npm run dev:vercel       # Local Vercel development server
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

## Deployment Options

### Local Development
```bash
npm run dev              # STDIO mode for MCP clients
npm run dev:sse          # HTTP mode without authentication
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

## Development Workflow

### **MANDATORY Steps for ANY Code Change**
**Every commit must follow this process - no exceptions:**

1. **Create feature branch** (never work on main)
2. **Make your changes**
3. **Run `npm run validate`** (MANDATORY - must pass)
4. **Commit and push** (creates or updates PR)
5. **Ensure all CI checks pass**

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

#### Commit and Push Workflow
```bash
# 1. Stage your changes
git add <files>

# 2. Commit with descriptive message
git commit -m "descriptive message

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"

# 3. Push to feature branch (creates or updates PR)
git status              # Quick check - any other modifications?
git push origin <your-branch-name>
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

#### Documentation Updates (Required)
**Update README.md for:**
- **New Features**: Add feature description, usage examples, configuration options
- **New Tools**: Update tool list with descriptions and parameters
- **Configuration Changes**: Update environment variables, setup instructions
- **Deployment Changes**: Update deployment options and requirements
- **Breaking Changes**: Update prerequisites, migration guides, compatibility notes

#### Documentation Validation Checklist
- [ ] README.md reflects all new features and changes
- [ ] Code examples are current and functional
- [ ] Prerequisites and dependencies are accurate
- [ ] Installation and setup instructions work
- [ ] Environment variable documentation is complete
- [ ] Tool descriptions match actual implementation
- [ ] Links to detailed documentation are correct

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
- ✅ `test/ci-test.ts` - Automated CI/CD validation
- ✅ `test/test-mcp.ts` - Automated MCP protocol testing
- ✅ `tools/test-oauth.js` - Interactive OAuth flow testing (requires browser)
- ✅ `tools/test-vercel-local.ts` - Manual Vercel mock server
- ✅ `tools/test-api-direct.ts` - Manual API function debugging

### Development Workflow Convention:
- **Automated testing**: Always use `test/` directory and `npm test` commands
- **Manual testing/debugging**: Use `tools/` directory and direct script execution
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