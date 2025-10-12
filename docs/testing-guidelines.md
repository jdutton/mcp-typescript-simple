# Testing Guidelines

Comprehensive testing guidelines for maintaining test quality and preventing resource leaks in the MCP TypeScript Simple project.

## Table of Contents

1. [Resource Cleanup Patterns](#resource-cleanup-patterns)
2. [Test Organization Best Practices](#test-organization-best-practices)
3. [Common Pitfalls and Solutions](#common-pitfalls-and-solutions)
4. [Testing Utilities](#testing-utilities)
5. [Running Tests](#running-tests)

## Resource Cleanup Patterns

### Timer Cleanup Pattern

**Problem**: Timers (setInterval, setTimeout) continue running after tests complete, causing leaks and interference between tests.

**Solution**: Always clean up timers in `afterEach`:

```typescript
import { vi, beforeEach, afterEach, describe, it } from 'vitest';

describe('Component with Timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should handle timeout', () => {
    // Test implementation
  });
});
```

**Examples in codebase**:
- `test/unit/session/session-manager.test.ts:9-16`
- `test/unit/session/event-store.test.ts:14-18`

### Server Cleanup Pattern

**Problem**: HTTP/Express servers keep ports bound after tests, causing port conflicts.

**Solution**: Track servers and clean them up in `afterEach`:

```typescript
describe('Server Tests', () => {
  const servers: MCPStreamableHttpServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.map(async (server) => {
      try {
        const sessionManager = server.getSessionManager();
        if (sessionManager) {
          sessionManager.destroy();
        }
        await server.stop();
      } catch {
        // Ignore errors during cleanup
      }
    }));
    servers.length = 0;
  });

  const makeServer = (options?) => {
    const server = new MCPStreamableHttpServer(options);
    servers.push(server);
    return server;
  };
});
```

**Examples in codebase**:
- `test/unit/server/streamable-http-server.test.ts:13-69`

### Redis/Database Cleanup Pattern

**Problem**: Database connections and mock instances leak between test suites.

**Solution**: Clean up connections in `afterAll`:

```typescript
describe('Redis Store Tests', () => {
  let redisMock: RedisMock;

  beforeAll(() => {
    redisMock = new RedisMock();
  });

  afterAll(async () => {
    if (redisMock) {
      await redisMock.disconnect();
      redisMock = null;
    }
  });
});
```

**Examples in codebase**:
- `test/unit/auth/stores/redis-stores.test.ts:29-35`

### Environment Variable Isolation Pattern

**Problem**: Tests mutate `process.env`, polluting the environment for subsequent tests.

**Solution**: Use the `preserveEnv()` helper:

```typescript
import { preserveEnv } from '../../helpers/env-helper.js';

describe('Environment Tests', () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = preserveEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  it('should handle environment variables', () => {
    process.env.TEST_VAR = 'value';
    // Test implementation
  });
});
```

**Examples in codebase**:
- `test/unit/auth/allowlist.test.ts:7-16`
- `test/unit/config/environment.test.ts:7-14`

### File/Directory Cleanup Pattern

**Problem**: Test files persist after tests, interfering with subsequent runs.

**Solution**: Use `afterAll` to clean up test files:

```typescript
import { rmSync } from 'fs';
import { join } from 'path';

describe('File Store Tests', () => {
  const testDir = join(process.cwd(), 'test-data');

  afterAll(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore errors if directory doesn't exist
    }
  });
});
```

**Examples in codebase**:
- `test/unit/auth/file-token-store.test.ts:32`
- `test/playwright/global-setup.ts:12-19`

## Test Organization Best Practices

### Test Structure

Follow this standard structure for all tests:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Feature Name', () => {
  // Setup variables
  let resource: SomeResource;

  beforeEach(() => {
    // Setup code that runs before each test
    resource = new SomeResource();
  });

  afterEach(() => {
    // Cleanup code that runs after each test
    resource.dispose();
  });

  describe('Sub-feature', () => {
    it('should do something specific', () => {
      // Arrange
      const input = 'test';

      // Act
      const result = resource.process(input);

      // Assert
      expect(result).toBe('expected');
    });
  });
});
```

### Mock Management and Cleanup

**Always clean up mocks** to prevent pollution between tests:

```typescript
import { vi, beforeEach, afterEach } from 'vitest';

describe('Tests with Mocks', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks(); // Restore all spies
    vi.clearAllMocks();   // Clear call history
  });
});
```

**Key rules**:
- Use `vi.restoreAllMocks()` to restore original implementations
- Use `vi.clearAllMocks()` to clear call history
- Always call both in `afterEach`

### Async/Await Patterns

**Always await async operations** in tests:

```typescript
describe('Async Operations', () => {
  it('should handle async operations', async () => {
    const result = await asyncFunction();
    expect(result).toBe('expected');
  });

  it('should clean up async resources', async () => {
    const resource = await createAsyncResource();
    try {
      // Test implementation
    } finally {
      await resource.dispose();
    }
  });
});
```

### Test Isolation Principles

**Each test should be independent**:

1. **No shared state between tests**: Use `beforeEach` to create fresh instances
2. **Clean up after each test**: Use `afterEach` for cleanup
3. **Use factories instead of singletons**: Create new instances per test
4. **Reset singletons when necessary**: Call `.reset()` methods in `beforeEach`

```typescript
describe('Isolated Tests', () => {
  beforeEach(() => {
    // Reset singletons to ensure clean state
    EnvironmentConfig.reset();
  });

  afterEach(() => {
    // Clean up test-specific state
    EnvironmentConfig.reset();
  });
});
```

**Examples in codebase**:
- `test/unit/auth/factory.test.ts:12-23`

## Common Pitfalls and Solutions

### Resource Leaks

#### Timers Not Cleaned Up

**Problem**:
```typescript
// ❌ BAD - Timer leaks
it('should use fake timers', () => {
  vi.useFakeTimers();
  // Test code
}); // Timer not cleaned up!
```

**Solution**:
```typescript
// ✅ GOOD - Timer cleanup
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});
```

#### Connections Not Closed

**Problem**:
```typescript
// ❌ BAD - Server not stopped
it('should start server', async () => {
  const server = new MCPStreamableHttpServer(options);
  await server.start();
  // Test code
}); // Server still running!
```

**Solution**:
```typescript
// ✅ GOOD - Server cleanup
const servers: MCPStreamableHttpServer[] = [];

