# npm Publication Strategy

**Date**: 2025-11-14
**Based on**: vibe-validate project patterns
**Status**: Planning document for npm publication

---

## Overview

This document outlines the strategy for publishing mcp-typescript-simple to npm as `@mcp-framework/*` packages, based on proven patterns from the vibe-validate project.

---

## Key Learnings from vibe-validate

### 1. Version Management Tool

**Tool**: `tools/bump-version.js`

**Features**:
- Updates ALL package.json files in monorepo (root + workspaces)
- Supports explicit version (`0.15.0`) or increment (`patch`, `minor`, `major`)
- Preserves file formatting (only replaces version line)
- Skips private packages automatically
- Updates plugin manifests (if applicable)
- Provides clear next-step instructions

**Usage**:
```bash
# Explicit version
pnpm bump-version 1.0.0

# Auto-increment
pnpm bump-version patch    # 1.0.0 → 1.0.1
pnpm bump-version minor    # 1.0.0 → 1.1.0
pnpm bump-version major    # 1.0.0 → 2.0.0
```

**After bumping**:
```bash
1. Review: git diff
2. Commit: git add -A && git commit -m "chore: Release v1.0.0"
3. Tag: git tag v1.0.0
4. Push: git push origin main && git push origin v1.0.0
5. Publish: npm run publish:all
```

### 2. Publishing Scripts

**From vibe-validate package.json**:
```json
{
  "scripts": {
    "pre-publish": "node tools/pre-publish-check.js",
    "verify-npm-packages": "node tools/verify-npm-packages.js",
    "publish:dry-run": "pnpm -r --filter='@pkg/*' exec npm publish --dry-run",

    "publish:extractors": "cd packages/extractors && pnpm publish --no-git-checks",
    "publish:git": "cd packages/git && pnpm publish --no-git-checks",
    "publish:config": "cd packages/config && pnpm publish --no-git-checks",
    "publish:core": "cd packages/core && pnpm publish --no-git-checks",
    "publish:cli": "cd packages/cli && pnpm publish --no-git-checks",
    "publish:umbrella": "cd packages/vibe-validate && pnpm publish --no-git-checks",

    "publish:all": "npm run pre-publish && npm run publish:extractors && ... && npm run publish:umbrella",

    "version:patch": "node tools/bump-version.js patch",
    "version:minor": "node tools/bump-version.js minor",
    "version:major": "node tools/bump-version.js major",

    "release:patch": "npm run version:patch && npm run build && git add -A && git commit -m 'chore: Release patch' && npm run tag:create",
    "release:minor": "npm run version:minor && npm run build && git add -A && git commit -m 'chore: Release minor' && npm run tag:create",
    "release:major": "npm run version:major && npm run build && git add -A && git commit -m 'chore: Release major' && npm run tag:create"
  }
}
```

**Publishing Order**: Dependencies first, CLI last, umbrella package final
- extractors → git → config → history → core → cli → umbrella

**Why `--no-git-checks`?**
- Bypasses npm's default requirement for clean git state
- Allows publishing from release automation scripts
- Still requires manual version bumping first

### 3. Package.json Configuration

**CLI Package Example** (`@vibe-validate/cli`):
```json
{
  "name": "@vibe-validate/cli",
  "version": "0.15.0",
  "description": "Command-line interface for vibe-validate",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "vibe-validate": "./dist/bin/vibe-validate",
    "vv": "./dist/bin/vv"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "config-templates",
    "README.md"
  ],
  "keywords": [
    "validation",
    "testing",
    "ci-cd",
    "git",
    "typescript",
    "ai-agent-friendly",
    "claude-code",
    "developer-tools"
  ]
}
```

**Key Fields**:
- `files`: What gets published to npm (exclude src/, test/)
- `bin`: CLI executables (for CLI package only)
- `exports`: Modern ESM exports
- `keywords`: Critical for npm discoverability
- `type: "module"`: ESM-only packages

### 4. CHANGELOG.md Requirements

**From vibe-validate CLAUDE.md**:

**MANDATORY before releasing**:
- Update CHANGELOG.md for every release
- Add changes to "Unreleased" section during development
- Move to versioned section when releasing
- User-focused writing (not developer internals)

