# System Testing Documentation

This directory contains end-to-end system tests that validate the complete MCP TypeScript Simple deployment across different environments.

## Overview

System tests verify that the deployed application works correctly in real environments by testing the complete system through its public API endpoints. Unlike unit and integration tests, system tests:

- Make real HTTP requests to deployed endpoints
- Test the complete request/response cycle including authentication
- Validate environment-specific configuration and behavior
- Verify that all components work together in the deployment environment

## Test Architecture & Server Management

### Transport Modes and Server Behavior

This system uses different transport modes for testing different aspects of the MCP server:

#### STDIO Transport Tests (`test:system:stdio`)
- **Purpose**: Tests the traditional STDIO-based MCP protocol communication
- **Server Management**: Individual test files start and manage their own STDIO server processes using `STDIOTestClient`
- **Port Usage**: No HTTP ports used - uses process stdin/stdout communication
- **Test Files**: `stdio.system.test.ts`
- **Environment**: `TEST_ENV=stdio`

#### HTTP Transport Tests (`test:system:ci`, `test:system:express`)
- **Purpose**: Tests HTTP-based streamable MCP protocol communication
- **Server Management**: **Suite-level server management** - the test suite starts ONE shared HTTP server that all tests use
- **Port Usage**: Uses HTTP port 3001 (configurable via `HTTP_TEST_PORT`)
- **Critical Rule**: Individual test files **NEVER** start HTTP servers on ports
- **Test Files**: All HTTP-based test files (health, auth, mcp, oauth-discovery, tools, etc.)
- **Environment**: `TEST_ENV=express:ci` or `TEST_ENV=express`

### Server Management Architecture

**CRITICAL PRINCIPLE**: Different transport modes have different server management approaches:

#### For STDIO Tests:
✅ **Individual tests start servers** - Each test file uses `STDIOTestClient` to manage its own server process
✅ **No port conflicts** - Uses process communication, not network ports

#### For HTTP Tests:
❌ **Individual tests NEVER start servers** - Test files must not create HTTP servers
✅ **Suite starts one shared server** - `test/system/setup.ts` starts a single HTTP server for all tests
✅ **Shared server lifecycle** - Started in global `beforeAll`, stopped in global `afterAll`
✅ **Port management** - Only one process manages the HTTP port, preventing conflicts

### Test Files Architecture

- **`health.system.test.ts`** - Health endpoint and deployment validation (HTTP only)
- **`auth.system.test.ts`** - Authentication and OAuth configuration (HTTP only)
- **`mcp.system.test.ts`** - MCP protocol compliance and functionality (HTTP only)
- **`mcp-oauth-compliance.system.test.ts`** - OAuth-enabled MCP protocol compliance (HTTP only)
- **`mcp-session-state.system.test.ts`** - MCP session state management validation (HTTP only)
- **`oauth-discovery.system.test.ts`** - OAuth discovery endpoint validation (HTTP only)
- **`tools.system.test.ts`** - Tool execution and LLM integration (HTTP only)
- **`stdio.system.test.ts`** - STDIO transport system testing (STDIO only, manages own server)
- **`stdio-client.ts`** - STDIO test client for managing STDIO server processes
- **`http-client.ts`** - HTTP test client (legacy, no longer used by test files)
- **`utils.ts`** - Shared utilities and test helpers
- **`setup.ts`** - Global test configuration and **HTTP server management**

### Server Startup Detection

The suite-level HTTP server uses multiple detection patterns to ensure server readiness:
```typescript
// Server ready indicators
if (text.includes('listening on') ||
    text.includes('server running') ||
    text.includes('server listening')) {
  // Server is ready
}
```

### Port Management

- **HTTP Tests**: Use port 3001 (or `HTTP_TEST_PORT` environment variable)
- **Port Conflicts**: Suite setup kills any existing processes on the target port before starting
- **Process Cleanup**: Force kill with `SIGKILL` for faster test execution
- **Wait Times**: 3-second wait after killing processes to ensure port is freed

## Test Structure

### Test Categories

#### Health & Configuration Tests
- Basic health endpoint validation
- Deployment environment detection
- Provider configuration verification
- Performance baseline checks

#### Authentication Tests
- OAuth provider configuration validation
- Authentication endpoint availability
- Security header verification
- Environment-specific auth behavior

#### MCP Protocol Tests
- JSON-RPC 2.0 compliance
- MCP initialization and handshake
- Tool discovery and metadata
- Error handling and protocol compliance

#### Tool Execution Tests
- Basic tool functionality (hello, echo, current-time)
- LLM tool integration (when API keys available)
- Concurrent tool execution
- Performance and reliability testing

## Test Environments

System tests support different transport modes and deployment environments:

