# Developer Testing Tools

This directory contains manual testing and development utilities for the MCP TypeScript Simple server. These tools are designed for interactive use during development and debugging, complementing the automated test suite in the `test/` directory.

**Note**: This directory has been streamlined to contain only tools that provide unique value that cannot be replaced by automated testing or official development workflows. For most testing needs, use the comprehensive automated test suite (`npm run test:ci`) or official development environments (`npm run dev:vercel`).

## Tool Standards

**TypeScript First**: All tools should be written in TypeScript where possible for consistency, type safety, and maintainability.

**Direct Execution**: All TypeScript tools use the shebang `#!/usr/bin/env -S npx tsx` and are executable directly from the command line:
```bash
# Direct execution (preferred)
./tools/test-oauth.ts --help

# Alternative npx execution
npx tsx tools/test-oauth.ts --help
```

**Consistent Help**: All tools support `--help` and `-h` flags with comprehensive usage documentation.

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

The tools directory now contains **carefully curated tools** that provide unique value that cannot be replicated through automated testing:

### Branch Sync Management - `sync-check.ts` & `pre-commit-check.ts`
Smart branch synchronization and pre-commit workflow automation.

**Purpose**: Simplify branch sync checking and pre-commit validation while maintaining safety and conflict visibility

**Usage**:
```bash
# Check if branch is behind origin/main (safe, no auto-merge)
npm run sync-check
./tools/sync-check.ts

# Check only, minimal output
npm run sync-check -- --check-only

# Complete pre-commit workflow (sync check + validation)
npm run pre-commit
./tools/pre-commit-check.ts

# Skip sync check, only run validation
npm run pre-commit -- --skip-sync
```

**Features**:
- **Safety-first approach**: Never auto-merges, preserves conflict visibility
- **Clear exit codes**: Success/failure signals for Claude Code integration
- **Cross-platform compatibility**: Works on Windows, Mac, and Linux
- **Automated validation**: Runs full typecheck, lint, test, and build pipeline
- **Explicit instructions**: Tells developers exactly what to do when manual intervention needed
- **Smart stopping**: Stops workflow when merge conflicts need manual resolution

**Command-Line Options**:
- `sync-check`:
  - `--check-only` or `-c` - Check status without providing next-step instructions
- `pre-commit-check`:
  - `--skip-sync` or `-s` - Skip branch sync check, only run validation

**Exit Codes**:
- `0` - Success (up to date or no remote)
- `1` - Manual action needed (merge required)
- `2` - Error condition (git issues, validation failures)

### OAuth Flow Testing - `test-oauth.ts`
Interactive OAuth authentication flow testing and validation.

**Purpose**: Test OAuth providers, token validation, and authentication workflows across deployment modes

**Usage**:
```bash
# Test server health (default local)
./tools/test-oauth.ts

# Interactive OAuth flow testing
./tools/test-oauth.ts --flow --provider google

# Test with existing access token
./tools/test-oauth.ts --token <your_access_token>

# Test against Vercel deployment
./tools/test-oauth.ts --url https://myapp.vercel.app --flow

# Start server and test (local only)
./tools/test-oauth.ts --start
```

**Features**:
- Multi-deployment mode support (local, Docker, Vercel)
- Command-line parameter configuration (no environment variables)
- Interactive OAuth provider testing
- Token validation and MCP endpoint testing
- Support for Google, GitHub, Microsoft, and generic OAuth
- Session management testing
- Health check validation

