# Developer Testing Tools

This directory contains manual testing and development utilities for the MCP TypeScript Simple server. These tools are designed for interactive use during development and debugging, complementing the automated test suite in the `test/` directory.

## Tool Categories

### Interactive Testing Tools
Tools that require user interaction or browser-based workflows.

### Development Servers
Long-running processes that create local testing environments.

### API Debugging Tools
Direct function testing and inspection utilities.

### Manual Validation Scripts
Tools requiring human verification and inspection.

## Available Tools

### OAuth Flow Testing - `test-oauth.js`
Interactive OAuth authentication flow testing and validation.

**Purpose**: Test OAuth providers, token validation, and authentication workflows

**Usage**:
```bash
# Test server health
node tools/test-oauth.js

# Interactive OAuth flow testing (opens browser)
node tools/test-oauth.js --flow

# Test with existing access token
node tools/test-oauth.js --token <your_access_token>

# Start server and test
node tools/test-oauth.js --start
```

**Features**:
- Health check validation
- Interactive OAuth provider testing
- Token validation and MCP endpoint testing
- Support for Google, GitHub, Microsoft, and generic OAuth
- Session management testing

**Environment Variables**:
```bash
OAUTH_PROVIDER=google|github|microsoft|generic
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
SERVER_URL=http://localhost:3000  # Override server URL
```

### Vercel Local Development Server - `test-vercel-local.ts`
Mock Vercel serverless environment for local development and testing.

**Purpose**: Test Vercel API functions locally without deploying

**Usage**:
```bash
npx tsx tools/test-vercel-local.ts
```

**Features**:
- Runs all API endpoints locally: `/api/health`, `/api/mcp`, `/api/auth`, `/api/admin`
- Mock VercelRequest/VercelResponse objects
- Real-time request logging
- Error handling and debugging
- Hot reloading on file changes

**Endpoints Available**:
- `http://localhost:3000/api/health` - Health check
- `http://localhost:3000/api/mcp` - MCP protocol endpoint
- `http://localhost:3000/api/auth` - OAuth authentication
- `http://localhost:3000/api/admin` - Administration and metrics

### Direct API Function Testing - `test-api-direct.ts`
Direct testing of individual Vercel API functions with mock objects.

**Purpose**: Unit test individual API functions without HTTP layer

**Usage**:
```bash
npx tsx tools/test-api-direct.ts
```

**Features**:
- Direct function invocation
- Mock VercelRequest/VercelResponse creation
- Individual endpoint testing
- Response validation
- Error scenario testing

### MCP Endpoint Testing - `test-mcp-api.ts`
Focused testing of the MCP protocol endpoint with various request scenarios.

**Purpose**: Test MCP protocol implementation and tool execution

**Usage**:
```bash
npx tsx tools/test-mcp-api.ts
```

**Features**:
- MCP protocol compliance testing
- Tool execution validation
- JSON-RPC request/response testing
- Content-type negotiation testing
- Error handling validation

### MCP Interface Testing - `test-mcp-fixed.ts`
Advanced MCP testing with proper Node.js HTTP interfaces.

**Purpose**: Test MCP implementation with real Node.js HTTP objects

**Usage**:
```bash
npx tsx tools/test-mcp-fixed.ts
```

**Features**:
- Real Node.js IncomingMessage/ServerResponse objects
- Proper HTTP interface testing
- Stream handling validation
- Low-level transport testing

## Development Workflow

### When to Use These Tools

#### During Feature Development
- Use `test-vercel-local.ts` to test API changes locally
- Use `test-api-direct.ts` to debug specific function issues
- Use `test-mcp-api.ts` to validate MCP protocol changes

#### During OAuth Implementation
- Use `test-oauth.js --flow` to test authentication flows
- Use `test-oauth.js --token` to validate token handling
- Test multiple OAuth providers systematically

#### During Debugging
- Use direct API testing for isolated function debugging
- Use local Vercel server for end-to-end workflow testing
- Use MCP testing for protocol compliance validation

