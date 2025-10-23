# Framework Tests

This directory contains **framework-level tests** that validate the MCP TypeScript Simple framework packages work correctly.

## Purpose

These tests ensure that:
- **Individual packages** function correctly in isolation
- **Package integrations** work together as expected
- **Framework APIs** are stable and well-tested

## What Belongs Here

✅ **Framework Package Tests:**
- Tests for `@mcp-typescript-simple/auth` package APIs
- Tests for `@mcp-typescript-simple/server` package APIs
- Tests for `@mcp-typescript-simple/http-server` package APIs
- Tests for `@mcp-typescript-simple/observability` package APIs
- Tests for other framework packages

✅ **Package Integration Tests:**
- Testing auth + server integration
- Testing tools + server integration
- Testing http-server + auth integration

❌ **What DOESN'T Belong Here:**
- Implementation-specific tests (those go in `packages/example-mcp/test/`)
- End-to-end application tests (those go in `packages/example-mcp/test/system/`)
- Integration tests for specific MCP server implementations

## Test Organization

```
test/framework/
├── README.md           # This file
├── docs/               # Documentation tests (OpenAPI validation, etc.)
├── helpers/            # Framework test utilities
├── llm-reporter.ts     # LLM model validation test reporter
└── vitest-setup.ts     # Framework test setup
```

## Running Framework Tests

```bash
# Run all framework tests
npm run test:framework

# Run specific framework test file
npx vitest test/framework/docs/openapi-validation.test.ts
```

## Relationship to Package Tests

- **`packages/*/test/`**: Tests for individual package functionality (unit tests)
- **`test/framework/`**: Tests for package interactions and framework-level behavior
- **`packages/example-mcp/test/`**: Tests for the example MCP server implementation

## Adding New Framework Tests

When adding tests here, ask:
1. Does this test framework packages working together?
2. Is this testing the framework API contract?
3. Would this test apply to all MCP server implementations?

If yes → Add to `test/framework/`
If no → Add to `packages/example-mcp/test/` or package-specific test directory
