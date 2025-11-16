# Scaffolding Test Strategy

**Last Updated:** 2025-11-16
**Status:** Finalized for PR

## Executive Summary

This document defines which tests from the framework should be included in scaffolded projects created via `npm create @mcp-typescript-simple@latest`. The strategy balances **adopter onboarding** (minimize complexity) with **production readiness** (prove capabilities work).

### Key Principles

1. **Start Minimal, Scale Progressively** - Include only essential tests in scaffolds
2. **Graceful Degradation** - Tests pass without API keys/Redis/Docker
3. **Framework as Reference** - Point adopters to example-mcp for advanced patterns
4. **Prove Core Capabilities** - Validate MCP protocol, tools, and configuration

---

## Test Inventory Summary

### Framework Test Distribution

| Package | Unit Tests | Integration Tests | System Tests | Total |
|---------|-----------|------------------|--------------|-------|
| **example-mcp** | 0 | 17 | 15 | 32 |
| **auth** | 16 | 0 | 0 | 16 |
| **persistence** | 19 | 0 | 0 | 19 |
| **config** | 6 | 0 | 0 | 6 |
| **http-server** | 6 | 1 | 0 | 7 |
| **tools-llm** | 2 | 0 | 0 | 2 |
| **observability** | 4 | 1 | 0 | 5 |
| Other packages | 10 | 1 | 0 | 11 |
| **TOTAL** | **63** | **20** | **15** | **98** |

### Current Template Coverage

**Already included in scaffolds:**
- ✅ `test/unit/example.test.ts` - Placeholder unit test
- ✅ `test/system/mcp.system.test.ts` - Core MCP protocol validation (700 lines)
- ✅ `test/system/utils.js` - Test utilities and environment detection

**Total scaffolded tests:** 2 test files (~750 lines)

---

## Strategic Test Inclusion Decisions

### ✅ INCLUDED IN SCAFFOLDS (High Priority)

#### 1. System Tests - MCP Protocol Compliance

**File:** `test/system/mcp.system.test.ts` (template)
**Lines:** ~700
**Dependencies:** None (graceful degradation)

**What it tests:**
- MCP protocol initialization across STDIO and HTTP transports
- Tool discovery and schema validation
- Tool execution with valid/invalid parameters
- Error handling and edge cases
- Health endpoint availability

**Why include:**
- **Proves MCP server works** - Validates core protocol compliance
- **Transport agnostic** - Tests both STDIO and HTTP modes
- **No external dependencies** - Runs without API keys, Redis, or Docker
- **Graceful degradation** - Skips LLM tools if keys missing
- **Template pre-configured** - Uses basePort for port isolation

**Adopter value:** CRITICAL - This is the foundation that proves "my MCP server works"

---

#### 2. Unit Tests - Example Tool

**File:** `test/unit/example.test.ts` (template)
**Lines:** ~50
**Dependencies:** None

**What it tests:**
- Tool registration pattern
- Schema validation
- Basic tool metadata

**Why include:**
- **Shows testing pattern** - Template for adopters to replicate
- **Validates tooling works** - Ensures Vitest + TypeScript configured correctly
- **Quick feedback** - Fast unit test (<100ms)

**Adopter value:** HIGH - Pattern reference for testing custom tools

---

#### 3. Test Utilities

**Files:** `test/system/utils.js`
**Lines:** ~100
**Dependencies:** None

**What it provides:**
- Environment detection (NODE_ENV)
- Port configuration helpers
- Server startup/teardown patterns
- HTTP client factories

**Why include:**
- **Reusable patterns** - Adopters extend these for custom tests
- **Consistent structure** - Matches framework conventions
- **Self-contained** - No external dependencies

**Adopter value:** HIGH - Foundation for test infrastructure

---

### ❌ EXCLUDED FROM SCAFFOLDS (Framework Reference Only)

#### Integration Tests (17 files, ~1,800 lines)

**Files:** `test/integration/*.test.ts` (example-mcp)

**Why exclude:**
- **Framework-specific** - Tests multi-component interactions unique to framework architecture
- **Complex setup** - Requires deep understanding of internal abstractions
- **Better as reference** - Adopters should write integration tests for *their* components

