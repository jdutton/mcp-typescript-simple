# Incident Response Playbook

**Last Updated:** 2025-11-02
**Version:** 1.0
**Owner:** Security Team / CTO

## Quick Reference

| Severity | Response Time | Escalation | Examples |
|----------|--------------|------------|----------|
| **P0 - Critical** | < 15 min | Immediate (CEO/CTO) | Data breach, key compromise, production outage |
| **P1 - High** | < 1 hour | Security team lead | Failed auth attempts, suspicious activity |
| **P2 - Medium** | < 4 hours | On-call engineer | Configuration drift, failed deployments |
| **P3 - Low** | < 24 hours | Standard ticket | Log warnings, performance degradation |

---

## Phase 1: Detection & Triage (0-15 minutes)

### Step 1: Identify the Incident

**Detection Methods:**
- OCSF security events in SIEM (Grafana/Loki)
- Failed authentication alerts
- Unexpected API errors
- User reports
- Health check failures

**Initial Questions:**
- What triggered the alert?
- Is this affecting users?
- What systems are impacted?
- Is data at risk?

### Step 2: Classify Severity

Use the severity matrix above to classify the incident.

### Step 3: Assemble Response Team

**P0/P1 Incidents:**
- Incident Commander (IC): CTO or Security Lead
- Technical Lead: Senior Engineer
- Communications: Product Manager
- Scribe: Junior Engineer (document everything)

**P2/P3 Incidents:**
- On-call engineer handles solo
- Escalate if needed

---

## Phase 2: Containment (15-60 minutes)

### Goal: Stop the bleeding, prevent spread

### Common Containment Actions

#### 1. Suspected Key Compromise

```bash
# IMMEDIATE: Rotate compromised key
# Follow: docs/security/key-rotation-procedures.md

# Revoke all active sessions
curl -X DELETE https://your-app.vercel.app/admin/sessions/all \
  -H "Authorization: Bearer <ADMIN_TOKEN>"

# Enable maintenance mode (if available)
vercel env add MAINTENANCE_MODE true production
```

#### 2. Suspicious Authentication Activity

```bash
# Check OCSF authentication events
# Loki query: {ocsf_class_name="Authentication"}

# Block IP address (Vercel firewall)
# Go to: Vercel Dashboard → Firewall → Add Rule

# Revoke specific user sessions
curl -X DELETE https://your-app.vercel.app/admin/sessions/SESSION_ID \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

#### 3. Production Outage

```bash
# Check health status
curl https://your-app.vercel.app/health

# Check Vercel logs
vercel logs --prod --follow

# Rollback to last known good deployment
vercel rollback

# Check Redis connectivity
redis-cli -u $REDIS_URL ping
```

#### 4. Data Exposure

```bash
# IMMEDIATE: Identify scope
# - What data was exposed?
# - Who had access?
# - How long was it exposed?

# Rotate all encryption keys
# Follow: docs/security/key-rotation-procedures.md

# Notify affected users (if PII exposed)
# Follow GDPR Article 33 (72-hour notification)
```

---

## Phase 3: Investigation (1-4 hours)

### Goal: Understand what happened

### Evidence Collection

**1. Capture System State**

```bash
# Current deployment info
vercel inspect --prod

# Environment variables (sanitized)
vercel env ls

# Recent deployments
vercel ls --prod

# Current git commit
git log -1 --oneline
```

**2. Collect Logs**

```bash
# OCSF security events
# Grafana query: {ocsf_class_name!=""}

# Authentication failures
# Loki query: {ocsf_class_name="Authentication"} |= "failure"

# API errors (last 24 hours)
# Loki query: {level="error"} |= "api"

# Export logs
curl -G 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={level="error"}' \
  --data-urlencode 'start=2024-01-01T00:00:00Z' \
  --data-urlencode 'end=2024-01-02T00:00:00Z' \
  > incident-logs.json
```

**3. Timeline Reconstruction**

Create timeline in incident doc:
```
2024-01-01 14:23:15 UTC - First failed auth attempt detected
2024-01-01 14:23:45 UTC - Multiple failed attempts from IP 1.2.3.4
2024-01-01 14:24:00 UTC - Rate limiting triggered
2024-01-01 14:24:30 UTC - IP blocked via firewall
```

**4. Impact Assessment**

Answer:
- How many users affected?
- What data was accessed?
- How long was the issue present?
- What systems were compromised?

---

## Phase 4: Eradication (4-8 hours)

### Goal: Remove the threat

### Root Cause Analysis

**5 Whys Method:**
```
Problem: Unauthorized access to admin endpoint
Why? - No rate limiting on auth endpoint
Why? - Rate limiting handled at infrastructure level
Why? - Vercel firewall not configured
Why? - Initial deployment didn't include firewall rules
Why? - Deployment checklist incomplete

Root Cause: Missing firewall configuration in deployment
```

### Remediation Actions

1. **Fix the vulnerability**
   - Deploy code fix
   - Update configuration
   - Apply security patches

2. **Verify fix**
   - Test with reproduction steps
   - Validate no regression
   - Check health endpoints

3. **Prevent recurrence**
   - Add automated checks (vibe-validate)
   - Update deployment checklist
   - Add monitoring alerts

---

## Phase 5: Recovery (8-24 hours)

### Goal: Return to normal operations

### Recovery Steps

```bash
# 1. Disable maintenance mode
vercel env rm MAINTENANCE_MODE production

