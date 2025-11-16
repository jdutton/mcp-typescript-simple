# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Plugin architecture for extensible MCP server framework
- Enhanced documentation and examples
- Community contribution guidelines

---

## [0.9.0-rc.4] - 2025-11-16

### Added
- **Production-ready scaffolding tool** (`create-mcp-typescript-simple`)
  - Generate MCP servers with `npm create @mcp-typescript-simple@latest my-server`
  - Full-featured by default: OAuth, LLM tools, Docker deployment, comprehensive testing
  - Graceful degradation: works without API keys or OAuth credentials
  - Validation pipeline with [vibe-validate](https://github.com/jdutton/vibe-validate) (312x faster with caching)
  - Port isolation prevents test conflicts (configurable BASE_PORT)
  - Unique encryption keys generated per project

### Changed
- **Scaffolding templates updated** for production readiness
  - vibe-validate integration with schema validation, secret scanning, and pre-commit hooks
  - ESLint v9 flat config format (replaces deprecated .eslintrc.json)
  - Comprehensive test infrastructure (unit + system tests with parallel execution)
  - Environment configuration with 5 .env files for different deployment modes

---

## [0.9.0-rc.3] - 2025-11-15

### Fixed
- **Removed hardcoded example tool dependencies from framework packages** (Critical architectural flaw)
  - **Problem**: Framework packages (`http-server`, `server`) imported example tools directly, forcing users to install unnecessary dependencies
  - **Root Cause**: `http-server` hardcoded imports of `@mcp-typescript-simple/example-tools-basic` and `@mcp-typescript-simple/example-tools-llm`
  - **Solution**: Removed example imports; tool registration now user-controlled via `ToolRegistry` parameter
  - **Impact**: Users can now use framework packages without installing example tools; cleaner dependency tree

- **Fixed missing peer dependencies in framework packages**
  - **Problem**: `http-server` package used libraries (helmet, cors, express-openapi-validator, etc.) without declaring them as dependencies
  - **Solution**: Added proper dependencies to `http-server` and `auth` packages
  - **Impact**: Consumers no longer need to manually install peer dependencies
  - **Added dependencies**:
    - `@mcp-typescript-simple/http-server`: helmet, cors, express-openapi-validator, swagger-ui-express, yaml, ajv, ajv-formats
    - `@mcp-typescript-simple/auth`: google-auth-library

### Changed
- **Tool registration is now user-controlled**: Framework no longer auto-registers tools; users pass `ToolRegistry` to `transport.initialize()`
- **Updated example-mcp**: Demonstrates correct pattern for registering tools before starting server
- **Integration test coverage expanded**: Now running 15 test files (185 tests) via wildcard patterns, up from only 2 files previously
  - Created `vitest.integration.config.ts` for wildcard pattern matching
  - Discovered 14 hidden test files that weren't being run in rc2
  - All discovered tests now passing (except pre-existing OCSF middleware failures - see Known Issues)

### Fixed (Testing)
- **Fixed toolRegistry not passed to MCPStreamableHttpServer** (Critical bug discovered during test expansion)
  - **Problem**: System tests spawned HTTP server without toolRegistry, causing tools.list() to return empty array
  - **Root Cause**: `StreamableHTTPTransportManager.initialize()` created `MCPStreamableHttpServer` without passing `toolRegistry` parameter
  - **Solution**: Added `toolRegistry: this.toolRegistry` to MCPStreamableHttpServer constructor options
  - **Impact**: HTTP transport now correctly initializes with configured tools; all 161 system tests passing

- **Fixed brittle integration test assertions**
  - **Problem**: Tests used exact tool count (`=== 3`) but LLM tools dynamically added when API keys present
  - **Solution**: Changed assertions to minimum count (`>= 3`) to handle optional LLM tools gracefully
  - **Impact**: Tests now pass regardless of LLM tool availability (3 basic tools + 4 optional LLM tools)

- **Fixed OCSF middleware integration tests** (9 tests - pre-existing failures from rc2)
  - **Problem**: `emitOCSFEvent()` called 0 times in tests when running full integration suite (tests passed in isolation)
  - **Root Cause**: OCSF-OTEL bridge singleton created by other tests before OCSF middleware tests ran, preventing mocks from being applied
  - **Solution**:
    - Added `resetOCSFOTELBridge()` function to reset singleton state
    - Changed from `beforeAll`/`afterAll` to `beforeEach`/`afterEach` for proper test isolation
    - Mock OpenTelemetry LoggerProvider before each test to ensure clean state
  - **Impact**: All 9 OCSF middleware tests now pass in both isolation and full integration suite
  - **Files changed**:
    - `packages/observability/src/ocsf/ocsf-otel-bridge.ts`: Added `resetOCSFOTELBridge()` function
    - `packages/observability/src/ocsf/index.ts`: Export `resetOCSFOTELBridge` for test use
    - `packages/observability/src/index.ts`: Export `resetOCSFOTELBridge` from main observability package
    - `packages/http-server/test/integration/ocsf-middleware.integration.test.ts`: Use `beforeEach`/`afterEach` with singleton reset

---

## [0.9.0-rc.2] - 2025-11-14

### Fixed
- **Fixed broken npm packages in 0.9.0-rc.1** (Critical bug)
  - **Problem**: Published packages were missing their compiled `dist/` directories, making them completely unusable
  - **Root Cause**: Missing `files` field in 9 out of 13 packages caused npm to respect `.gitignore` which excludes `dist/`
  - **Solution**: Added `files: ["dist", "LICENSE"]` to all package.json files
  - **Impact**: Packages now include compiled JavaScript and TypeScript definitions for proper installation

- **Fixed npm publish failure for prerelease versions**
  - **Problem**: `npm publish` failed with "You must specify a tag using --tag when publishing a prerelease version"
  - **Solution**: Added `--tag next` to all publish scripts for proper npm dist-tag management
  - **Impact**: Prerelease versions now publish successfully to npm registry under `next` tag

### Changed
- **Standardized LICENSE distribution**: All packages now include LICENSE file for proper licensing transparency
- **Consistent package metadata**: Removed non-existent README.md references from packages that don't have them

## [0.9.0-rc.1] - 2025-11-14

### Added - Core Framework
- **Enterprise-grade MCP server framework** with comprehensive TypeScript support
- **Dual-mode operation**: STDIO (traditional MCP) + Streamable HTTP with OAuth
- **Plugin-ready architecture** foundation for extensible server design
- **Multi-LLM integration**: Claude (Anthropic), OpenAI GPT, and Google Gemini with type-safe provider selection
- **Vercel serverless deployment**: Production-ready serverless functions with auto-scaling

### Added - Authentication & Security
- **OAuth 2.1 authentication** with PKCE and Dynamic Client Registration (RFC 7591)
- **Multi-provider OAuth**: Google, GitHub, and Microsoft identity providers
- **OAuth client state preservation**: Support for managed OAuth flows (Claude Code, MCP Inspector)
- **AES-256-GCM encryption**: All token storage encrypted at rest
- **Admin endpoint protection**: Bearer token authentication for administrative routes
- **Input validation middleware**: ReDoS and path traversal protection
- **Rate limiting**: DoS protection (100 requests per 15 minutes per IP)
- **Security headers**: Helmet.js integration with CSP, X-Frame-Options, etc.

### Added - Observability & Monitoring
- **OpenTelemetry integration**: Full LGTM stack support (Logs, Traces, Metrics)
- **OCSF security logging**: Structured audit events following OCSF 1.0 standard
- **Grafana dashboards**: Pre-configured observability dashboards
- **Console log fallback**: OCSF events visible even without OTLP endpoint

### Added - Session Management
- **Redis session storage**: Horizontal scaling support for multi-instance deployments
- **In-memory sessions**: Fast development mode with zero external dependencies
- **Session encryption**: All session data encrypted with configurable TTL
- **Cross-instance compatibility**: Seamless session sharing across Vercel serverless functions

### Added - Infrastructure
- **Comprehensive testing**: 948 unit tests + integration tests + system tests with Vitest
- **vibe-validate integration**: Git tree hash-based validation caching (312x speedup)
- **Self-healing port management**: Automatic cleanup of leaked test processes
- **CI/CD pipeline**: GitHub Actions with 10 validation phases
- **Security validation**: Automated scanning for secrets, admin endpoint protection, PII in logs
- **Docker support**: Multi-node load-balanced deployment with nginx
- **Playwright testing**: Headless browser tests for OAuth flows

### Added - Developer Experience
- **OpenAPI 3.1 specification**: Complete API documentation with Swagger UI and Redoc
- **Interactive API testing**: Swagger UI at `/api-docs` with OAuth integration
- **Comprehensive documentation**: Architecture Decision Records (ADRs), deployment guides, security policies
- **Pre-commit hooks**: Automated validation with gitleaks secret scanning
- **Hot reloading**: Auto-recompile and restart in development mode

### Security - Issue #89 Implementation
- **Security score improvement**: 71.5/100 → 93/100 (Production-Ready)
- **CRITICAL fixes implemented**:
  - Unprotected admin endpoints secured with Bearer token authentication
  - Weak allowlist enforcement strengthened with mandatory production checks
  - Secrets management abstraction with 5-provider support (Vault, Vercel Edge Config, etc.)
- **Defense-in-depth mitigations**:
  - Input validation middleware blocking malicious requests before routing
  - Rate limiting preventing brute-force and DoS attacks
  - OCSF audit logging for security event tracking and compliance
- **Zero hardcoded secrets**: All credentials externalized to environment variables
- **Comprehensive security documentation**: Red team audit, shift-left recommendations, compliance mapping

### Documentation
- **26 comprehensive guides** covering deployment, security, testing, and architecture
- **Security audit report**: npm publication readiness assessment
- **Compliance mapping**: SOC-2, ISO 27001, GDPR, HIPAA, PCI-DSS guidance
- **API reference**: Auto-generated from OpenAPI specification
- **Migration guides**: Template → npm framework migration strategies

### Technical Debt Addressed
- Migrated from Jest to Vitest (181/294 tests passing, migration in progress)
- Eliminated circular dependencies in test environments
- Fixed 6 critical resource leaks in test suite
- Standardized error handling across all packages
- Unified CORS configuration for localhost and production

### Known Limitations
- **npm vulnerabilities**: 19 known vulnerabilities (6 HIGH) in @vercel packages - accepted risk with mitigations in place
- **Plugin architecture**: Foundation present but not yet exposed as public API
- **Vitest migration**: Ongoing migration from Jest (see docs/vitest-migration.md)

---

## Release Candidate Notes

**This is a release candidate (0.9.0-rc.1)** for the first public npm release. We're seeking early adopter feedback before the 1.0.0 stable release.

**Target Audience**: Developers building production MCP servers requiring enterprise security, observability, and multi-LLM support.

**Feedback Welcome**:
- **GitHub Issues**: https://github.com/jdutton/mcp-typescript-simple/issues
- **Discussions**: https://github.com/jdutton/mcp-typescript-simple/discussions
- **Security**: security@[domain] (TBD)

**Before 1.0.0 Stable**:
- Complete plugin architecture public API
- Finish Vitest migration
- Gather and incorporate community feedback
- API stability freeze

---

## Version History

### Pre-Release Development (Private Repository)
- 2025-10-24: Security audit and hardening (Issue #89)
- 2025-10-18: OCSF structured logging implementation
- 2025-10-15: Multi-provider OAuth support
- 2025-10-08: Vercel serverless deployment
- 2025-09-28: Redis session management
- 2025-09-18: Initial OAuth implementation
- 2025-09-15: Project inception

---

## CHANGELOG Writing Guidelines

**For Maintainers**: Follow these guidelines when updating CHANGELOG.md:

### User-Focused Writing
Write for users (developers using the framework), not internal developers:

**❌ BAD** (internal details):
- "Updated `init.ts` to use `generateYamlConfig()` function"
- "Added 11 new tests for schema validation"
- "Refactored `packages/auth/src/factory.ts` exports"

**✅ GOOD** (user impact):
- "`mcp init` now correctly generates YAML config files"
- "Fixed IDE autocomplete for YAML configs"
- "OAuth authentication now works with all major providers"

### Structure: Problem → Solution → Impact
```markdown
### Bug Fixes
- **Fixed broken OAuth redirect** (Issue #45)
  - **Problem**: OAuth callback URLs were incorrectly constructed in production
  - **Solution**: Redirect URIs now respect VERCEL_URL environment variable
  - **Impact**: OAuth flows work correctly in Vercel deployments
```

### Categories
- **Added**: New features users can use
- **Changed**: Changes to existing functionality
- **Deprecated**: Features being phased out
- **Removed**: Features removed
- **Fixed**: Bug fixes users will notice
- **Security**: Security improvements

### Release Process
1. During development: Add changes to **[Unreleased]** section
2. Before release: Move **[Unreleased]** changes to versioned section (e.g., **[0.9.0] - 2025-11-14**)
3. After release: Create new empty **[Unreleased]** section for next cycle

---

**Note**: This CHANGELOG follows semantic versioning and human-focused writing. Technical implementation details belong in commit messages, not here.
