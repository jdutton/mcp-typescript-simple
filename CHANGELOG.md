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

## [0.9.0-rc.8] - 2025-11-16

### Initial npm Release

**First public release** of mcp-typescript-simple - a production-ready TypeScript framework for building Model Context Protocol (MCP) servers with enterprise security, multi-LLM integration, and serverless deployment.

**Quick Start**:
```bash
# Bootstrap a new MCP server (interactive prompts)
npm create @mcp-typescript-simple@next my-server

# Or use defaults
npm create @mcp-typescript-simple@next my-server --yes

# Start development
cd my-server
npm run dev:stdio        # STDIO mode (MCP Inspector)
npm run dev:http         # HTTP mode (skip auth - dev only)
npm run dev:oauth        # HTTP mode with OAuth
```

**Generated projects include**: OAuth authentication, LLM-powered tools, Docker deployment, comprehensive testing, and validation pipeline. Works without API keys (graceful degradation).

---

### Added - Scaffolding Tool

- **`npm create @mcp-typescript-simple@next`** - Production-ready project generator
  - Full-featured by default: OAuth, LLM tools, Docker deployment, comprehensive testing
  - Graceful degradation: works without API keys or OAuth credentials
  - Port isolation: configurable BASE_PORT prevents conflicts when developing multiple servers
  - Unique encryption keys: auto-generated AES-256-GCM keys per project
  - Validation pipeline: [vibe-validate](https://github.com/jdutton/vibe-validate) with 312x caching speedup
  - Docker observability: Complete Grafana LGTM stack (Loki, Grafana, OpenTelemetry, Prometheus)
  - Configurable nginx port: Avoids common 8080 conflicts (defaults to 8180, derived from BASE_PORT)

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
- **Grafana dashboards**: Pre-configured observability dashboards (included in scaffolded projects)
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
- **Docker support**: Multi-node load-balanced deployment with nginx (included in scaffolded projects)
- **Playwright testing**: Headless browser tests for OAuth flows

### Added - Developer Experience

- **OpenAPI 3.1 specification**: Complete API documentation with Swagger UI and Redoc
- **Interactive API testing**: Swagger UI at `/api-docs` with OAuth integration
- **Comprehensive documentation**: Architecture Decision Records (ADRs), deployment guides, security policies
- **Pre-commit hooks**: Automated validation with gitleaks secret scanning
- **Hot reloading**: Auto-recompile and restart in development mode

### Security Highlights

- **Production-ready security score**: 93/100 (from comprehensive red team audit)
- **Zero hardcoded secrets**: All credentials externalized to environment variables
- **Comprehensive security documentation**: Red team audit, shift-left recommendations, compliance mapping
- **Defense-in-depth**: Input validation, rate limiting, OCSF audit logging, encrypted session storage

### Documentation

- **26 comprehensive guides** covering deployment, security, testing, and architecture
- **Security audit report**: npm publication readiness assessment
- **Compliance mapping**: SOC-2, ISO 27001, GDPR, HIPAA, PCI-DSS guidance
- **API reference**: Auto-generated from OpenAPI specification
- **Migration guides**: Template → npm framework migration strategies

### Known Limitations

- **npm vulnerabilities**: 19 known vulnerabilities (6 HIGH) in @vercel packages - accepted risk with mitigations in place
- **Plugin architecture**: Foundation present but not yet exposed as public API
- **Vitest migration**: Ongoing migration from Jest (see docs/vitest-migration.md)

---

## Release Candidate Notes

**This is a release candidate (0.9.0-rc.8)** for the first public npm release. We're seeking early adopter feedback before the 1.0.0 stable release.

**Target Audience**: Developers building production MCP servers requiring enterprise security, observability, and multi-LLM support.

**Feedback Welcome**:
- **GitHub Issues**: https://github.com/jdutton/mcp-typescript-simple/issues
- **Discussions**: https://github.com/jdutton/mcp-typescript-simple/discussions

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