**User-Focused Writing**:
- ❌ Bad: "Updated `init.ts` to use `generateYamlConfig()` function"
- ✅ Good: "`vibe-validate init` now correctly generates YAML config files"
- ❌ Bad: "Added 11 new tests for schema validation"
- ✅ Good: "Fixed IDE autocomplete for YAML configs"

**Structure**: Problem → Solution → Impact

**Example Entry**:
```markdown
## [Unreleased]

### Bug Fixes
- **CRITICAL: Fixed broken `init` command** (Issue #12)
  - **Problem**: `init` was creating .ts config files that couldn't be loaded
  - **Solution**: Now generates vibe-validate.config.yaml files
  - **Impact**: New users can successfully initialize projects

### Features
- **OAuth multi-provider support** (Issue #45)
  - **Problem**: Only Google OAuth was supported
  - **Solution**: Added GitHub and Microsoft providers
  - **Impact**: Enterprises can use their existing identity providers
```

### 5. Development Workflow (CLAUDE.md)

**MANDATORY Steps for ANY Code Change**:
1. Create feature branch (never work on main)
2. Make changes
3. Run `pnpm validate` (MUST pass)
4. **Ask user permission** before committing (CRITICAL)
5. Commit with proper message format
6. Push to remote

**Commit Message Format**:
```
feat: Add multi-provider OAuth support

Implements Google, GitHub, and Microsoft OAuth providers
with dynamic client registration.

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Branch Naming**:
- `feature/add-multi-llm` - new features
- `fix/oauth-redirect-bug` - bug fixes
- `docs/update-api-reference` - documentation
- `refactor/cleanup-transport` - refactoring

---

## Proposed Strategy for mcp-typescript-simple

### Phase 1: Adopt Version Management (1 hour)

**Create `tools/bump-version.js`**:
```javascript
// Adapt vibe-validate's bump-version.js for mcp-typescript-simple
// Update ALL workspace packages + root package.json
// Support explicit version or increment (patch/minor/major)
```

**Add to package.json**:
```json
{
  "scripts": {
    "bump-version": "node tools/bump-version.js",
    "version:patch": "node tools/bump-version.js patch",
    "version:minor": "node tools/bump-version.js minor",
    "version:major": "node tools/bump-version.js major"
  }
}
```

### Phase 2: Create Publishing Scripts (2 hours)

**Determine Publishing Order**:
Based on dependency graph:
1. `@mcp-framework/config` (no dependencies)
2. `@mcp-framework/observability` (minimal deps)
3. `@mcp-framework/testing` (test utilities)
4. `@mcp-framework/persistence` (uses config)
5. `@mcp-framework/tools` (uses config)
6. `@mcp-framework/tools-llm` (uses tools)
7. `@mcp-framework/auth` (uses config, persistence)
8. `@mcp-framework/server` (uses auth, persistence)
9. `@mcp-framework/http-server` (uses server)
10. `@mcp-framework/example-mcp` (uses everything)
11. `@mcp-framework/adapter-vercel` (uses example-mcp)

**Add to package.json**:
```json
{
  "scripts": {
    "pre-publish": "node tools/pre-publish-check.js",
    "verify-npm-packages": "node tools/verify-npm-packages.js",
    "publish:dry-run": "npm -ws --if-present exec npm publish --dry-run",

    "publish:config": "cd packages/config && npm publish --no-git-checks",
    "publish:observability": "cd packages/observability && npm publish --no-git-checks",
    "publish:testing": "cd packages/testing && npm publish --no-git-checks",
    "publish:persistence": "cd packages/persistence && npm publish --no-git-checks",
    "publish:tools": "cd packages/tools && npm publish --no-git-checks",
    "publish:tools-llm": "cd packages/tools-llm && npm publish --no-git-checks",
    "publish:auth": "cd packages/auth && npm publish --no-git-checks",
    "publish:server": "cd packages/server && npm publish --no-git-checks",
    "publish:http-server": "cd packages/http-server && npm publish --no-git-checks",
    "publish:example-mcp": "cd packages/example-mcp && npm publish --no-git-checks",
    "publish:adapter-vercel": "cd packages/adapter-vercel && npm publish --no-git-checks",

    "publish:all": "npm run pre-publish && npm run publish:config && npm run publish:observability && npm run publish:testing && npm run publish:persistence && npm run publish:tools && npm run publish:tools-llm && npm run publish:auth && npm run publish:server && npm run publish:http-server && npm run publish:example-mcp && npm run publish:adapter-vercel",

    "release:patch": "npm run version:patch && npm run build && git add -A && git commit -m 'chore: Release patch version' && npm run tag:create && npm run publish:all",
    "release:minor": "npm run version:minor && npm run build && git add -A && git commit -m 'chore: Release minor version' && npm run tag:create && npm run publish:all",
    "release:major": "npm run version:major && npm run build && git add -A && git commit -m 'chore: Release major version' && npm run tag:create && npm run publish:all",

    "tag:create": "node -e \"const pkg = require('./packages/example-mcp/package.json'); const tag = 'v' + pkg.version; require('child_process').execSync('git tag -a ' + tag + ' -m \\\"Release ' + tag + '\\\"', {stdio: 'inherit'});\""
  }
}
```

### Phase 3: Update Package Metadata (1 hour)

**For EACH workspace package**:

```json
{
  "name": "@mcp-framework/core",
  "version": "0.1.0",
  "description": "Core MCP server framework with plugin system",
  "author": "Jeff Dutton",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/mcp-framework/framework.git",
    "directory": "packages/core"
  },
  "bugs": "https://github.com/mcp-framework/framework/issues",
  "homepage": "https://github.com/mcp-framework/framework#readme",
  "files": [
    "dist",
    "README.md"
  ],
  "keywords": [
    "mcp",
    "model-context-protocol",
    "framework",
    "oauth",
    "serverless",
    "vercel",
    "typescript",
    "enterprise"
  ],
  "engines": {
    "node": ">=22.0.0"
  }
}
```

**Root package.json changes**:
```json
{
  "private": true,  // Keep root private
  "repository": {
    "type": "git",
    "url": "https://github.com/mcp-framework/framework.git"
  }
}
```

### Phase 4: Create Pre-Publish Checks (2 hours)

**`tools/pre-publish-check.js`**:
```javascript
// Verify:
// 1. All workspace packages have matching versions
// 2. All tests pass (npm run validate)
// 3. CHANGELOG.md updated
// 4. No uncommitted changes
// 5. Current branch is main
// 6. Up to date with origin/main
// 7. All packages have proper metadata (keywords, description, etc.)
// 8. No TODO/FIXME in published code
```

**`tools/verify-npm-packages.js`**:
```javascript
// After publishing:
// 1. Verify all packages exist on npm registry
// 2. Check versions match expected
// 3. Verify package contents (files published correctly)
// 4. Test installing from npm
```

### Phase 5: Create CHANGELOG.md (30 minutes)

**Structure**:
```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release of @mcp-framework packages

