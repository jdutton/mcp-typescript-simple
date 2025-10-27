# Shift-Left Security: Automated Validation PoC

**Date:** 2025-10-25
**Related Issue:** #89 - Security Red Team Audit
**Status:** Proof of Concept

## Executive Summary

This document outlines a **shift-left security approach** for integrating automated security checks into the vibe-validate pipeline, replacing manual one-time audits with continuous validation.

**Key Benefits:**
- **Continuous protection**: Every commit gets security validation
- **Fast feedback**: Developers know immediately if they introduce security issues
- **Prevents regressions**: Once a vulnerability is fixed, validation prevents reintroduction
- **Scalable**: Automated checks don't require manual security expert time

## Top 5 Critical Security Gaps (from Issue #89)

Based on the comprehensive security audit scope, these are the highest-impact gaps that can be automated:

### 1. **CRITICAL: Unprotected Admin Endpoints**
**Current State:**
- `/admin/info` (GET) - NO authentication
- `/admin/metrics` (GET) - NO authentication

**Risk:** Anyone can view sensitive system information and metrics without authentication.

**Automated Check:** Scan route files for admin endpoints without auth middleware.

### 2. **CRITICAL: File-Based Secret Storage**
**Current State:**
- `./data/oauth-clients.json` stores OAuth client secrets in plaintext on disk
- Vulnerable to unauthorized file system access

**Risk:** If file system is compromised, all OAuth client secrets are exposed.

**Automated Check:** Detect `fs.writeFile*` or similar file operations storing sensitive data in production.

### 3. **HIGH: Secrets in Logging**
**Current State:**
- Potential for tokens, passwords, API keys to be logged
- Debug logging may expose sensitive data

**Risk:** Log aggregation systems (Datadog, CloudWatch, etc.) may contain secrets.

**Automated Check:** Grep logging statements for patterns like `token`, `password`, `secret`, `apiKey`.

### 4. **HIGH: Missing Rate Limiting**
**Current State:**
- OAuth endpoints lack rate limiting
- Vulnerable to brute force attacks

**Risk:** Attackers can attempt unlimited authentication attempts.

**Automated Check:** Verify sensitive endpoints have rate limiting middleware.

### 5. **MEDIUM: Dependency Vulnerabilities**
**Current State (from `npm audit`):**
- 4 high severity vulnerabilities
- 10 moderate severity vulnerabilities
- 3 low severity vulnerabilities

**Risk:** Known vulnerabilities in dependencies could be exploited.

**Automated Check:** Fail validation if `npm audit` reports high/critical vulnerabilities.

## Proposed vibe-validate Integration

### New Phase: Security Validation

Add to `vibe-validate.config.yaml`:

```yaml
- name: 'Security Validation'
  parallel: false
  steps:
    - name: Dependency Vulnerabilities
      command: npm audit --audit-level=high

    - name: Admin Endpoint Protection
      command: npx tsx tools/security/check-admin-auth.ts

    - name: Secrets in Logs
      command: npx tsx tools/security/check-secrets-in-logs.ts

    - name: Production File Storage
      command: npx tsx tools/security/check-file-storage.ts
```

### Implementation Strategy

#### Phase 1: PoC Scripts (This PR)
Create simple TypeScript validation scripts in `tools/security/`:
- `check-admin-auth.ts` - Verify admin routes have auth middleware
- `check-secrets-in-logs.ts` - Scan for sensitive data in logging
- `check-file-storage.ts` - Detect file-based secret storage in production

#### Phase 2: Integration (Follow-up PR)
- Add Security Validation phase to `vibe-validate.config.yaml`
- Run in CI/CD pipeline
- Document security requirements in CONTRIBUTING.md

#### Phase 3: Expand Coverage (Future)
- Rate limiting presence validation
- CORS configuration validation
- OAuth redirect URI validation
- Session management validation

## PoC Script Examples

### check-admin-auth.ts
```typescript
/**
 * Security Check: Admin Endpoint Protection
 *
 * Scans route files to ensure admin endpoints have authentication middleware.
 * Fails if any admin route lacks proper auth.
 */
import { readFileSync } from 'fs';
import { globSync } from 'glob';

const adminRoutePattern = /router\.(get|post|put|delete|patch)\(['"`]\/admin\//g;
const authMiddlewarePattern = /requireAdminAuth|requireAuth|authenticate/;