**Guidance for adopters:**
- Review `packages/example-mcp/test/integration/` for patterns
- Write integration tests as server complexity grows
- Start with system tests before adding integration layer

---

#### Advanced System Tests (13 files, ~1,800 lines)

**Files (excluded):**
- `oauth-flow.system.test.ts` - Browser-based OAuth testing (requires Playwright)
- `models-validation.system.test.ts` - LLM model validation (requires ALL API keys)
- `mcp-inspector-headless*.system.test.ts` - MCP Inspector integration (requires browser)
- `mcp-horizontal-scaling.system.test.ts` - Redis-based horizontal scaling
- `session-cleanup-load-balancing.system.test.ts` - Load balancer session management
- `vercel-routes.system.test.ts` - Vercel-specific serverless testing
- `mcp-cors-headers.system.test.ts` - CORS header validation
- Others in `packages/example-mcp/test/system/`

**Why exclude:**
- **Advanced features** - Most adopters won't need browser testing or horizontal scaling initially
- **Heavy dependencies** - Playwright, Redis, multiple API keys, Docker
- **Framework validation** - These prove framework features work, not adopter implementations

**Guidance for adopters:**
- Start with basic MCP system test (included)
- Add OAuth tests when implementing authentication
- Add model validation when integrating multiple LLMs
- Reference framework tests for patterns

---

#### Unit Tests for Framework Packages (63 files, ~4,500 lines)

**Files:** `packages/*/test/*.test.ts`

**Why exclude:**
- **Internal implementation** - Tests framework internals, not adopter code
- **Pre-validated** - Framework packages published with passing tests
- **Overwhelming** - 63 test files would obscure adopter customization points

**Guidance for adopters:**
- Use framework packages as dependencies (already tested)
- Write unit tests for *your* custom tools and logic
- Reference `packages/example-tools-llm/test/` for LLM tool patterns
- Reference `packages/example-tools-basic/test/` for basic tool patterns

---

#### Contract Tests (1 file, ~300 lines)

**File:** `test/contract/api-contract.test.ts` (example-mcp)

**Why exclude:**
- **Multi-environment complexity** - Tests Local Express, Docker, Vercel deployments
- **Framework validation** - Proves OpenAPI spec compliance across deployment targets
- **Premature optimization** - Adopters should validate single deployment mode first

**Guidance for adopters:**
- Add contract tests when deploying to multiple environments
- Reference `packages/example-mcp/test/contract/` for patterns
- Use OpenAPI specification validation for API compliance

---

## Scaffolding Test Coverage Strategy

### Phase 1: Initial Scaffold (Current Implementation)

**Included tests:**
1. ✅ `test/unit/example.test.ts` - Unit test template
2. ✅ `test/system/mcp.system.test.ts` - Core MCP protocol validation
3. ✅ `test/system/utils.js` - Test utilities

**Validation commands:**
```bash
npm run test:unit              # Unit tests (Vitest)
npm run test:system:stdio      # System tests (STDIO transport)
npm run test:system:http       # System tests (HTTP transport)
npm run validate               # Full validation pipeline
```

**Test coverage:** ~750 lines validating core MCP functionality

---

### Phase 2: Adopter Expansion (Recommended Next Steps)

As adopters build out their MCP servers, they should add:

1. **Custom Tool Unit Tests**
   - Pattern: `test/unit/<tool-name>.test.ts`
   - Reference: `packages/example-tools-basic/test/basic-tools-order.test.ts`
   - Coverage: Tool registration, schema validation, execution logic

2. **OAuth Tests (If Adding Authentication)**
   - Pattern: `test/integration/auth.test.ts`
   - Reference: `packages/example-mcp/test/integration/github-oauth.test.ts`
   - Coverage: OAuth provider setup, token exchange, refresh logic

3. **LLM Tool Tests (If Adding AI Features)**
   - Pattern: `test/unit/<llm-tool-name>.test.ts`
   - Reference: `packages/example-tools-llm/test/chat.test.ts`
   - Coverage: Provider fallback, cost optimization, error handling

4. **Integration Tests (As Complexity Grows)**
   - Pattern: `test/integration/<feature>.test.ts`
   - Reference: `packages/example-mcp/test/integration/`
   - Coverage: Multi-component interactions, API endpoint flows