## [1.0.0] - 2025-11-XX

### Added
- Core MCP server framework with plugin system
- OAuth 2.1 authentication (Google, GitHub, Microsoft)
- OpenTelemetry observability integration
- OCSF security audit logging
- Multi-LLM support (Claude, OpenAI, Gemini)
- Vercel serverless deployment support
- Redis session management for horizontal scaling
- Comprehensive TypeScript types

### Security
- AES-256-GCM encryption for token storage
- Admin endpoint authentication
- Input validation middleware
- Rate limiting protection
- CSRF protection
```

### Phase 6: Update CLAUDE.md (1 hour)

**Add to CLAUDE.md**:

```markdown
## Version Management

**CRITICAL**: Always use the `bump-version` script to update versions across the monorepo.

### Bumping Versions

```bash
# Explicit version
npm run bump-version 1.0.0

# Auto-increment
npm run version:patch    # 1.0.0 → 1.0.1
npm run version:minor    # 1.0.0 → 1.1.0
npm run version:major    # 1.0.0 → 2.0.0
```

### Publishing Workflow

**MANDATORY steps for releases**:

1. **Update CHANGELOG.md** (REQUIRED)
   - Move changes from "Unreleased" to versioned section
   - Follow user-focused writing guidelines
   - Include issue/PR references

