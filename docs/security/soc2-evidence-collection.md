# SOC-2 Type II Evidence Collection Guide

**Last Updated:** 2025-11-02
**Audit Period:** Typically 6-12 months of operational evidence
**Next Audit:** TBD (after operational evidence collection)

## Overview

SOC-2 Type II auditors require **point-in-time evidence** (policies, procedures) plus **6-12 months operational evidence** (logs, tickets, reviews) to verify controls operate effectively over time.

This guide tells you **exactly what to collect** and **where to find it**.

---

## Evidence Collection Checklist

### 1. Access Control (CC6.1)

**Policy Documents:**
- [ ] Password policy (document in `docs/security/access-control-policy.md`)
- [ ] MFA requirements (OAuth providers enforce MFA)
- [ ] Access review procedures (document quarterly reviews)

**Operational Evidence (6-12 months):**
- [ ] OCSF authentication events (Loki/Grafana)
  - Query: `{ocsf_class_name="Authentication"}`
  - Export monthly: `docs/evidence/YYYY-MM-authentication.json`
- [ ] Failed login attempts and lockouts
  - Query: `{ocsf_class_name="Authentication"} |= "failure"`
- [ ] User access reviews (quarterly)
  - Document: `docs/evidence/YYYY-QX-access-review.xlsx`
  - Show: Users reviewed, access revoked, sign-off

**Automated Collection:**
```bash
# Monthly OCSF authentication export
curl -G 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={ocsf_class_name="Authentication"}' \
  --data-urlencode 'start=2024-01-01T00:00:00Z' \
  --data-urlencode 'end=2024-02-01T00:00:00Z' \
  > docs/evidence/2024-01-authentication.json
```

---

### 2. Encryption (CC6.6)

**Policy Documents:**
- [ ] Encryption standards (AES-256-GCM documented in ADR-004)
- [ ] Key rotation procedures (`docs/security/key-rotation-procedures.md`)
- [ ] Key management policy

**Operational Evidence:**
- [ ] Key rotation logs (every 90 days)
  - Document in: `docs/evidence/YYYY-MM-key-rotation.log`
  - Show: Date rotated, who performed it, verification steps
- [ ] Encryption validation tests
  - Monthly: `npm run test:unit -- test/encryption/`
  - Save output: `docs/evidence/YYYY-MM-encryption-tests.txt`

**Example Key Rotation Log:**
```
2024-01-15: TOKEN_ENCRYPTION_KEY rotated by john@example.com
  - Old key retired: Wp3suOcV...
  - New key activated: Kx9mLpRt...
  - All tokens re-encrypted successfully
  - Verification: Health check passed
```

---

### 3. System Monitoring (CC7.2)

**Policy Documents:**
- [ ] Security monitoring policy
- [ ] Incident response procedures (`docs/security/incident-response-playbook.md`)
- [ ] Log retention policy (document: 1-2 years)

**Operational Evidence:**
- [ ] OCSF security events (ALL classes)
  - Export monthly: `{ocsf_class_name!=""}`
- [ ] Security scanner results (daily via validation)
  - Collect: `npx vibe-validate history --format=json > docs/evidence/validation-history.json`
- [ ] Incident reports (if any)
  - Store: `docs/evidence/incidents/YYYY-MM-DD-incident-report.md`
- [ ] Security review meetings (monthly)
  - Minutes: `docs/evidence/YYYY-MM-security-review.md`

**Automated Monthly Collection:**
```bash
#!/bin/bash
# tools/collect-soc2-evidence.sh

MONTH=$(date +%Y-%m)
EVIDENCE_DIR="docs/evidence/$MONTH"
mkdir -p "$EVIDENCE_DIR"

# 1. OCSF security events
curl -G 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={ocsf_class_name!=""}' \
  --data-urlencode "start=$(date -d 'last month' +%Y-%m-01)T00:00:00Z" \
  --data-urlencode "end=$(date +%Y-%m-01)T00:00:00Z" \
  > "$EVIDENCE_DIR/ocsf-events.json"

# 2. Validation history
npx vibe-validate history --format=json > "$EVIDENCE_DIR/validation-history.json"

# 3. Git commit log (shows change management)
git log --since="last month" --pretty=format:"%h %ad %s" --date=short \
  > "$EVIDENCE_DIR/git-commits.txt"

echo "Evidence collected for $MONTH in $EVIDENCE_DIR"
```

---

### 4. Change Management (CC8.1)

**Policy Documents:**
- [ ] Change management policy (document PR process)
- [ ] Testing requirements (documented in `docs/testing-guidelines.md`)
- [ ] Deployment procedures (document in `docs/vercel-deployment.md`)

**Operational Evidence:**
- [ ] All pull requests (GitHub)
  - Export monthly: `gh pr list --state closed --json number,title,createdAt,mergedAt --limit 100`
- [ ] Validation runs (vibe-validate)
  - History: `npx vibe-validate history`
- [ ] Production deployments (Vercel)
  - Export: `vercel ls --prod > docs/evidence/YYYY-MM-deployments.txt`
- [ ] Security validation results
  - Show: All PRs pass security checks before merge

**Automated Collection:**
```bash
# Monthly PR activity
gh pr list --state closed --json number,title,createdAt,mergedAt \
  --search "merged:>=2024-01-01 merged:<=2024-02-01" \
  > docs/evidence/2024-01-pull-requests.json
```

