# Pre-Commit Hook - Automated Validation Enforcement

## Overview

**Problem**: Claude Code (and humans) must "remember" to run validation before committing → probabilistic, error-prone

**Solution**: Husky pre-commit hook enforces validation state check → deterministic, reliable

## How It Works

### The Hook

`.husky/pre-commit` runs automatically before every `git commit`:

```bash
# Pre-Commit Validation State Check
# Ensures validation has passed before allowing commits
# This prevents Claude Code (and humans) from committing invalid code

echo "🔍 Checking validation state..."

# Run pre-commit check (includes validation state verification)
npm run pre-commit

# Exit code from pre-commit determines if commit proceeds
exit $?
```

### What Gets Checked

`npm run pre-commit` performs:

1. **Branch Sync Check** → Stops if behind origin/main
2. **Validation State Check** → Verifies `.validation-state.yaml`
   - If state valid & code unchanged → Fast checks only (typecheck + lint)
   - If state invalid or missing → Full validation required
3. **Fast Checks** → TypeScript + ESLint (when state valid)
4. **Full Validation** → All tests + build (when state invalid)

### Workflow

```
Developer/Agent: git commit -m "message"
         ↓
   Husky pre-commit hook triggers
         ↓
   npm run pre-commit executes
         ↓
   ┌─────────────────────────────┐
   │ Check branch sync           │
   │ ├─ Behind? → STOP & merge   │
   │ └─ Up to date? → Continue   │
   └─────────────────────────────┘
         ↓
   ┌─────────────────────────────┐
   │ Check validation state      │
   │ ├─ Valid & unchanged?       │
   │ │  → Fast checks only       │
   │ └─ Invalid/missing?         │
   │    → Full validation        │
   └─────────────────────────────┘
         ↓
   ┌─────────────────────────────┐
   │ All checks passed?          │
   │ ├─ Yes → Commit proceeds ✅ │
   │ └─ No → Commit blocked ❌   │
   └─────────────────────────────┘
```

## Benefits

### For AI Agents (Claude Code)

1. **No more "remembering" to run validation** - automatic enforcement
2. **Clear error messages** when validation needed
3. **Fast path** when code unchanged (huge time savings)
4. **Deterministic behavior** - no probabilistic decisions

### For Human Developers

1. **Catch issues before pushing** to GitHub
2. **Faster feedback loop** with smart caching
3. **Consistent workflow** across team
4. **No more "forgot to run tests"** mistakes

## Exit Codes

- **0**: All checks passed, commit proceeds
- **1**: Checks failed, commit blocked:
  - Branch behind origin/main (needs merge)
  - Validation state invalid (needs `npm run validate`)
  - Fast checks failed (typecheck/lint errors)
- **2**: Error condition (git operation failed, etc.)

## Bypassing the Hook (Emergency Only)

```bash
# NOT RECOMMENDED - only for emergencies
git commit --no-verify -m "emergency fix"
```

**When to use:**
- Hotfix deployment urgency
- Hook is broken and needs fixing
- You know what you're doing

**Never use for:**
- "I don't want to wait for validation"
- "My code is fine, trust me"
- Regular development workflow

## Smart Caching = Speed

The hook is **fast** because of validation state caching:

**First commit** (no state):
```
npm run validate → ~30-60 seconds (full validation)
git commit        → ~2-3 seconds (fast checks)
```

**Subsequent commits** (state valid, code unchanged):
```
git commit → ~2-3 seconds (fast checks only, no full validation!)
```

**After code changes**:
```
npm run validate → ~30-60 seconds (full validation, refreshes state)
git commit        → ~2-3 seconds (fast checks)
```

## Integration with CI/CD

Pre-commit hook **complements** CI/CD, doesn't replace it:

- **Pre-commit**: Fast local validation before committing
- **CI/CD**: Full validation on PR, all environments, all platforms

## Configuration

### Disable Hook

```bash
# Remove husky from package.json
npm uninstall husky

# Or comment out in .husky/pre-commit
# npm run pre-commit
```

### Customize Hook

Edit `.husky/pre-commit` to:
- Add custom checks
- Change validation behavior
- Add notifications
- Integrate with other tools

## Troubleshooting

### Hook Not Running

```bash
# Ensure Husky is installed
npm install

# Verify hook exists
ls -la .husky/pre-commit

# Check permissions
chmod +x .husky/pre-commit
```

### Hook Fails Immediately

```bash
# Check validation state
cat .validation-state.yaml

# Run validation manually
npm run validate

# Try pre-commit manually
npm run pre-commit
```

### Hook Too Slow

If pre-commit takes >10 seconds:

1. Check if validation state is stale (run `npm run validate`)
2. Verify fast checks are being used (should see "Fast pre-commit mode enabled")
3. Check for slow typecheck/lint issues

## Architecture Decision

This hook implements **Proposal B** from the SDLC automation discussion:

**Proposal A** (rejected): Claude Code remembers to run validation
- ❌ Probabilistic
- ❌ Error-prone
- ❌ Requires agent context

**Proposal B** (implemented): Pre-commit hook enforces validation
- ✅ Deterministic
- ✅ Reliable
- ✅ Works for humans and agents

## Future Enhancements

Potential improvements:

1. **Remote caching** - Share validation state across team (like Nx Cloud)
2. **Parallel checks** - Run typecheck + lint simultaneously
3. **Incremental validation** - Only validate changed files
4. **GitHub Status Check** - Show validation state in PR
5. **Slack/Discord notifications** - Alert when validation needed

## Related Documentation

- **Pre-commit workflow**: `CLAUDE.md` (SDLC Automation Tooling section)
- **Validation state caching**: `docs/agentic-workflow-extraction.md`
- **SDLC tools**: `tools/pre-commit-check.ts`, `tools/run-validation-with-state.ts`

---

**Status**: Production Ready
**Last Updated**: 2025-10-11
**Author**: Jeff Dutton
**Related Issues**: #68