afterEach(async () => {
  await Promise.all(servers.map(s => s.stop()));
  servers.length = 0;
});

const makeServer = (options) => {
  const server = new MCPStreamableHttpServer(options);
  servers.push(server);
  return server;
};
```

#### File Handles Not Released

**Problem**:
```typescript
// ❌ BAD - File handle leak
it('should write file', () => {
  const store = new FileTokenStore({ filePath: 'test.json' });
  store.set('key', 'value');
  // Store not disposed!
});
```

**Solution**:
```typescript
// ✅ GOOD - Proper disposal
let store: FileTokenStore;

beforeEach(() => {
  store = new FileTokenStore({ filePath: 'test.json' });
});

afterEach(async () => {
  await store.dispose();
  rmSync('test.json', { force: true });
});
```

### Mock Pollution Between Tests

**Problem**: Mock state leaks from one test to another.

```typescript
// ❌ BAD - Mock pollution
describe('Tests', () => {
  it('test 1', () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    // Test code
  });

  it('test 2', () => {
    // logger.error is still mocked!
    expect(logger.error).toHaveBeenCalled(); // May pass unexpectedly
  });
});
```

**Solution**: Always restore mocks in `afterEach`:

```typescript
// ✅ GOOD - Clean mocks
describe('Tests', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('test 1', () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    // Test code
  });

  it('test 2', () => {
    // logger.error is fresh, not mocked
  });
});
```

### Environment Variable Pollution

**Problem**: Tests modify `process.env` and don't restore it.

```typescript
// ❌ BAD - Environment pollution
describe('Tests', () => {
  it('test 1', () => {
    process.env.NODE_ENV = 'test';
    // Test code
  });

  it('test 2', () => {
    // NODE_ENV is still 'test' from previous test!
  });
});
```

**Solution**: Use `preserveEnv()` helper:

```typescript
// ✅ GOOD - Environment isolation
import { preserveEnv } from '../../helpers/env-helper.js';

describe('Tests', () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = preserveEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  it('test 1', () => {
    process.env.NODE_ENV = 'test';
    // Test code
  });

  it('test 2', () => {
    // NODE_ENV is restored to original value
  });
});
```

### Port Conflicts

**Problem**: Previous test runs leave processes on required ports.

**Solution**: Use `setupTestEnvironment()` for automatic cleanup:

```typescript
import { setupTestEnvironment } from '../helpers/test-setup.js';