### STDIO Transport Mode
```bash
npm run test:system:stdio
```
- **Transport**: STDIO (traditional MCP)
- **Server**: Individual test files manage their own STDIO server processes
- **URL**: None (process communication)
- **Setup**: No external server needed
- **Use Case**: STDIO protocol compliance testing

### HTTP Transport Modes

#### Express CI Environment
```bash
npm run test:system:ci
```
- **Transport**: HTTP (streamable MCP)
- **Server**: Suite-managed HTTP server on port 3001
- **URL**: `http://localhost:3001`
- **Setup**: Automatic server startup/shutdown by test suite
- **Use Case**: CI/CD automated testing

#### Express Development
```bash
npm run test:system:express
```
- **Transport**: HTTP (streamable MCP)
- **Server**: External server expected (started manually)
- **URL**: `http://localhost:3001`
- **Setup**: Start with `npm run dev:http`
- **Use Case**: Local development testing

### Legacy Vercel Environments (Deprecated in favor of HTTP transport)

#### Vercel Local Development
```bash
npm run test:system:vercel:local
```
- **URL**: `http://localhost:3000`
- **Setup**: Start with `npm run dev:vercel`
- **Use Case**: Development and debugging

#### Vercel Preview
```bash
npm run test:system:vercel:preview
```
- **URL**: `https://project-branch.vercel.app` (or set `VERCEL_PREVIEW_URL`)
- **Setup**: Vercel preview deployment from PR
- **Use Case**: Pre-production validation

#### Vercel Production
```bash
npm run test:system:vercel:production
```
- **URL**: `https://project.vercel.app` (or set `VERCEL_PRODUCTION_URL`)
- **Setup**: Production Vercel deployment
- **Use Case**: Production smoke testing

#### Docker
```bash
npm run test:system:docker
```
- **URL**: `http://localhost:3000`
- **Setup**: Docker container with exposed port
- **Use Case**: Containerized deployment testing

## Configuration

### Environment Variables

#### Required for Testing
- `TEST_ENV` - Target environment:
  - `stdio` - STDIO transport mode
  - `express` - HTTP transport with external server
  - `express:ci` - HTTP transport with suite-managed server
  - `vercel:local`, `vercel:preview`, `vercel:production`, `docker` - Legacy Vercel environments

#### Optional Configuration
- `HTTP_TEST_PORT` - Port for HTTP transport tests (default: 3001)
- `VERCEL_PREVIEW_URL` - Custom preview deployment URL
- `VERCEL_PRODUCTION_URL` - Custom production deployment URL

#### Application Configuration (for deployment)
- `ANTHROPIC_API_KEY` - Claude API key (enables LLM tools)
- `OPENAI_API_KEY` - OpenAI API key (enables LLM tools)
- `GOOGLE_API_KEY` - Google/Gemini API key (enables LLM tools)
- **OAuth Providers** - Configure one or more (server auto-detects):
  - Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - GitHub: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
  - Microsoft: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`

### Test Configuration

The system test configuration is defined in `jest.system.config.js`:

```javascript
// Key configuration options:
testTimeout: 30000,        // 30-second timeout for system tests
maxConcurrency: 1,         // Sequential execution to avoid HTTP port conflicts
setupFilesAfterEnv: ['<rootDir>/test/system/setup.ts']  // Suite-level HTTP server management
```

**Critical**: `maxConcurrency: 1` prevents HTTP port conflicts by ensuring tests run sequentially. STDIO tests don't have this limitation but use the same setting for consistency.

## Running Tests

### Basic Usage

```bash
# Run all system tests (uses jest.system.config.js)
npm run test:system

# Run STDIO transport tests
npm run test:system:stdio

# Run HTTP transport tests
npm run test:system:express     # External server required
npm run test:system:ci          # Suite manages server automatically

# Run legacy Vercel environment tests
npm run test:system:vercel:local
npm run test:system:vercel:preview
npm run test:system:vercel:production
npm run test:system:docker

# Run specific test file
npx jest --config jest.system.config.js test/system/health.system.test.ts

# Run with verbose output
npm run test:system -- --verbose