2. **Bump version**
   ```bash
   npm run version:patch  # or minor/major
   ```

3. **Build packages**
   ```bash
   npm run build
   ```

4. **Commit and tag**
   ```bash
   git add -A
   git commit -m "chore: Release v1.0.0"
   git tag v1.0.0
   ```

5. **Push**
   ```bash
   git push origin main
   git push origin v1.0.0
   ```

6. **Publish to npm**
   ```bash
   npm run publish:all
   ```

### Automated Release (Recommended)

```bash
# One command for everything
npm run release:patch   # Handles: version bump + build + commit + tag + publish
npm run release:minor
npm run release:major
```

### Pre-Publish Checklist

Before running `publish:all`, verify:
- ✅ CHANGELOG.md updated
- ✅ All tests passing (`npm run validate`)
- ✅ No uncommitted changes
- ✅ On main branch
- ✅ Up to date with origin/main
- ✅ Version bumped in all packages
```

---

## Publishing Process Comparison

### vibe-validate (Current)

**Approach**: Manual publishing with scripts
**Pros**:
- Simple, no CI/CD complexity
- Direct control over publishing
- Fast iteration

**Cons**:
- Requires local npm authentication
- Manual process (error-prone)
- No automated testing in publishing environment

**Process**:
```bash
1. npm run bump-version 0.15.0
2. pnpm -r build
3. git add -A && git commit -m "chore: Release v0.15.0"
4. git tag v0.15.0
5. git push origin main && git push origin v0.15.0
6. npm run publish:all  # Sequential publishing
```

### Recommended for mcp-framework (Future)

**Approach**: GitHub Actions automated publishing
**Pros**:
- Consistent publishing environment
- Automated checks before publishing
- npm provenance (supply chain security)
- No local npm token required

**Cons**:
- Initial setup complexity
- Requires GitHub secrets configuration

**Process**:
```bash
1. npm run release:patch  # Automated: version + build + commit + tag
2. git push origin main && git push origin v1.0.0
3. GitHub Actions triggers on tag push
4. Automated: validate → build → publish:all → verify
```

**GitHub Actions Workflow** (future):
```yaml
# .github/workflows/publish.yml
name: Publish to npm

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write  # For npm provenance
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: npm install

      - name: Run validation
        run: npm run validate

      - name: Build packages
        run: npm run build

      - name: Publish to npm
        run: npm run publish:all
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Verify published packages
        run: npm run verify-npm-packages
```

---

## Next Steps

### Immediate (Before npm Publication)

1. ✅ Security audit complete (docs/security/npm-publication-security-audit-2025-11-14.md)
2. ⏳ Create `tools/bump-version.js` (adapt from vibe-validate)
3. ⏳ Create `tools/pre-publish-check.js`
4. ⏳ Create `tools/verify-npm-packages.js`
5. ⏳ Update all workspace package.json files (metadata, files, keywords)
6. ⏳ Create CHANGELOG.md with initial structure
7. ⏳ Add publishing scripts to root package.json
8. ⏳ Update CLAUDE.md with publishing workflow
9. ⏳ Test dry-run publishing

### Phase 0 (Alpha Release)

10. Reserve `@mcp-framework` scope on npm
11. Publish 0.1.0-alpha to npm
12. Test installation in separate project
13. Gather feedback from early adopters

### Phase 1 (Beta Release)

14. Implement plugin architecture (per Chief Architect recommendations)
15. Stabilize public API
16. Publish 0.9.0-beta to npm
17. Update documentation site

### Phase 2 (Production Release)

18. API freeze
19. Final validation and testing
20. Publish 1.0.0 to npm
21. Announcement (blog post, social media, Hacker News)

---

## References

- **vibe-validate CLAUDE.md**: Comprehensive development workflow guidance
- **vibe-validate bump-version.js**: Version management tool
- **vibe-validate package.json**: Publishing scripts reference
- **Chief Architect Report**: docs/security/npm-publication-security-audit-2025-11-14.md
- **Security Audit**: docs/security/npm-publication-security-audit-2025-11-14.md