describe('System Tests', () => {
  let cleanup: TestEnvironmentCleanup;

  beforeAll(async () => {
    // Automatically cleans up leaked test processes on these ports
    cleanup = await setupTestEnvironment({
      ports: [3000, 3001, 6274],
    });
  });

  afterAll(async () => {
    await cleanup();
  });
});
```

**Examples in codebase**:
- `test/system/mcp-inspector-headless.system.test.ts:22-31`

### Async Operation Leaks

**Problem**: Async operations continue after test completes.

```typescript
// ❌ BAD - Async leak
it('should fetch data', () => {
  fetchData().then(data => {
    expect(data).toBeDefined();
  });
  // Test completes before promise resolves!
});
```

**Solution**: Always await async operations:

```typescript
// ✅ GOOD - Properly awaited
it('should fetch data', async () => {
  const data = await fetchData();
  expect(data).toBeDefined();
});
```

## Testing Utilities

### Process Management: `test/helpers/process-utils.ts`

Utilities for managing child processes in tests.

#### `stopProcessGroup(pid: number): Promise<void>`

Gracefully stops a process group (SIGTERM → SIGKILL cascade).

```typescript
import { stopProcessGroup } from '../helpers/process-utils.js';

const childProcess = spawn('node', ['server.js'], { detached: true });
// Later...
await stopProcessGroup(childProcess.pid);
```

### Port Management: `test/helpers/port-utils.ts`

Utilities for detecting and cleaning up leaked test processes on ports.

#### `cleanupLeakedTestPorts(ports: number[]): Promise<PortCleanupResult[]>`

Automatically cleans up test processes on specified ports.

```typescript
import { cleanupLeakedTestPorts } from '../helpers/port-utils.js';

// Clean up any leaked test processes before running tests
const results = await cleanupLeakedTestPorts([3000, 3001, 6274]);
for (const result of results) {
  if (result.success) {
    console.log(`Cleaned up port ${result.port}`);
  }
}
```

#### `isPortAvailable(port: number): Promise<boolean>`

Checks if a port is available for use.

```typescript
import { isPortAvailable } from '../helpers/port-utils.js';

const available = await isPortAvailable(3000);
if (!available) {
  throw new Error('Port 3000 is already in use');
}
```

### Test Setup: `test/helpers/test-setup.ts`

High-level test environment setup with automatic cleanup.

#### `setupTestEnvironment(config): Promise<TestEnvironmentCleanup>`

Sets up test environment with automatic port cleanup.

```typescript
import { setupTestEnvironment } from '../helpers/test-setup.js';

describe('System Tests', () => {
  let cleanup: TestEnvironmentCleanup;

  beforeAll(async () => {
    cleanup = await setupTestEnvironment({
      ports: [3000, 3001, 6274],
      cleanupTimeout: 5000,
    });
  });

  afterAll(async () => {
    await cleanup();
  });
});
```

### Environment Variables: `test/helpers/env-helper.ts`

Utilities for environment variable isolation.

#### `preserveEnv(): () => void`

Preserves and restores environment variables.

```typescript
import { preserveEnv } from '../../helpers/env-helper.js';

describe('Environment Tests', () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = preserveEnv();
  });

  afterEach(() => {
    restoreEnv();
  });
});
```

### Port Registry: `test/helpers/port-registry.ts`

Centralized port definitions for all tests.

```typescript
import { TEST_PORTS, getSystemTestPorts, getHeadlessPorts } from '../helpers/port-registry.js';

// Use predefined ports
const inspectorPort = TEST_PORTS.INSPECTOR; // 6274

// Get all system test ports
const systemPorts = getSystemTestPorts(); // [3000, 3001]

// Get all headless test ports
const headlessPorts = getHeadlessPorts(); // [6274, 16274, 16277]
```

### Signal Handling: `test/helpers/signal-handler.ts`

Automatic cleanup of child processes on CTRL-C.

```typescript
import { registerProcess, unregisterProcess } from '../helpers/signal-handler.js';

const childProcess = spawn('node', ['server.js']);

// Register for automatic cleanup
registerProcess(childProcess, 'My Server');

// Later... (optional, automatic on SIGINT/SIGTERM)
await unregisterProcess(childProcess.pid);
```

## Running Tests

### Local Development Workflow

#### Running All Tests

```bash
# Complete validation (unit → integration → build → system)
npm run validate

