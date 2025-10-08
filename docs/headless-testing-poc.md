# Headless MCP Inspector Testing POC

**Issue**: #43 - Create system tests that use headless MCP Inspector for automated validation

## Overview

This POC demonstrates automated headless browser testing for MCP servers using Playwright. It establishes the foundation for automated OAuth flow testing and MCP protocol validation without manual intervention.

## What's Implemented

### 1. Playwright Integration

- **Chromium headless browser** for automated testing
- **Server lifecycle management** (start/stop test server on non-default port 3555)
- **Browser automation** for page navigation and interaction
- **Screenshot and video capture** on test failures

### 2. Test Infrastructure

#### Test Files
- `test/system/mcp-inspector-headless.system.test.ts` - Main POC test suite
- `playwright.config.ts` - Playwright configuration

#### NPM Scripts
```bash
npm run test:system:headless        # Run headless tests
npm run test:system:headless:ui     # Run with Playwright UI
npm run test:system:headless:debug  # Run with debugging enabled
```

### 3. Demonstrated Capabilities

✅ **Server Management**
- Spawn MCP server on custom port (avoiding conflicts)
- Health check verification
- Graceful shutdown

✅ **Browser Automation**
- Navigate to server pages (health, docs)
- Extract and verify page content
- Automated interaction capability (click, fill forms, etc.)

✅ **Test Framework**
- Playwright test runner integration
- Comprehensive assertions
- Clear logging and debugging

## Current Limitations (POC Scope)

❌ **OAuth Flow Automation** - Simulated only
- Currently returns mock token
- Real OAuth mock provider not implemented
- Browser automation framework ready for implementation

❌ **MCP Protocol Testing** - Not fully integrated
- MCP endpoints use StreamableHTTPServerTransport (SSE-based)
- Requires SSE client support for real protocol testing
- MCP Inspector CLI integration placeholder only

❌ **Authentication Testing** - Uses MCP_DEV_SKIP_AUTH
- Tests run with authentication disabled
- Real OAuth consent screen automation not implemented

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              Playwright Test Suite                  │
│                                                     │
│  ┌──────────────┐        ┌──────────────────────┐ │
│  │   Browser    │        │   Test MCP Server    │ │
│  │ (Chromium)   │───────▶│   (Port 3555)        │ │
│  │              │ HTTP   │   MCP_DEV_SKIP_AUTH  │ │
│  └──────────────┘        └──────────────────────┘ │
│         │                                           │
│         │                                           │
│         ▼                                           │
│  ┌──────────────────────────────────────────────┐  │
│  │     Future: OAuth Flow Automation            │  │
│  │  - Provider selection                        │  │
│  │  - Consent screen interaction                │  │
│  │  - Token extraction                          │  │
│  └──────────────────────────────────────────────┘  │
│         │                                           │
│         ▼                                           │
│  ┌──────────────────────────────────────────────┐  │
│  │     Future: MCP Inspector CLI Integration    │  │
│  │  - Tool listing                              │  │
│  │  - Tool execution                            │  │
│  │  - Protocol compliance validation            │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Next Steps for Full Implementation

### Phase 1: OAuth Mock Provider
**Goal**: Enable real browser-based OAuth flow automation

1. **Implement Mock OAuth Server**
   - Create mock OAuth provider endpoints (`/auth/mock/*`)
   - Auto-approve consent screens
   - Generate valid test tokens
   - Environment flag: `OAUTH_MOCK_MODE=true`

2. **Update Test Framework**
   - Implement real browser OAuth flow navigation
   - Extract tokens from callback URLs
   - Handle OAuth error scenarios

**Estimated Effort**: 4-6 hours

### Phase 2: MCP Protocol Testing
**Goal**: Test MCP protocol compliance via Inspector

1. **SSE Client Integration**
   - Add EventSource support for SSE transport
   - Implement MCP JSON-RPC message handling
   - Test tools/list, tools/call, resources/list

2. **MCP Inspector CLI Integration**
   - Test Inspector CLI availability
   - Execute Inspector commands programmatically
   - Validate responses and protocol compliance

**Estimated Effort**: 6-8 hours

### Phase 3: CI/CD Integration
**Goal**: Run headless tests in GitHub Actions

1. **CI Configuration**
   - Add Playwright to GitHub Actions workflow
   - Configure browser binaries caching
   - Parallel test execution

2. **Test Reporting**
   - Artifact upload for screenshots/videos
   - HTML test reports
   - Slack/Discord notifications on failure

**Estimated Effort**: 2-3 hours

## Alternative Approaches Considered

### 1. MCP Inspector CLI Only (No Browser)
**Pros**: Simpler, faster
**Cons**: Cannot test real OAuth flows, misses browser-specific issues

### 2. Puppeteer Instead of Playwright
**Pros**: Smaller, more established
**Cons**: Less modern API, weaker TypeScript support, Chromium-only

### 3. Direct JSON-RPC Testing (No Inspector)
**Pros**: Fastest, most direct
**Cons**: Doesn't validate Inspector compatibility, misses integration issues

## Running the POC

```bash
# Install dependencies (if not already done)
npm install

# Run headless tests
npm run test:system:headless

# Run with UI for debugging
npm run test:system:headless:ui

# Run with verbose output
VERBOSE_TEST=true npm run test:system:headless
```

## Test Output Example

```
Running 3 tests using 1 worker

🚀 Starting test MCP server on port 3555
✅ Test server ready
🔐 Simulating OAuth flow (POC - auth disabled)
✅ Server has auth disabled (POC mode)
✅ Server accessible via headless browser

✅ POC COMPLETE: Headless browser automation successful
ℹ️  Next steps:
   1. Implement OAuth mock provider for automated flow
   2. Add SSE transport support for MCP testing
   3. Integrate MCP Inspector CLI with authenticated sessions

✅ Health check passed
✅ Navigated to docs page: "MCP TypeScript Simple API Reference"
✅ Headless browser can navigate and interact with pages

3 passed (6.7s)
```

## Key Findings

1. **Playwright Integration is Solid**
   - Reliable browser automation
   - Excellent TypeScript support
   - Rich debugging capabilities

2. **Server Management Works Well**
   - Clean startup/shutdown
   - Non-default ports prevent conflicts
   - Health checks reliable

3. **OAuth Automation is Feasible**
   - Framework supports form filling
   - Can handle redirects
   - Token extraction strategies clear

4. **MCP Inspector Integration Possible**
   - CLI mode exists and documented
   - HTTP transport supported
   - Authentication header support confirmed

## Conclusion

This POC successfully demonstrates that **automated headless testing for MCP servers with OAuth flows is technically viable and architecturally sound**. The foundation is in place for full implementation following the phased approach outlined above.

The main technical challenge is implementing the OAuth mock provider for test automation, which is straightforward given Playwright's capabilities. The MCP protocol testing via Inspector CLI is well-documented and ready for integration.

**Recommendation**: Proceed with Phase 1 (OAuth Mock Provider) as it provides immediate value for catching OAuth-related bugs automatically.