# Run with coverage
npm run test:system -- --coverage
```

### Development Workflow

#### For STDIO Transport Testing
1. **Run STDIO Tests** (no server setup needed)
   ```bash
   npm run test:system:stdio
   ```

#### For HTTP Transport Testing

**Option 1: Auto-managed Server (Recommended for CI)**
1. **Run CI Tests** (server started automatically)
   ```bash
   npm run test:system:ci
   ```

**Option 2: Manual Server (Recommended for debugging)**
1. **Start HTTP Server**
   ```bash
   npm run dev:http
   ```
2. **Run HTTP Tests**
   ```bash
   npm run test:system:express
   ```

#### Debugging
3. **Debug Failing Tests**
   ```bash
   # Run specific test with verbose output
   npx jest --config jest.system.config.js --verbose test/system/health.system.test.ts

   # Run with specific environment
   TEST_ENV=express:ci npx jest --config jest.system.config.js --verbose test/system/health.system.test.ts
   ```

### CI/CD Integration

System tests are designed to integrate with CI/CD pipelines:

```yaml
# Example GitHub Actions usage
- name: Run system tests against preview
  env:
    TEST_ENV: preview
    VERCEL_PREVIEW_URL: ${{ steps.deploy.outputs.preview-url }}
  run: npm run test:system:preview
```

## Test Dependencies

### HTTP Client (HTTP Transport)
- **axios**: HTTP client for making API requests to HTTP endpoints
- **Configuration**: Automatic request/response logging, timeout handling, CORS validation
- **Usage**: Only used by HTTP transport tests (health, auth, mcp, oauth-discovery, tools)

### STDIO Client (STDIO Transport)
- **STDIOTestClient**: Custom client for managing STDIO server processes
- **Process Management**: Spawns and manages tsx processes for STDIO communication
- **Usage**: Only used by STDIO transport tests (stdio.system.test.ts)

### Test Utilities
- **Environment Detection**: Automatic environment configuration based on `TEST_ENV`
- **Server Readiness**: Wait for server availability (HTTP environments only)
- **Response Validation**: Structured validation helpers for API responses
- **Error Handling**: Graceful handling of deployment and configuration issues
- **Transport Detection**: Automatic detection of STDIO vs HTTP transport mode

## Test Behavior

### Transport-Aware Testing
System tests adapt their behavior based on the transport mode and target environment:

#### STDIO Transport
- **Server Management**: Individual tests manage their own STDIO server processes
- **Communication**: Direct process stdin/stdout communication
- **Environment**: Single STDIO environment, no external dependencies

#### HTTP Transport
- **Server Management**: Suite manages one shared HTTP server for all tests
- **Communication**: HTTP requests to localhost endpoints
- **Environments**:
  - **Express**: External server expected (manual startup)
  - **Express:CI**: Automatic server startup/shutdown (CI-friendly)
  - **Vercel**: Wait for server startup, environment-specific validation

#### Environment-Specific Behavior
- **Local/Development**: Wait for server startup, relaxed authentication requirements
- **CI**: Automatic server management, fast startup/shutdown
- **Preview**: Full functionality testing with temporary credentials
- **Production**: Strict validation, security requirements, performance thresholds

### LLM Tool Testing
LLM tools are tested conditionally based on available API keys:

- **No API Keys**: LLM tools skipped, basic tools tested
- **API Keys Available**: Full LLM functionality tested with rate limiting awareness
- **API Errors**: Graceful degradation, tests don't fail on rate limits or temporary API issues

### Error Tolerance
System tests are designed to be robust in real deployment environments:

- **Network Issues**: Retry logic and timeout handling
- **Rate Limiting**: Graceful handling of LLM provider rate limits
- **Configuration Issues**: Clear error reporting for missing environment variables
- **Performance Variance**: Adaptive performance thresholds based on environment

## Debugging and Troubleshooting

### Common Issues

#### HTTP Server Port Conflicts
```
Error: listen EADDRINUSE: address already in use ::1:3001
```
**Solution**:
- Kill any processes using port 3001: `lsof -ti :3001 | xargs -r kill -9`
- Use `test:system:ci` which handles port cleanup automatically
- Check for background tsx processes: `pkill -f "tsx src/index.ts"`

#### Server Not Ready (HTTP Transport)
```
Error: Server not ready at http://localhost:3001
```
**Solution**:
- For `express` environment: Start server with `npm run dev:http`
- For `express:ci` environment: Let the test suite manage the server automatically
- Ensure no port conflicts exist

#### Server Not Ready (Vercel Environments)
```
Error: Server not ready at http://localhost:3000
```
**Solution**: Ensure local server is running with `npm run dev:vercel`

#### Environment Variable Missing
```
Error: Unknown test environment: undefined
```
**Solution**: Set `TEST_ENV` environment variable or use specific npm script

#### Authentication Errors
```
Error: OAuth provider could not be created
```
**Solution**: Verify OAuth credentials are configured in deployment environment

#### LLM Tool Failures
```
Warning: LLM tools failed (possibly rate limited or API key issue)
```
**Solution**: Check API key configuration and rate limiting status

### Debug Mode

Enable verbose logging by setting environment variables:

```bash
# Enable debug output
DEBUG=true npm run test:system:local