---

### Phase 3: Production Readiness (Advanced Testing)

Before production deployment, adopters should consider:

1. **Contract Tests**
   - Validate OpenAPI specification compliance
   - Test across deployment environments
   - Reference: `packages/example-mcp/test/contract/api-contract.test.ts`

2. **Performance Tests**
   - Load testing with realistic traffic
   - Memory leak detection
   - Response time validation

3. **Security Tests**
   - OAuth flow security validation
   - Token refresh edge cases
   - Input sanitization testing

4. **Browser-Based Tests (If Needed)**
   - Playwright setup for OAuth flows
   - MCP Inspector integration testing
   - Reference: `packages/example-mcp/test/playwright/`

---

## Test Configuration in Scaffolds

### vibe-validate Configuration

**File:** `vibe-validate.config.yaml` (template)

**Test validation phases:**

```yaml
phases:
  - name: Fast Checks & Build
    parallel: true
    steps:
      - name: typecheck
      - name: lint
      - name: unit-tests      # ← Runs test/unit/*.test.ts
      - name: build

  - name: System Tests
    parallel: true
    steps:
      - name: system-stdio    # ← Runs test/system on STDIO transport
      - name: system-http     # ← Runs test/system on HTTP transport
```

**Validation timing:**
- Unit tests: ~500ms
- System tests (STDIO): ~3-5 seconds
- System tests (HTTP): ~5-8 seconds
- **Total validation:** ~15 seconds

---

### package.json Test Scripts

**Generated in scaffolds:**

```json
{
  "scripts": {
    "test": "vitest",
    "test:unit": "vitest run test/unit",
    "test:integration": "vitest run test/integration",
    "test:system:stdio": "BASE_PORT=3000 NODE_ENV=test vitest run test/system --reporter=verbose",
    "test:system:http": "BASE_PORT=3001 NODE_ENV=test vitest run test/system --reporter=verbose",
    "validate": "npx vibe-validate validate",
    "pre-commit": "npx vibe-validate pre-commit"
  }
}
```

**Port isolation:**
- STDIO tests: PORT 3000 (BASE_PORT)
- HTTP tests: PORT 3001 (BASE_PORT + 1)
- Prevents test conflicts when running in parallel

---

## Framework as Reference Library

### Where Adopters Should Look for Patterns

#### Example MCP Package (`packages/example-mcp/`)

**Purpose:** Reference implementation showing all framework capabilities

**Key test references:**
- **System tests:** `test/system/` - Complete MCP protocol validation patterns
- **Integration tests:** `test/integration/` - Multi-component interaction patterns
- **Contract tests:** `test/contract/` - Multi-environment deployment validation

**When to reference:**
- Adding OAuth authentication
- Implementing horizontal scaling with Redis
- Testing browser-based OAuth flows
- Validating LLM model integrations
- Multi-environment deployment testing

---

#### Example Tools Packages

**packages/example-tools-basic/test/**
- Basic tool registration patterns
- Tool ordering and metadata validation
- Simple tool execution testing

**packages/example-tools-llm/test/**
- LLM provider mocking patterns
- Fallback chain testing
- Cost-optimized model selection
- Error handling with multiple providers

**When to reference:**
- Creating custom MCP tools
- Testing LLM-powered features
- Implementing provider fallback logic

---

#### Framework Package Tests (`packages/*/test/`)

**Available for deep-dive reference:**
- **config/test/** - Environment parsing, secret management
- **auth/test/** - OAuth provider implementation patterns
- **persistence/test/** - Storage abstraction patterns
- **http-server/test/** - HTTP transport and middleware
- **observability/test/** - Structured logging and telemetry

**When to reference:**
- Understanding framework internals
- Debugging complex issues
- Contributing to framework
- Advanced customization scenarios

---

## Rationale for Minimal Initial Coverage

### Why Only 2 Test Files in Scaffolds?

1. **Onboarding Friction** - New adopters overwhelmed by 98 test files
2. **Framework vs Implementation** - 63+ unit tests validate framework packages (already tested)
3. **Graceful Degradation** - System test proves server works without dependencies
4. **Progressive Disclosure** - Adopters add tests as features grow
5. **Reference Available** - All framework tests accessible for patterns

### Success Metrics for Scaffold Tests

✅ **Primary Goal:** Prove "my MCP server works"
- MCP protocol initialization
- Tool discovery and execution
- Transport layer functionality (STDIO + HTTP)
- Health endpoint availability

✅ **Secondary Goal:** Show testing patterns
- Unit test structure
- System test utilities
- Vitest configuration
- Port isolation strategy

✅ **Tertiary Goal:** Enable expansion
- Clear paths to add OAuth tests
- Patterns for LLM tool testing
- Integration test references
- Contract test examples

---

## Adopter Documentation Strategy

### README.md (Generated in Scaffolds)

**Test section should include:**

```markdown
## Testing