**Command-Line Options**:
- `--url <url>` - Server URL (default: http://localhost:3000)
- `--provider <provider>` - OAuth provider: google|github|microsoft|generic
- `--flow` - Test interactive OAuth flow
- `--token <token>` - Test with existing access token
- `--start` - Start local server and test

### Official Vercel Development
For Vercel serverless function development, use the official Vercel CLI instead of custom mock servers.

**Purpose**: Test Vercel API functions in authentic serverless environment

**Usage**:
```bash
# Official Vercel development (recommended)
npm run dev:vercel

# Or use Vercel CLI directly
npx vercel dev --listen 3000
```

**Features**:
- **Authentic Vercel runtime** - real serverless function execution
- **Real VercelRequest/VercelResponse objects** - not mocks
- **Official routing** - uses `vercel.json` configuration exactly
- **Environment variable handling** - matches production behavior
- **Hot reloading** - built-in file watching and recompilation
- **Production parity** - closest to actual deployment environment

**Endpoints Available**:
- `http://localhost:3000/api/health` - Health check
- `http://localhost:3000/api/mcp` - MCP protocol endpoint
- `http://localhost:3000/api/auth` - OAuth authentication
- `http://localhost:3000/api/admin` - Administration and metrics

**Setup**: See [Vercel Local Development Guide](../docs/vercel-local-development.md) for authentication and configuration.


### Automated MCP Testing
For MCP protocol testing, use the comprehensive automated test suite instead of manual tools.

**Purpose**: Validate MCP protocol compliance and functionality

**Usage**:
```bash
# Full MCP testing suite (recommended)
npm run test:ci          # Includes MCP protocol compliance
npm run test:mcp         # Direct MCP STDIO client testing
npm run test:transport   # HTTP transport and CORS testing
```

**Features**:
- **Real MCP client communication** - actual STDIO protocol testing
- **Protocol compliance validation** - JSON-RPC 2.0 specification adherence
- **Tool execution testing** - validates all available MCP tools
- **Transport layer testing** - HTTP, CORS, streaming, error handling
- **Integration testing** - end-to-end MCP workflow validation

**Advantages over manual testing**:
- **Authentic MCP runtime** - tests real protocol implementation, not mocks
- **Comprehensive coverage** - validates entire MCP ecosystem
- **Automated execution** - suitable for CI/CD pipelines
- **Production parity** - tests actual deployment scenarios


## Development Workflow

### When to Use These Tools

#### During Feature Development
- Use `npm run pre-commit` for comprehensive pre-commit validation
- Use `npm run sync-check` to check branch sync status safely
- Use `npm run dev:vercel` for authentic Vercel serverless function testing
- Use `npm run test:mcp` to validate MCP protocol changes

#### During OAuth Implementation
- Use `./tools/test-oauth.ts --flow` to test authentication flows
- Use `./tools/test-oauth.ts --token` to validate token handling
- Test multiple OAuth providers systematically

#### During Debugging
- Use `npm run dev:vercel` for end-to-end workflow testing in authentic Vercel environment
- Use `npm run test:mcp` for protocol compliance validation

### Integration with Development Commands

These tools complement the standard development workflow:

```bash
# Standard development
npm run dev:vercel          # Official Vercel development (recommended)

# Branch sync and pre-commit
npm run sync-check          # Check branch sync status (safe, no auto-merge)
npm run pre-commit          # Complete pre-commit workflow

# OAuth testing
npm run dev:oauth           # Development with OAuth enabled
./tools/test-oauth.ts --flow        # Interactive OAuth testing

# MCP and API testing
npm run test:ci             # Comprehensive test suite
npm run test:mcp            # MCP protocol testing
```

## Testing Scenarios

### Branch Sync and Pre-Commit Validation
1. Check branch status: `npm run sync-check`
2. Run full pre-commit check: `npm run pre-commit`
3. If merge needed: `git merge origin/main` then `npm run pre-commit`

### OAuth Flow Validation
1. Start with health check: `./tools/test-oauth.ts`
2. Test interactive flow: `./tools/test-oauth.ts --flow`
3. Validate tokens: `./tools/test-oauth.ts --token <token>`

### Vercel Development Testing
1. Start official Vercel development server: `npm run dev:vercel`
2. Test endpoints manually or with curl against authentic Vercel environment

### MCP Protocol Testing
1. Run full test suite: `npm run test:ci` (includes MCP protocol compliance)
2. Test MCP client communication: `npm run test:mcp` (STDIO protocol testing)
3. Test HTTP transport layer: `npm run test:transport` (CORS, streaming, etc.)
4. Debug with official Vercel environment: `npm run dev:vercel` (authentic runtime)

## Environment Setup

### Required Environment Variables
```bash
# LLM Providers (for tool testing)
ANTHROPIC_API_KEY=your_claude_key
OPENAI_API_KEY=your_openai_key
GOOGLE_API_KEY=your_gemini_key

# OAuth Configuration (for auth testing - server auto-detects providers)
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
- **Browser not opening**: Verify OAuth provider credentials are configured
- **Token validation fails**: Verify client ID/secret and redirect URLs
- **Server not responding**: Ensure server is running on correct port

#### Vercel Development Issues
- **Vercel CLI not found**: Install with `npm install -g vercel`
- **Authentication required**: Run `npx vercel login` first
- **API functions not loading**: Run `npm run build` first
- **Import errors**: Check that build output exists in `build/` directory
- **Port conflicts**: Use `--listen <port>` to specify different port

#### MCP Testing Issues
- **Protocol errors**: Verify MCP SDK version compatibility with `npm run test:mcp`
- **Tool execution fails**: Check LLM provider API keys in environment variables
- **Transport errors**: Run `npm run test:transport` to validate HTTP layer

### Debug Mode
Most tools support verbose logging for debugging:

```bash
# Enable debug logging
NODE_ENV=development ./tools/test-oauth.ts --flow
NODE_ENV=development npm run dev:vercel
```

## Contributing

**High Bar for New Tools**: Only add tools that provide genuinely unique value that cannot be achieved through automated testing or official development workflows.

When adding new development tools:

1. **Justify unique value**: Tool must provide functionality not available in automated tests or official development tools
2. **Follow naming convention**: `test-<feature>-<type>.ts`
3. **Use TypeScript**: All new tools should be written in TypeScript with proper shebang
4. **Add executable shebang**: Use `#!/usr/bin/env -S npx tsx` and make file executable with `chmod +x`
5. **Add comprehensive --help**: Include usage, description, options, examples, and deployment mode guidance
6. **Add to this README**: Document purpose, usage, and features, and why it can't be replaced by automated testing
7. **Include error handling**: Proper error messages and recovery
8. **Add usage examples**: Clear command-line examples showing direct execution (./tools/tool-name.ts)
9. **Update main README**: Reference new tools in development section

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
- Interactive development workflows (OAuth flows requiring browser interaction)
- Human verification workflows (authentication testing, token validation)
- Scenarios requiring manual inspection or interaction

Use automated tests for validation and manual tools only for workflows that cannot be automated (like OAuth browser flows).