# Jest verbose mode
npm run test:system -- --verbose --no-coverage
```

### Manual Testing

For debugging specific endpoints:

```bash
# Test health endpoint manually
curl -v http://localhost:3000/api/health

# Test MCP endpoint manually
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Best Practices

### Writing System Tests
1. **Test Real Scenarios**: Focus on actual user workflows and deployment scenarios
2. **Transport Awareness**: Use appropriate client (HTTP vs STDIO) for the transport being tested
3. **Server Management Rules**:
   - **STDIO tests**: Use `STDIOTestClient` to manage individual server processes
   - **HTTP tests**: NEVER start HTTP servers in test files - rely on suite-managed server
4. **Environment Awareness**: Adapt test expectations based on target environment and transport
5. **Graceful Degradation**: Handle missing features/credentials gracefully
6. **Performance Conscious**: Set reasonable timeouts for different environments
7. **Clear Logging**: Provide informative output for debugging

### Maintaining Tests
1. **Keep Tests Independent**: Each test should be self-contained within its transport mode
2. **Respect Server Architecture**:
   - Never add HTTP server startup to individual HTTP test files
   - Only modify `setup.ts` for suite-level HTTP server management
   - Use `STDIOTestClient` appropriately for STDIO tests
3. **Regular Updates**: Update tests when API contracts change
4. **Environment Parity**: Ensure tests work across all supported environments and transports
5. **Documentation**: Update this README when adding new test capabilities or changing server management
6. **Port Management**: Always verify port cleanup in HTTP transport tests

### CI/CD Integration
1. **Fast Feedback**: Keep system test suite under 2 minutes total runtime
2. **Parallel Safety**: Ensure tests can run in parallel CI environments
3. **Clear Reporting**: Provide actionable error messages for CI failures
4. **Environment Isolation**: Use separate deployments for testing when possible

## Extending System Tests

### Adding New Test Categories

1. **Create Test File**: `new-category.system.test.ts`
2. **Choose Transport**: Determine if test needs STDIO or HTTP transport
3. **Follow Server Rules**:
   - **For STDIO**: Use `STDIOTestClient` to manage server processes
   - **For HTTP**: Use existing HTTP client, NEVER start HTTP servers
4. **Use Test Utilities**: Import helpers from `utils.ts`
5. **Follow Patterns**: Use `describeSystemTest()` and `isSTDIOEnvironment()` for consistent environment handling
6. **Update Documentation**: Add description to this README

### Adding New Environments

1. **Update `utils.ts`**: Add new environment configuration to `TEST_ENVIRONMENTS`
2. **Add npm Script**: Create new script in `package.json`
3. **Update CI/CD**: Add new environment to deployment pipeline
4. **Document Usage**: Update this README with setup instructions

### Adding Environment Variables

1. **Update Test Logic**: Handle new variables in test assertions
2. **Document Requirements**: Add to configuration section above
3. **Update CI/CD**: Ensure variables are available in CI environment
4. **Provide Defaults**: Use sensible defaults for optional variables

## Key Architecture Decisions

### Why Different Server Management for STDIO vs HTTP?

**STDIO Transport**:
- Each test manages its own server process because STDIO uses process communication
- No port conflicts possible - each process has its own stdin/stdout
- Tests can run in parallel without interference
- Each `STDIOTestClient` instance is isolated

**HTTP Transport**:
- Suite manages one shared server to prevent port conflicts
- Multiple HTTP servers on same port = `EADDRINUSE` errors
- Jest parallel execution can cause race conditions with port binding
- Shared server is more efficient and reliable for HTTP-based testing

### Why Suite-Level Management for HTTP?

The original architecture had each HTTP test file start its own server using `HTTPTestClient`. This caused:
1. **Port conflicts** when Jest ran tests in parallel
2. **Race conditions** during server startup/shutdown
3. **Slow test execution** due to repeated server startup
4. **Unreliable test results** due to port binding failures

The new architecture uses `test/system/setup.ts` to:
1. **Start one HTTP server** before all tests run
2. **Share the server** across all HTTP test files
3. **Clean up ports** automatically before starting
4. **Provide reliable test execution** with faster startup

## Integration with Issue #16

These system tests directly address the requirements in issue #16:

- **Vercel Configuration**: Health tests validate deployment configuration
- **Google OAuth**: Auth tests verify OAuth provider setup
- **LLM Keys**: Tool tests validate LLM provider integration
- **Automated Validation**: All tests run automatically without manual interaction
- **Environment Coverage**: Tests work across STDIO, HTTP, and Vercel environments
- **Transport Coverage**: Both STDIO and HTTP MCP transports are validated

The system test suite provides comprehensive validation that deployments are properly configured and functional across different transport modes.