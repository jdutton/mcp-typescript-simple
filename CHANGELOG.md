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