const routeFiles = globSync('packages/http-server/src/server/routes/**/*-routes.ts');
let violations = 0;

for (const file of routeFiles) {
  const content = readFileSync(file, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    if (adminRoutePattern.test(line)) {
      // Check if auth middleware present in same line or previous 5 lines
      const contextStart = Math.max(0, index - 5);
      const context = lines.slice(contextStart, index + 1).join('\n');

      if (!authMiddlewarePattern.test(context)) {
        console.error(`❌ Unprotected admin endpoint: ${file}:${index + 1}`);
        console.error(`   ${line.trim()}`);
        violations++;
      }
    }
  });
}

if (violations > 0) {
  console.error(`\n💥 Security Check Failed: ${violations} unprotected admin endpoint(s) found`);
  process.exit(1);
}

console.log('✅ Security Check Passed: All admin endpoints protected');
```

### check-secrets-in-logs.ts
```typescript
/**
 * Security Check: Secrets in Logging
 *
 * Scans source files for logging statements that may expose secrets.
 * Warns about potential PII exposure.
 */
import { readFileSync } from 'fs';
import { globSync } from 'glob';

const logPatterns = [
  /logger\.(info|debug|warn|error|trace)\([^)]*\b(token|password|secret|apiKey|api_key)\b/gi,
  /console\.(log|debug|info|warn|error)\([^)]*\b(token|password|secret|apiKey|api_key)\b/gi,
];

const sourceFiles = globSync('packages/*/src/**/*.ts', { ignore: '**/test/**' });
let violations = 0;

for (const file of sourceFiles) {
  const content = readFileSync(file, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    for (const pattern of logPatterns) {
      if (pattern.test(line)) {
        console.warn(`⚠️  Potential secret in logs: ${file}:${index + 1}`);
        console.warn(`   ${line.trim()}`);
        violations++;
      }
    }
  });
}

if (violations > 0) {
  console.warn(`\n⚠️  Warning: ${violations} potential secret(s) in logging found`);
  console.warn('   Review these carefully to ensure no PII/tokens are logged');
  // Note: This is a warning, not a hard failure - may have false positives
}

console.log('✅ Security Check Completed: Secrets in logs scan done');
```

## Advantages Over Manual Audits

| Aspect | Manual Audit | Automated Validation |
|--------|-------------|---------------------|
| **Frequency** | One-time (~3 hours) | Every commit (~30 seconds) |
| **Coverage** | Snapshot at audit time | Continuous protection |
| **Cost** | High (security expert time) | Low (automated) |
| **False Negatives** | Possible (human error) | Rare (deterministic) |
| **Regression Prevention** | No | Yes |
| **Developer Feedback** | Days/weeks later | Immediate (pre-commit) |

## Next Steps

1. **Create PoC scripts** (~1 hour)
   - tools/security/check-admin-auth.ts
   - tools/security/check-secrets-in-logs.ts
   - tools/security/check-file-storage.ts

2. **Test locally** (~30 min)
   - Run scripts manually
   - Verify they catch current issues
   - Ensure no false positives

3. **Integrate into vibe-validate** (~30 min)
   - Add Security Validation phase
   - Update package.json scripts
   - Test in validation pipeline

4. **Document** (~30 min)
   - Update CONTRIBUTING.md with security requirements
   - Add security section to README.md
   - Create ADR for shift-left security approach

**Total Time:** ~2.5 hours (vs 3+ hours for manual audit)

## Success Criteria

- [ ] All current security gaps detected by automated checks
- [ ] Security validation runs in < 1 minute
- [ ] Zero false positives on current codebase (after baseline established)
- [ ] Clear error messages guide developers to fixes
- [ ] Documentation explains security requirements

## Follow-up: Full Red Team Audit

After establishing automated checks, a comprehensive manual red team audit should still be performed to:
1. **Discover new vulnerability classes** not yet automated
2. **Validate effectiveness** of automated checks
3. **Threat modeling** for MCP-specific security concerns
4. **Penetration testing** of OAuth flows and session management

**Recommendation:** Schedule manual audit quarterly, expand automated checks after each audit.

## References

- Issue #89: Security Red Team Audit - Comprehensive Vulnerability Assessment
- OWASP Top 10 2021: https://owasp.org/Top10/
- GitHub Gitleaks: https://github.com/gitleaks/gitleaks
- vibe-validate Documentation: https://github.com/jdutton/vibe-validate