### Running Tests

\`\`\`bash
npm test                 # Unit tests (watch mode)
npm run test:unit        # Unit tests (run once)
npm run test:system:stdio # System tests (STDIO transport)
npm run test:system:http  # System tests (HTTP transport)
npm run validate         # Full validation pipeline
\`\`\`

### Test Structure

- **test/unit/** - Unit tests for individual components
- **test/system/** - End-to-end MCP protocol validation

### Adding Tests

**For custom tools:**
1. Add unit test to `test/unit/<tool-name>.test.ts`
2. Reference pattern: `test/unit/example.test.ts`

**For complex features:**
1. Review framework tests: `node_modules/@mcp-typescript-simple/example-mcp/test/`
2. Adapt patterns for your implementation
3. See framework documentation for advanced patterns
```

---

### CLAUDE.md (Generated in Scaffolds)

**Test guidance section:**

```markdown
## Testing Strategy

This project includes minimal test coverage to prove core MCP functionality works.
As you build custom tools and features, expand test coverage accordingly.

### Current Test Coverage

- ✅ Unit test template (`test/unit/example.test.ts`)
- ✅ MCP protocol validation (`test/system/mcp.system.test.ts`)
- ✅ Test utilities (`test/system/utils.js`)

### Expanding Test Coverage

**When adding custom tools:**
- Add unit tests to `test/unit/<tool-name>.test.ts`
- Reference: framework example-tools-basic tests

**When adding OAuth:**
- Add integration tests for auth flows
- Reference: framework example-mcp integration tests

**When adding LLM features:**
- Add unit tests with provider mocking
- Reference: framework example-tools-llm tests

**Framework test references:**
- System test patterns: `node_modules/@mcp-typescript-simple/example-mcp/test/system/`
- Integration patterns: `node_modules/@mcp-typescript-simple/example-mcp/test/integration/`
- Unit test patterns: `node_modules/@mcp-typescript-simple/example-tools-*/test/`
```

---

## Conclusion

### Test Inclusion Summary

| Test Category | Files Included | Rationale |
|--------------|---------------|-----------|
| **Unit Tests** | 1 template | Pattern reference for custom tools |
| **System Tests** | 1 core test | Validates MCP protocol compliance |
| **Utilities** | 1 utility file | Foundation for test infrastructure |
| **Integration Tests** | 0 (reference only) | Framework-specific, adopt patterns as needed |
| **Advanced System Tests** | 0 (reference only) | Add when features require (OAuth, Redis, etc.) |
| **Contract Tests** | 0 (reference only) | Add for multi-environment deployments |

**Total scaffolded tests:** 2 test files (~750 lines)
**Framework reference tests:** 96 test files (~8,000+ lines)

### Strategic Approach

**Phase 1 (Scaffold):** Minimal tests proving core MCP works
**Phase 2 (Development):** Add unit tests for custom tools
**Phase 3 (Advanced):** Add integration tests for complex features
**Phase 4 (Production):** Add contract/performance/security tests

**Framework as reference library:** All 98 framework tests available for pattern adoption

---

## Next Steps

1. ✅ **Document strategy** (this file)
2. ⏭️ **Generate test project** - Validate scaffolding produces working tests
3. ⏭️ **Update scaffolding README** - Document test expansion paths
4. ⏭️ **Create PR** - Ship production-ready scaffolding tool

---

**Last Updated:** 2025-11-16
**Authors:** Jeff Dutton, Claude Code
**Status:** Finalized for PR