# Individual test suites
npm test                 # Unit tests
npm run test:integration # Integration tests
npm run test:system      # System tests (STDIO + HTTP)
```

#### LLM-Optimized Output

For concise, failure-focused output (recommended when using Claude Code or other AI assistants):

```bash
# Clean output with only failures
LLM_OUTPUT=1 npm test
LLM_OUTPUT=1 npm run test:integration
LLM_OUTPUT=1 npm run test:system

# Validation with LLM output (automatically enabled)
npm run validate
```

**Benefits of LLM_OUTPUT=1**:
- Suppresses verbose server logs
- Shows only test failures (not passing tests)
- Reduces output from 200+ lines to <20 lines on failure
- Makes failures immediately visible

#### Running Specific Tests

```bash
# Run specific test file
npm test -- test/unit/auth/factory.test.ts

# Run tests matching pattern
npm test -- --testNamePattern="OAuth"

# Run tests in watch mode
vitest
```

### Leak Detection

#### Detecting Resource Leaks

Vitest can detect open handles (timers, connections, file handles) that leak after tests:

```bash
# Run unit tests with leak detection
npx vitest run --detectOpenHandles test/unit/

# Run specific file with leak detection
npx vitest run --detectOpenHandles test/unit/session/session-manager.test.ts
```

**Common leak indicators**:
- Tests hang after completion
- Port conflicts on subsequent runs
- File descriptor exhaustion
- Vitest detects open handles

#### Manual Port Cleanup

If tests leave processes on ports:

```bash
# Check what's using a port
lsof -ti:3000

# Kill processes on specific ports
lsof -ti:3000,3001 | xargs -r kill -9

# Or use the automated cleanup
npm run dev:clean
```

### CI/CD Integration

#### GitHub Actions

Tests run automatically on pull requests via `.github/workflows/validate.yml`:

1. TypeScript compilation
2. Type checking
3. Code linting
4. OpenAPI validation
5. Unit tests
6. Integration tests
7. STDIO system tests
8. HTTP system tests
9. Headless browser tests
10. Docker build

All tests use `LLM_OUTPUT=1` for concise output.

#### Pre-Commit Validation

Run validation before committing:

```bash
# MANDATORY before every commit
npm run pre-commit
```

This command:
1. Checks if branch is behind origin/main
2. Runs fast validation (typecheck + lint) if code unchanged
3. Runs full validation if code changed

### Debugging Flaky Tests

#### Symptoms of Flaky Tests

- Test passes sometimes, fails other times
- Test depends on timing (race conditions)
- Test depends on external state
- Test fails in CI but passes locally

#### Debugging Strategies

1. **Run test multiple times**:
```bash
# Run test 10 times to detect flakiness
for i in {1..10}; do npm test -- test/unit/flaky.test.ts; done
```

2. **Enable verbose logging**:
```bash
# Run without LLM_OUTPUT to see all logs
npm test -- test/unit/flaky.test.ts
```

3. **Check for resource leaks**:
```bash
npx vitest run --detectOpenHandles test/unit/flaky.test.ts
```

4. **Isolate the test**:
```bash
# Run only the failing test
npm test -- test/unit/flaky.test.ts --testNamePattern="specific test name"
```

5. **Check for timing issues**:
```typescript
// Add delays to expose race conditions
await new Promise(resolve => setTimeout(resolve, 100));
```

6. **Verify test isolation**:
```typescript
// Run test alone and with others
npm test -- test/unit/flaky.test.ts                    # Alone
npm test -- test/unit/auth/*.test.ts                   # With siblings
npm test                                                # With all tests
```

## Summary

**Key principles for test quality**:

1. **Clean up all resources** - timers, connections, files, mocks
2. **Isolate tests** - no shared state, fresh instances
3. **Use helpers** - `preserveEnv()`, `setupTestEnvironment()`, etc.
4. **Always await async** - no floating promises
5. **Restore mocks** - `vi.restoreAllMocks()` in `afterEach`
6. **Use LLM output** - concise, failure-focused output for AI assistants
7. **Run pre-commit** - validate before every commit

**When in doubt**:
- Look at similar tests in the codebase
- Use the testing utilities
- Ask for code review
- Run with leak detection

For more information, see:
- [Vitest Documentation](https://vitest.dev/)
- [Issue #68 - Test Suite Quality Improvements](https://github.com/jdutton/mcp-typescript-simple/issues/68)
- [CLAUDE.md](../CLAUDE.md) - Development workflow and testing commands
