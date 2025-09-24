# System Testing Documentation

This directory contains end-to-end system tests that validate the complete MCP TypeScript Simple deployment across different environments.

## Overview

System tests verify that the deployed application works correctly in real environments by testing the complete system through its public API endpoints. Unlike unit and integration tests, system tests:

- Make real HTTP requests to deployed endpoints
- Test the complete request/response cycle including authentication
- Validate environment-specific configuration and behavior
- Verify that all components work together in the deployment environment

## Test Structure

### Test Files

- **`health.system.test.ts`** - Health endpoint and deployment validation
- **`auth.system.test.ts`** - Authentication and OAuth configuration
- **`mcp.system.test.ts`** - MCP protocol compliance and functionality
- **`mcp-oauth-compliance.system.test.ts`** - OAuth-enabled MCP protocol compliance
- **`mcp-session-state.system.test.ts`** - MCP session state management validation
- **`oauth-discovery.system.test.ts`** - OAuth discovery endpoint validation
- **`tools.system.test.ts`** - Tool execution and LLM integration
- **`utils.ts`** - Shared utilities and test helpers
- **`setup.ts`** - Global test configuration and setup

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

System tests support four different deployment environments:

### Local Development
```bash
npm run test:system:local
```
- **URL**: `http://localhost:3000`
- **Setup**: Start with `npm run dev:vercel`
- **Use Case**: Development and debugging

### Docker
```bash
npm run test:system:docker
```
- **URL**: `http://localhost:3000`
- **Setup**: Docker container with exposed port
- **Use Case**: Containerized deployment testing

### Vercel Preview
```bash
npm run test:system:preview
```
- **URL**: `https://project-branch.vercel.app` (or set `VERCEL_PREVIEW_URL`)
- **Setup**: Vercel preview deployment from PR
- **Use Case**: Pre-production validation

### Production
```bash
npm run test:system:production
```
- **URL**: `https://project.vercel.app` (or set `VERCEL_PRODUCTION_URL`)
- **Setup**: Production Vercel deployment
- **Use Case**: Production smoke testing

## Configuration

### Environment Variables

#### Required for Testing
- `TEST_ENV` - Target environment (`local`, `docker`, `preview`, `production`)

#### Optional URL Overrides
- `VERCEL_PREVIEW_URL` - Custom preview deployment URL
- `VERCEL_PRODUCTION_URL` - Custom production deployment URL

#### Application Configuration (for deployment)
- `ANTHROPIC_API_KEY` - Claude API key (enables LLM tools)
- `OPENAI_API_KEY` - OpenAI API key (enables LLM tools)
- `GOOGLE_API_KEY` - Google/Gemini API key (enables LLM tools)
- `OAUTH_PROVIDER` - OAuth provider (google, github, microsoft, generic)
- Provider-specific OAuth credentials (CLIENT_ID, CLIENT_SECRET, etc.)

### Test Configuration

The system test configuration is defined in `jest.system.config.js`:

```javascript
// Key configuration options:
testTimeout: 30000,        // 30-second timeout for system tests
maxConcurrency: 1,         // Sequential execution to avoid conflicts
setupFilesAfterEnv: ['<rootDir>/test/system/setup.ts']
```

## Running Tests

### Basic Usage

```bash
# Run all system tests against local environment
npm run test:system

# Run against specific environment
npm run test:system:local
npm run test:system:docker
npm run test:system:preview
npm run test:system:production

# Run specific test file
npx jest --config jest.system.config.js test/system/health.system.test.ts

# Run with verbose output
npm run test:system -- --verbose

# Run with coverage
npm run test:system -- --coverage
```

### Development Workflow

1. **Start Local Server**
   ```bash
   npm run dev:vercel
   ```

2. **Run System Tests**
   ```bash
   npm run test:system:local
   ```

3. **Debug Failing Tests**
   ```bash
   # Run specific test with verbose output
   npx jest --config jest.system.config.js --verbose test/system/health.system.test.ts
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

### HTTP Client
- **axios**: HTTP client for making API requests
- **Configuration**: Automatic request/response logging, timeout handling, CORS validation

### Test Utilities
- **Environment Detection**: Automatic environment configuration based on `TEST_ENV`
- **Server Readiness**: Wait for server availability in local/docker environments
- **Response Validation**: Structured validation helpers for API responses
- **Error Handling**: Graceful handling of deployment and configuration issues

## Test Behavior

### Adaptive Testing
System tests adapt their behavior based on the target environment:

- **Local/Docker**: Wait for server startup, relaxed authentication requirements
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

#### Server Not Ready
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
2. **Environment Awareness**: Adapt test expectations based on target environment
3. **Graceful Degradation**: Handle missing features/credentials gracefully
4. **Performance Conscious**: Set reasonable timeouts for different environments
5. **Clear Logging**: Provide informative output for debugging

### Maintaining Tests
1. **Keep Tests Independent**: Each test should be self-contained
2. **Regular Updates**: Update tests when API contracts change
3. **Environment Parity**: Ensure tests work across all supported environments
4. **Documentation**: Update this README when adding new test capabilities

### CI/CD Integration
1. **Fast Feedback**: Keep system test suite under 2 minutes total runtime
2. **Parallel Safety**: Ensure tests can run in parallel CI environments
3. **Clear Reporting**: Provide actionable error messages for CI failures
4. **Environment Isolation**: Use separate deployments for testing when possible

## Extending System Tests

### Adding New Test Categories

1. **Create Test File**: `new-category.system.test.ts`
2. **Use Test Utilities**: Import helpers from `utils.ts`
3. **Follow Patterns**: Use `describeSystemTest()` for consistent environment handling
4. **Update Documentation**: Add description to this README

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

## Integration with Issue #16

These system tests directly address the requirements in issue #16:

- **Vercel Configuration**: Health tests validate deployment configuration
- **Google OAuth**: Auth tests verify OAuth provider setup
- **LLM Keys**: Tool tests validate LLM provider integration
- **Automated Validation**: All tests run automatically without manual interaction
- **Environment Coverage**: Tests work across development, preview, and production

The system test suite provides comprehensive validation that Vercel deployments are properly configured and functional.