# Agentic Workflow Tooling - Extraction Strategy

## Executive Summary

This document outlines the strategy for extracting our custom SDLC automation tooling into a standalone, reusable open-source project: **`@agentic-workflow`**

## Research Foundation

Based on comprehensive architecture research (see issue #68), our custom SDLC automation tooling represents a **novel and valuable** approach to agent-friendly development workflows. No existing tools combine:

1. **Git tree hash-based validation state caching**
2. **Agent-first design with clear, parseable output**
3. **Safety-first branch management** (never auto-merge)
4. **Integrated pre-commit workflow** reducing probabilistic decisions

### Competitive Analysis Summary

| Tool | Git State Caching | Agent-First | Safety-First | Integrated Workflow |
|------|-------------------|-------------|--------------|---------------------|
| **Our Tooling** | ✅ Tree hash | ✅ Yes | ✅ Yes | ✅ Yes |
| Nx/Turborepo | ✅ Content hash | ❌ No | ❌ No | ❌ No |
| Lefthook/Husky | ❌ No | ❌ No | ❌ No | ❌ No |
| GitHub CLI | ❌ No | ❌ No | ✅ Partial | ❌ No |

**Conclusion**: Our approach is unique and warrants extraction.

## Current Tooling Overview

### Tools We've Built

#### 1. **sync-check.ts** - Smart Branch Sync Checker
**Purpose**: Safely check if branch is behind origin/main without auto-merging

**Key Features**:
- Never auto-merges (preserves conflict visibility)
- Clear exit codes for agent integration
- Cross-platform compatibility
- Explicit manual intervention instructions

**Exit Codes**:
- `0`: Up to date or no remote
- `1`: Needs merge
- `2`: Error condition

#### 2. **pre-commit-check.ts** - Comprehensive Pre-Commit Workflow
**Purpose**: Combined branch sync + validation with smart state caching

**Key Features**:
- Checks branch sync first (stops if behind)
- Validates git tree hash against cached state
- Skips validation if code unchanged (huge time savings)
- Fast mode: typecheck + lint only when state current
- Full validation when needed

**Workflow**:
```
1. Branch sync check → Stop if behind
2. Validation state check → Skip if current
3. Fast checks (typecheck + lint) → If state valid
4. Full validation → If state invalid or missing
```

#### 3. **post-pr-merge-cleanup.ts** - Post-PR Cleanup Automation
**Purpose**: Clean workspace after PR merge

**Key Features**:
- Switches to main branch
- Syncs main with GitHub origin
- Deletes only confirmed-merged branches
- Never deletes unmerged branches
- Provides cleanup summary

**Safety**:
- Confirms merge status via git
- Force delete only after confirmation
- Clear feedback on all actions

#### 4. **run-validation-with-state.ts** - Validation with State Tracking
**Purpose**: Run full validation pipeline with git tree hash state caching

**Key Features**:
- Git tree hash for exact code state verification
- Embeds failed step output in YAML (no log file needed)
- Parses errors by category (TypeScript, ESLint, tests, build)
- Context-aware guidance (Claude Code vs manual)
- Cleans up old log files (>7 days)
- `--force` flag to bypass cache

**Validation Steps**:
1. TypeScript type checking
2. ESLint code checking
3. Unit tests
4. Build
5. OpenAPI validation
6. Integration tests
7. STDIO system tests
8. HTTP system tests
9. Headless browser tests

**State File**: `.validation-state.yaml`
- `passed`: Boolean validation result
- `timestamp`: ISO 8601 timestamp
- `treeHash`: Git tree hash (includes all changes)
- `failedStep`: Name of failed step (if any)
- `rerunCommand`: Command to re-run failed step
- `failedTests`: Array of failed test names
- `failedStepOutput`: Complete output (embedded in YAML)
- `fullLogFile`: Path to full log (emergency only)
- `agentPrompt`: Ready-to-use prompt for validation-fixer agent

#### 5. **write-validation-state.ts** - Validation State Writer
**Purpose**: Capture validation results and write state file

**Key Features**:
- Git tree hash calculation (staged + unstaged + untracked)
- Error parsing by type (TypeScript, ESLint, Jest)
- Agent prompt generation
- Automatic log cleanup (>7 days)
- Context detection (Claude Code vs manual)

## Why Extract?

### Market Gap

**Evidence from research**:
- Claude Code, Cursor, Aider all need SDLC workflow automation
- No existing tool combines our features
- LLM/AI agents need deterministic, cache-friendly workflows
- Current tools force agents to make probabilistic decisions

### Unique Value Propositions

1. **Deterministic Workflows**: Agents don't guess "should I run tests?"
2. **Git Tree Hash Caching**: Simple, deterministic, CI/CD appropriate
3. **Safety-First**: Never auto-merge, never delete unmerged branches
4. **Agent-Friendly Output**: YAML/JSON, clear exit codes, embedded errors
5. **Context-Aware**: Detects agent vs manual usage, adapts output

### Target Users

1. **AI Agent Platforms**:
   - Claude Code
   - Cursor
   - Aider
   - Continue
   - Custom LLM-powered development tools

2. **Development Teams**:
   - Teams adopting AI pair programming
   - Teams wanting faster CI/CD feedback
   - Teams needing deterministic test workflows

3. **Individual Developers**:
   - Developers using AI assistants
   - Developers wanting smart validation caching
   - Developers needing better pre-commit checks

## Extraction Architecture

### Package Structure

```
@agentic-workflow/
├── packages/
│   ├── core/              # Core validation state tracking
│   │   ├── src/
│   │   │   ├── state/        # State management
│   │   │   ├── cache/        # Git tree hash caching
│   │   │   └── types.ts      # Core types
│   │   └── package.json
│   │
│   ├── git/               # Git workflow automation
│   │   ├── src/
│   │   │   ├── sync.ts       # Branch sync checking
│   │   │   ├── cleanup.ts    # Post-PR cleanup
│   │   │   └── utils.ts      # Git utilities
│   │   └── package.json
│   │
│   ├── cli/               # CLI commands
│   │   ├── src/
│   │   │   ├── commands/     # Individual commands
│   │   │   ├── output/       # Output formatters
│   │   │   └── index.ts      # CLI entry point
│   │   └── package.json
│   │
│   └── config/            # Configuration management
│       ├── src/
│       │   ├── schema.ts     # Config schema
│       │   ├── loader.ts     # Config loader
│       │   └── defaults.ts   # Default config
│       └── package.json
│
├── examples/              # Usage examples
├── docs/                  # Documentation
└── package.json          # Monorepo root
```

### Core Abstractions

#### ValidationState
```typescript
interface ValidationState {
  // Validation result
  passed: boolean;
  timestamp: string;
  treeHash: string;  // Git tree hash

  // Failed step details (only if failed)
  failedStep?: string;
  rerunCommand?: string;
  failedTests?: string[];
  failedStepOutput?: string;
  fullLogFile?: string;

  // Quick summary for humans/LLMs
  summary?: string;

  // Agent prompt
  agentPrompt?: string;
}
```

#### WorkflowStep
```typescript
type WorkflowStep =
  | { type: 'sync-check'; options?: SyncCheckOptions }
  | { type: 'validation'; command: string; cacheKey?: string }
  | { type: 'cleanup'; mode: 'merged-only' | 'all' }
  | { type: 'custom'; name: string; command: string };
```

#### AgentContext
```typescript
interface AgentContext {
  isAgent: boolean;
  agentType?: 'claude-code' | 'cursor' | 'aider' | 'unknown';
  outputFormat: 'human' | 'yaml' | 'json';
  colorSupport: boolean;
}
```

#### Configuration File
```typescript
// .agentic-workflow.yml
validation:
  steps:
    - name: "TypeScript type checking"
      command: "npm run typecheck"
    - name: "ESLint code checking"
      command: "npm run lint"
    - name: "Unit tests"
      command: "npm run test:unit"
    - name: "Build"
      command: "npm run build"

  caching:
    enabled: true
    strategy: "git-tree-hash"  # or "file-hash", "timestamp"
    maxAge: 3600000  # 1 hour in ms

git:
  mainBranch: "main"  # or "master"
  autoSync: false     # Never auto-merge by default
  cleanupMerged: true

output:
  format: "auto"  # "human", "yaml", "json", or "auto" (detect agent)
  colors: "auto"  # true, false, or "auto"
  verbose: false
```

### CLI Commands

```bash
# Validation
agentic-workflow validate                    # Run validation
agentic-workflow validate --force            # Force re-validation
agentic-workflow validate --format=json      # JSON output

# Git workflow
agentic-workflow sync-check                  # Check if behind main
agentic-workflow pre-commit                  # Pre-commit workflow
agentic-workflow post-merge-cleanup          # Post-PR cleanup

# State management
agentic-workflow state                       # Show validation state
agentic-workflow state --reset               # Reset validation state
agentic-workflow cache-stats                 # Cache hit rate, time saved

# Configuration
agentic-workflow init                        # Initialize config
agentic-workflow config                      # Show current config
```

## Migration Path for Current Project

### Phase 1: Prepare for Extraction (Current Work)
- ✅ Document existing tooling
- ✅ Research competitive landscape
- ✅ Define extraction architecture
- Create extraction roadmap
- Add tests for tooling (if missing)

### Phase 2: Extract Core Packages
1. Create `@agentic-workflow/core` with state management
2. Create `@agentic-workflow/git` with git utilities
3. Create `@agentic-workflow/cli` with CLI commands
4. Create `@agentic-workflow/config` with configuration

### Phase 3: Generalize Configuration
1. Replace hardcoded validation steps with config
2. Add plugin system for custom steps
3. Support multiple config formats (YAML, JSON, JS)

### Phase 4: Integration & Testing
1. Integrate back into this project
2. Test with other TypeScript projects
3. Add integration examples for agent platforms

### Phase 5: Open Source Release
1. Publish to npm
2. Create documentation website
3. Write integration guides for:
   - Claude Code
   - Cursor
   - Aider
   - Continue
4. Create example projects
5. Submit PRs to agent platforms for official support

## Integration Examples

### Claude Code Integration
```typescript
// .claude/mcp.json
{
  "mcpServers": {
    "agentic-workflow": {
      "command": "npx",
      "args": ["@agentic-workflow/mcp-server"],
      "env": {}
    }
  }
}
```

### CI/CD Integration
```yaml
# .github/workflows/ci.yml
- name: Validation with Caching
  run: |
    npx @agentic-workflow/cli validate
```

### Pre-commit Hook
```bash
# .husky/pre-commit
#!/bin/sh
npx @agentic-workflow/cli pre-commit
```

## Success Metrics

### Technical Metrics
- **Cache Hit Rate**: >80% on repeat validations
- **Time Savings**: >50% reduction in validation time
- **Adoption**: 100+ stars on GitHub in first 3 months
- **Integration**: Official support from 2+ agent platforms

### Community Metrics
- **Downloads**: 10,000+ npm downloads/month within 6 months
- **Contributors**: 10+ external contributors
- **Issues/PRs**: Active community engagement
- **Stars**: 500+ GitHub stars within 1 year

## Timeline Estimate

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| Phase 1: Preparation | 1 week | Documentation, architecture |
| Phase 2: Core Extraction | 2-3 weeks | Core packages, basic CLI |
| Phase 3: Generalization | 1-2 weeks | Config system, plugins |
| Phase 4: Integration | 1 week | Examples, testing |
| Phase 5: Open Source | 2-3 weeks | Docs site, guides, release |
| **Total** | **7-10 weeks** | Production-ready OSS tool |

## Next Steps

1. **Complete current PR** (Issue #68):
   - Finish Vitest migration
   - Update CLAUDE.md
   - Validate tooling works

2. **Create extraction roadmap issue**:
   - Break down phases into tasks
   - Assign milestones
   - Set up project board

3. **Start Phase 2 - Core extraction**:
   - Create monorepo structure
   - Extract state management
   - Build basic CLI

4. **Engage community**:
   - Write blog post about the approach
   - Share on Twitter, Reddit, HN
   - Get feedback from agent platforms

## References

- **Architecture Research**: Issue #68 chief-arch agent output
- **Competitive Analysis**: See "Research Foundation" section above
- **Current Implementation**: `tools/` directory in this repository
- **Configuration Examples**: `.validation-state.yaml` in project root

## Questions & Decisions

### Open Questions
1. Should we support remote caching (like Nx Cloud)?
2. Should we build MCP server integration first?
3. What's the best config format (YAML, JSON, or JS)?
4. Should we support plugins from day one?

### Decisions Made
1. ✅ Use git tree hash for state caching (vs content hash)
2. ✅ Agent-first design (vs human-first)
3. ✅ Monorepo structure with multiple packages
4. ✅ TypeScript as primary language
5. ✅ Focus on deterministic workflows (vs probabilistic)

## License

Recommend: **MIT License** for maximum adoption and flexibility.

---

**Status**: Planning Phase
**Last Updated**: 2025-10-11
**Owner**: Jeff Dutton
**Related Issues**: #68
