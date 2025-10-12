# GitHub Workflow Generation Architecture

**Status**: Implemented (PR #2.5)
**Date**: 2025-01-11
**For**: @agentic-workflow extraction

## Overview

Validation pipeline auto-generates `.github/workflows/validate.yml` from `tools/validation-config.ts` to ensure perfect sync between local and CI validation.

## Single Source of Truth

```typescript
// tools/validation-config.ts - defines ALL validation steps
export const VALIDATION_PHASES = [
  {
    name: 'Phase 1: Pre-Qualification + Build',
    parallel: true,
    steps: [
      { name: 'TypeScript type checking', command: 'npm run typecheck', ciJob: 'typecheck' },
      // ... more steps
    ]
  },
  {
    name: 'Phase 2: Testing',
    parallel: true,
    dependsOn: ['Phase 1: Pre-Qualification + Build'],
    steps: [
      { name: 'Unit tests', command: 'npm run test:unit', ciJob: 'unit-tests' },
      // ... more steps
    ]
  }
];
```

## Workflow Generation

```bash
# Generate validate.yml from config
npm run validate:generate-workflow

# Check if workflow needs regeneration
npm run validate:check-workflow-sync
```

Generated file: `.github/workflows/validate.yml`
- Header comment: "AUTO-GENERATED - DO NOT EDIT"
- One GitHub Actions job per validation step
- Phase dependencies via `needs:` clause
- Parallel execution within each phase

## Sync Enforcement

`npm run validate` checks workflow sync before running:
```typescript
// Fails if validate.yml out of sync with validation-config.ts
const syncCheck = await checkWorkflowSync();
if (!syncCheck.inSync) {
  console.log('❌ GitHub workflow out of sync!');
  process.exit(1);
}
```

## Local vs CI Execution

**Local** (`npm run validate`):
- Phase 1: 4 steps parallel (~60s)
- Phase 2: 5 steps parallel (~300s)
- Total: ~6 minutes
- Single runner, shared resources

**CI** (`.github/workflows/validate.yml`):
- Phase 1: 4 jobs parallel (dedicated runners)
- Phase 2: 5 jobs parallel (dedicated runners)
- Total: ~6 minutes
- Isolated runners, full resources each

## Separation of Concerns

**Validation owns**: `.github/workflows/validate.yml` (auto-generated)

**Manual workflows**:
- `.github/workflows/docker.yml` - Docker build validation
- `.github/workflows/deploy.yml` - Production deployment
- Other workflows as needed

Validation tooling does NOT generate or manage non-validation workflows.

## Docker Handling

**CI**: Separate `.github/workflows/docker.yml` validates Docker builds on PRs

**Local**: `npm run docker:dev` builds and runs Docker container

Docker build NOT included in `npm run validate` (too slow for pre-commit).

## Benefits

- ✅ Perfect sync (CI uses exact same steps as local)
- ✅ Single source of truth (validation-config.ts)
- ✅ Fail-fast (validation fails if workflow outdated)
- ✅ Clear boundaries (validate owns validate.yml only)
- ✅ Parallel execution (both local and CI)
- ✅ Git-tracked (validate.yml committed, reviewable)

## Extraction Notes for @agentic-workflow

Key features to extract:
1. Validation config as source of truth
2. Auto-generation of CI workflow
3. Sync checking (fail if out of sync)
4. Phase-based parallel execution
5. Clear separation of concerns (validation vs deployment)