### Integration with Development Commands

These tools complement the standard development workflow:

```bash
# Standard development
npm run dev:vercel          # Official Vercel development
npx tsx tools/test-vercel-local.ts  # Alternative local testing

# OAuth testing
npm run dev:oauth           # Development with OAuth enabled
node tools/test-oauth.js --flow     # Interactive OAuth testing

# API debugging
npm run test:ci             # Automated test suite
npx tsx tools/test-api-direct.ts    # Manual API debugging
```

## Testing Scenarios

### OAuth Flow Validation
1. Start with health check: `node tools/test-oauth.js`
2. Test interactive flow: `node tools/test-oauth.js --flow`
3. Validate tokens: `node tools/test-oauth.js --token <token>`

### Vercel Development Testing
1. Start local server: `npx tsx tools/test-vercel-local.ts`
2. Test endpoints manually or with curl
3. Debug issues with direct API testing

### MCP Protocol Debugging
1. Test protocol compliance: `npx tsx tools/test-mcp-api.ts`
2. Test with real HTTP objects: `npx tsx tools/test-mcp-fixed.ts`
3. Validate tool execution and responses

## Environment Setup

### Required Environment Variables
```bash
# LLM Providers (for tool testing)
ANTHROPIC_API_KEY=your_claude_key
OPENAI_API_KEY=your_openai_key
GOOGLE_API_KEY=your_gemini_key

# OAuth Configuration (for auth testing)
OAUTH_PROVIDER=google
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Development Configuration
NODE_ENV=development
MCP_MODE=streamable_http
```

### Local Development Setup
1. Install dependencies: `npm install`
2. Build project: `npm run build`
3. Configure environment variables in `.env`
4. Run desired testing tool

## Troubleshooting

### Common Issues

#### OAuth Testing Issues
- **Browser not opening**: Check `OAUTH_PROVIDER` configuration
- **Token validation fails**: Verify client ID/secret and redirect URLs
- **Server not responding**: Ensure server is running on correct port

#### Vercel Local Testing Issues
- **API functions not loading**: Run `npm run build` first
- **Import errors**: Check that build output exists in `build/` directory
- **Port conflicts**: Modify port in script or stop conflicting processes

#### MCP Testing Issues
- **Protocol errors**: Verify MCP SDK version compatibility
- **Tool execution fails**: Check LLM provider API keys
- **Transport errors**: Ensure proper request/response object mocking

### Debug Mode
Most tools support verbose logging for debugging:

```bash
# Enable debug logging
DEBUG=* npx tsx tools/test-vercel-local.ts
NODE_ENV=development node tools/test-oauth.js --flow
```

## Contributing

When adding new development tools:

1. **Follow naming convention**: `test-<feature>-<type>.ts/js`
2. **Add to this README**: Document purpose, usage, and features
3. **Include error handling**: Proper error messages and recovery
4. **Add usage examples**: Clear command-line examples
5. **Update main README**: Reference new tools in development section

### Tool Categories for New Scripts
- **Interactive Tools**: Require user input or interaction
- **Server Tools**: Long-running processes for testing
- **Debug Tools**: Direct function or API testing
- **Validation Tools**: Manual verification workflows

## Related Documentation

- [Main README.md](../README.md) - Project overview and setup
- [Vercel Local Development](../docs/vercel-local-development.md) - Official Vercel development guide
- [Architecture](../docs/architecture.md) - System architecture overview
- [OAuth Setup](../docs/oauth-setup.md) - OAuth configuration guide

## Automated vs Manual Testing

**Automated Tests** (`test/` directory):
- Run by CI/CD pipelines
- Non-interactive execution
- Regression testing and validation
- Protocol compliance checking

**Manual Testing Tools** (`tools/` directory):
- Interactive development workflows
- Browser-based testing
- Local environment debugging
- Human verification required

Use automated tests for validation and manual tools for development and debugging workflows.