---

## Evidence Organization Structure

```
docs/evidence/
├── 2024-01/
│   ├── authentication-events.json      # CC6.1
│   ├── ocsf-security-events.json       # CC7.2
│   ├── validation-history.json         # CC8.1
│   ├── key-rotation.log                # CC6.6
│   ├── pull-requests.json              # CC8.1
│   ├── deployments.txt                 # CC8.1
│   └── security-review-minutes.md      # CC7.2
├── 2024-02/
│   └── ...
└── policies/
    ├── access-control-policy.md
    ├── encryption-policy.md
    ├── incident-response-policy.md
    └── change-management-policy.md
```

---

## Evidence Collection Timeline

**Month 1-3: Preparation**
- [ ] Document all policies
- [ ] Set up automated evidence collection scripts
- [ ] Create evidence directory structure
- [ ] Train team on evidence requirements

**Month 4-9: Operational Evidence Collection**
- [ ] Run monthly evidence collection scripts
- [ ] Conduct monthly security reviews
- [ ] Perform quarterly access reviews
- [ ] Document all incidents (if any)

**Month 10-12: Audit Preparation**
- [ ] Review all collected evidence for completeness
- [ ] Fill any gaps
- [ ] Create evidence index
- [ ] Engage SOC-2 auditor

---

## Auditor Requests - Quick Reference

**Common Auditor Questions:**

1. **"Show me authentication logs for Q1 2024"**
   - Location: `docs/evidence/2024-01/authentication-events.json` (Jan)
   - Location: `docs/evidence/2024-02/authentication-events.json` (Feb)
   - Location: `docs/evidence/2024-03/authentication-events.json` (Mar)

2. **"How do you rotate encryption keys?"**
   - Policy: `docs/security/key-rotation-procedures.md`
   - Evidence: `docs/evidence/*/key-rotation.log` (quarterly)

3. **"Show me a sample security incident"**
   - Playbook: `docs/security/incident-response-playbook.md`
   - Real incidents: `docs/evidence/incidents/` (if any)
   - Test drill: Schedule and document mock incident

4. **"How do you validate security before deployment?"**
   - Process: `vibe-validate.config.mjs` (Security Validation phase)
   - Evidence: `docs/evidence/*/validation-history.json`
   - Show: PR checks in GitHub Actions

5. **"Who has admin access?"**
   - Document: `docs/evidence/*/access-review.xlsx`
   - Show: Quarterly reviews with sign-offs

---

## Automation Script

Create `tools/collect-soc2-evidence.sh`:

```bash
#!/bin/bash
set -e

MONTH=$(date +%Y-%m)
PREV_MONTH=$(date -d 'last month' +%Y-%m)
EVIDENCE_DIR="docs/evidence/$PREV_MONTH"

echo "Collecting SOC-2 evidence for $PREV_MONTH..."
mkdir -p "$EVIDENCE_DIR"

# 1. OCSF Events
curl -G 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={ocsf_class_name!=""}' \
  --data-urlencode "start=${PREV_MONTH}-01T00:00:00Z" \
  --data-urlencode "end=${MONTH}-01T00:00:00Z" \
  > "$EVIDENCE_DIR/ocsf-events.json"

# 2. Authentication Events
curl -G 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={ocsf_class_name="Authentication"}' \
  --data-urlencode "start=${PREV_MONTH}-01T00:00:00Z" \
  --data-urlencode "end=${MONTH}-01T00:00:00Z" \
  > "$EVIDENCE_DIR/authentication-events.json"

# 3. Validation History
npx vibe-validate history --format=json > "$EVIDENCE_DIR/validation-history.json"

# 4. Pull Requests
gh pr list --state closed --json number,title,createdAt,mergedAt \
  --search "merged:>=${PREV_MONTH}-01 merged:<${MONTH}-01" \
  > "$EVIDENCE_DIR/pull-requests.json"

# 5. Deployments
vercel ls --prod > "$EVIDENCE_DIR/deployments.txt"

# 6. Git Commits
git log --since="${PREV_MONTH}-01" --until="${MONTH}-01" \
  --pretty=format:"%h %ad %s" --date=short \
  > "$EVIDENCE_DIR/git-commits.txt"

echo "✅ Evidence collected in $EVIDENCE_DIR"
echo ""
echo "TODO:"
echo "- Document key rotations (if any)"
echo "- Add security review minutes"
echo "- Update access review spreadsheet"
```

Run monthly via cron:
```bash
# crontab -e
0 9 1 * * cd /path/to/mcp-typescript-simple && ./tools/collect-soc2-evidence.sh
```

---

## Compliance

**SOC-2 Type II Requirements:** Evidence collection procedures defined ✅
**Audit Readiness:** 6-12 months operational evidence required ✅
**Retention:** 7 years (industry standard) ✅

---

## Related Documentation

- [Compliance Mapping](./compliance-mapping.md) - Control mappings
- [Incident Response Playbook](./incident-response-playbook.md) - CC7.3 evidence
- [Key Rotation Procedures](./key-rotation-procedures.md) - CC6.6 evidence
- [OCSF Event Catalog](../observability/ocsf-event-catalog.md) - Event reference