# 2. Verify all systems operational
curl https://your-app.vercel.app/health

# 3. Monitor for 24 hours
vercel logs --prod --follow

# 4. Check OCSF events for anomalies
# Grafana: Monitor security dashboard
```

### User Communication

**If user data affected:**
- Send notification within 72 hours (GDPR)
- Explain what happened
- What data was affected
- What you're doing about it
- What users should do

**Template:**
```
Subject: Security Incident Notification

We are writing to inform you of a security incident that may have affected your account.

What happened: [Brief description]
What data was affected: [Specific data types]
What we've done: [Remediation actions]
What you should do: [User actions, if any]

We take security seriously and have implemented additional safeguards to prevent similar incidents.

For questions, contact: security@example.com
```

---

## Phase 6: Post-Incident Review (24-72 hours)

### Goal: Learn and improve

### Post-Incident Report Template

```markdown
# Incident Report: [Title]

**Date:** YYYY-MM-DD
**Severity:** P0/P1/P2/P3
**Duration:** X hours
**Impact:** X users affected

## Summary
[Brief description]

## Timeline
[Detailed timeline from detection to resolution]

## Root Cause
[5 Whys analysis]

## Resolution
[What fixed it]

## Action Items
- [ ] Update deployment checklist
- [ ] Add automated validation
- [ ] Enhance monitoring
- [ ] Update documentation

## Lessons Learned
[What went well, what didn't]
```

### Follow-Up Actions

1. **Update documentation**
   - Add to incident log
   - Update runbooks
   - Improve detection

2. **Improve detection**
   - Add monitoring alerts
   - Enhance OCSF events
   - Update SIEM queries

3. **Prevent recurrence**
   - Add validation checks
   - Update security scanners
   - Automate manual steps

---

## Incident Types & Playbooks

### 1. Data Breach

**Indicators:**
- Unauthorized data export
- Unexpected database queries
- Unusual API usage patterns

**Response:**
1. Immediate containment (revoke sessions, rotate keys)
2. Identify scope (what data, how much, who)
3. Legal/compliance notification (GDPR 72 hours)
4. User notification
5. Forensic analysis

**Legal Requirements:**
- GDPR Article 33: Notify DPA within 72 hours
- GDPR Article 34: Notify users if high risk
- CCPA: Notify users within "reasonable time"

### 2. DDoS Attack

**Indicators:**
- Sudden traffic spike
- Health check failures
- High error rates

**Response:**
1. Verify attack (legitimate traffic vs attack)
2. Enable Vercel DDoS protection
3. Rate limit at edge
4. Block attacking IPs
5. Scale infrastructure if needed

### 3. Credential Stuffing

**Indicators:**
- Multiple failed auth attempts
- Attempts from bot IPs
- User account takeover reports

**Response:**
1. Enable rate limiting (Vercel firewall)
2. Force password resets for affected accounts
3. Implement CAPTCHA if not present
4. Review OCSF authentication events
5. Block attacking IP ranges

### 4. Insider Threat

**Indicators:**
- Unusual admin access patterns
- After-hours database access
- Data exfiltration attempts

**Response:**
1. Isolate compromised account
2. Revoke all access immediately
3. Forensic analysis of OCSF audit logs
4. HR/legal involvement
5. Review access controls

### 5. Supply Chain Compromise

**Indicators:**
- Suspicious npm package updates
- Unexpected dependency changes
- Malicious code in dependencies

**Response:**
1. Identify compromised package
2. Rollback to last known good version
3. Audit for data exfiltration
4. Rotate all secrets
5. Report to npm security

---

## Communication Templates

### Internal Notification (Slack/Teams)

```
🚨 **SECURITY INCIDENT - P0**

**What:** Suspected key compromise
**Impact:** All production users
**Status:** Containment in progress
**Incident Commander:** @john-doe
**War Room:** #incident-response
**ETA to Resolution:** 2 hours
```

### Status Update (Every 30 min for P0/P1)

```
**Status Update - 14:30 UTC**
- ✅ Keys rotated
- ✅ Sessions revoked
- ⏳ Monitoring for anomalies
- Next update: 15:00 UTC
```

### All-Clear Notification

```
✅ **INCIDENT RESOLVED**

The security incident has been resolved. All systems are operational.

**What happened:** [Brief summary]
**Resolution:** [What fixed it]
**Impact:** [Users affected]
**Next steps:** Post-incident review tomorrow

Normal operations resumed.
```

---

## Tools & Resources

**Incident Management:**
- Incident log: `docs/security/incidents/`
- War room: Slack #incident-response
- On-call schedule: PagerDuty

**Monitoring:**
- OCSF Events: Grafana Loki (http://localhost:3200)
- Vercel Logs: `vercel logs --prod`
- Health Check: `GET /health`

**Escalation:**
- P0/P1: CEO/CTO immediately
- P2: Security team lead within 1 hour
- P3: Standard ticket queue

---

## Compliance

**SOC-2 CC7.3:** Incident response procedures defined ✅
**ISO 27001 A.16.1:** Incident management process implemented ✅
**GDPR Article 33:** Breach notification procedures documented ✅

---

## Related Documentation

- [Key Rotation Procedures](./key-rotation-procedures.md)
- [Security Implementation Status](./implementation-status.md)
- [OCSF Event Catalog](../observability/ocsf-event-catalog.md)
