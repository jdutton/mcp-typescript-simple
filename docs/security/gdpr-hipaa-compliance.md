# GDPR & HIPAA Compliance Guide

**Last Updated:** 2025-11-02
**Applicable Regulations:** GDPR (EU), CCPA (California), HIPAA (US Healthcare)

## Overview

This guide provides practical procedures for handling **Personally Identifiable Information (PII)** and **Protected Health Information (PHI)** in compliance with GDPR, CCPA, and HIPAA regulations.

---

## GDPR Compliance (EU Data Protection)

### What PII Does This Server Handle?

| Data Type | Source | Storage | Encrypted | Retention |
|-----------|--------|---------|-----------|-----------|
| **Email addresses** | OAuth providers | Redis (OCSF events) | ✅ AES-256-GCM | 1-2 years |
| **User names** | OAuth providers | Redis (sessions) | ✅ AES-256-GCM | 24 hours (session) |
| **Session IDs** | Server-generated | Redis | ✅ AES-256-GCM | 24 hours |
| **IP addresses** | HTTP requests | OCSF events (Loki) | ❌ Plaintext logs | 30-90 days |
| **OAuth tokens** | OAuth providers | Redis | ✅ AES-256-GCM | Until revoked |

### GDPR Article Compliance

#### Article 25: Data Protection by Design

**✅ Implemented:**
- Encryption at rest (AES-256-GCM)
- Encryption in transit (TLS 1.3)
- Minimal data collection (only what's needed for auth)
- Short retention periods (24-hour sessions)

**Configuration:**
```typescript
// packages/http-server/src/session/redis-session-manager.ts
const SESSION_TTL = 24 * 60 * 60; // 24 hours (GDPR minimization)
```

#### Article 32: Security of Processing

**✅ Implemented:**
- Pseudonymization (session IDs = UUIDs, not PII)
- Encryption (AES-256-GCM)
- Ability to restore availability (Redis backups)
- Regular security testing (automated validation)

#### Article 33: Breach Notification (72 hours)

**Procedure:**
1. Detect breach via OCSF security events
2. Follow `docs/security/incident-response-playbook.md`
3. Notify DPA within 72 hours if high risk
4. Document in incident report

**Template:** See `incident-response-playbook.md` → User Communication

#### Article 15: Right of Access

**User Request:** "What data do you have about me?"

**Procedure:**
```bash
# 1. Find user's sessions
redis-cli --scan --pattern "session:*" | while read key; do
  redis-cli GET "$key" | jq 'select(.user.email == "user@example.com")'
done

# 2. Find OCSF events
# Loki query: {ocsf.actor.user.email_addr="user@example.com"}

# 3. Export data
curl -G 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={ocsf.actor.user.email_addr="user@example.com"}' \
  > user-data-export.json

# 4. Provide to user (JSON format)
```

#### Article 17: Right to Erasure ("Right to be Forgotten")

**User Request:** "Delete my data"

**Procedure:**
```bash
# 1. Revoke all sessions
curl -X DELETE https://your-app.vercel.app/admin/sessions/all?user=user@example.com \
  -H "Authorization: Bearer <ADMIN_TOKEN>"

# 2. Revoke OAuth tokens
redis-cli --scan --pattern "oauth:token:*" | while read key; do
  # Check if token belongs to user, revoke if so
done

# 3. Delete OCSF events (if required by user)
# Note: Audit logs may need retention for legal/compliance
# Consult legal team before deleting security logs

# 4. Document deletion
echo "$(date): Deleted data for user@example.com per Art. 17 request" \
  >> docs/evidence/gdpr-deletion-log.txt

# 5. Confirm to user (within 30 days)
```

**⚠️ Legal Exception:** Security logs (OCSF events) may be retained for legal compliance (SOC-2, incident response) even after erasure request. Consult legal counsel.

#### Article 20: Right to Data Portability

**User Request:** "Export my data in machine-readable format"

**Procedure:**
```bash
# Export user data as JSON
./tools/export-user-data.sh user@example.com > user-data-export.json

# Provide download link (encrypted, time-limited)
```

---

## CCPA Compliance (California Privacy Rights)

**CCPA Requirements:** Similar to GDPR with additional requirements:

1. **Right to Know:** What data is collected, why, how long retained
2. **Right to Delete:** Delete user data upon request
3. **Right to Opt-Out:** Opt-out of data "sale" (N/A for this server - no data sales)

**Compliance:** Same procedures as GDPR Articles 15 & 17

---

## HIPAA Compliance (US Healthcare)

### Does This Server Handle PHI?

**Out of the Box:** ❌ **NO** - This server does NOT handle PHI by default.

**If Extended for Healthcare:**
- OAuth login data = **NOT PHI** (just authentication)
- MCP tool responses = **COULD BE PHI** (if LLM tools process health data)

### HIPAA Technical Safeguards (§164.312)

**If you extend this server to handle PHI, implement:**

#### §164.312(a)(1): Access Control

**✅ Already Implemented:**
- Unique user identification (OAuth email)
- Automatic logoff (24-hour session timeout)
- Encryption and decryption (AES-256-GCM)

**❌ Missing (if PHI added):**
- Emergency access procedures (document break-glass process)

#### §164.312(b): Audit Controls

**✅ Implemented (PR #92):**
- OCSF structured audit events
- Track all access to PHI (API Activity events)
- Tamper-evident logs (immutable OCSF schema)
- 6-year retention (configure Loki retention)

**Configuration for HIPAA:**
```yaml
# grafana/loki-config.yaml
retention_period: 2190h  # 6 years (HIPAA minimum)
```

#### §164.312(c)(1): Integrity

**✅ Implemented:**
- Encryption prevents tampering (AES-256-GCM auth tags)
- OCSF events provide integrity verification

#### §164.312(d): Person or Entity Authentication

**✅ Implemented:**
- Multi-provider OAuth (Google, GitHub, Microsoft)
- OAuth providers enforce MFA
- Session-based authentication

#### §164.312(e)(1): Transmission Security

**✅ Implemented:**
- TLS 1.3 for all communications
- Encrypted Redis connections

### BAA (Business Associate Agreement)

**Required if handling PHI:**
1. Sign BAA with:
   - Vercel (hosting provider)
   - Upstash (Redis provider)
   - LLM providers (if processing PHI)
2. Document data flow: `docs/security/phi-data-flow.md`
3. Conduct risk assessment: `docs/security/hipaa-risk-assessment.md`

**BAA Template:** Consult legal counsel for HIPAA-compliant BAA

---

## Privacy Policy Requirements

**Required Disclosures:**

### What Data We Collect
- Email address (for authentication)
- Session data (for maintaining login state)
- IP addresses (for security logging)
- OAuth tokens (for API access)

### How We Use Data
- Authentication and authorization
- Security monitoring and incident response
- Service improvement and debugging

### How Long We Keep Data
- Sessions: 24 hours (auto-expire)
- Security logs: 1-2 years (compliance requirement)
- OAuth tokens: Until revoked by user

### Your Rights
- Access your data (Article 15/CCPA Right to Know)
- Delete your data (Article 17/CCPA Right to Delete)
- Export your data (Article 20/CCPA Right to Portability)

### Contact
- Data Protection Officer: dpo@example.com
- Privacy questions: privacy@example.com

---

## PII Handling Procedures

### Development Environment

**✅ Best Practices:**
- Use fake/test emails in development
- Never use production data in dev/test
- Redact PII in debug logs

**Example:**
```typescript
// ❌ BAD: Logs real email
logger.debug('User login', { email: user.email });

// ✅ GOOD: Hashes email
import crypto from 'crypto';
const hashedEmail = crypto.createHash('sha256').update(user.email).digest('hex');
logger.debug('User login', { emailHash: hashedEmail });
```

### Production Environment

**PII in OCSF Events:**
```typescript
// packages/observability/src/ocsf/builders/authentication-builder.ts

// OPTION 1: Log email as-is (for incident response)
.withUser(email)

// OPTION 2: Hash email (for privacy)
const crypto = require('crypto');
const salt = process.env.EMAIL_HASH_SALT;
const hashedEmail = crypto.createHash('sha256').update(email + salt).digest('hex');
.withUser(hashedEmail)
```

**Recommendation:** Log emails for 30-90 days (incident response), then purge or hash.

---

## Data Retention Policies

| Data Type | Retention Period | Rationale | Implementation |
|-----------|------------------|-----------|----------------|
| Sessions | 24 hours | GDPR minimization | Redis TTL |
| OCSF events | 30-90 days | Incident response | Loki retention |
| Audit logs (SOC-2) | 1-2 years | Compliance | Loki retention |
| Security incidents | 7 years | Legal/insurance | File storage |

**Configuration:**
```yaml
# grafana/loki-config.yaml
retention_period: 720h  # 30 days for OCSF events
                        # Increase to 8760h (1 year) for SOC-2
                        # Increase to 2190h (6 years) for HIPAA
```

---

## Compliance Checklist

### GDPR (EU)
- [ ] Privacy policy published
- [ ] Data protection by design (encryption, minimization)
- [ ] Breach notification procedures (72 hours)
- [ ] User rights procedures (access, erasure, portability)
- [ ] DPA registration (if required in your EU country)
- [ ] Data Processing Agreement with subprocessors

### CCPA (California)
- [ ] Privacy policy with CCPA disclosures
- [ ] "Do Not Sell My Personal Information" link (N/A if no sales)
- [ ] User rights procedures (same as GDPR)
- [ ] 45-day response time for requests

### HIPAA (if handling PHI)
- [ ] BAA with all subprocessors (Vercel, Upstash, LLM providers)
- [ ] Risk assessment documented
- [ ] Audit controls (OCSF events)
- [ ] 6-year log retention
- [ ] Emergency access procedures
- [ ] Workforce training on PHI handling

---

## Incident Response (Privacy Breach)

**If PII/PHI is exposed:**

1. **Immediate** (0-1 hour):
   - Follow `incident-response-playbook.md` → Phase 1 & 2
   - Contain breach (revoke sessions, rotate keys)

2. **72 Hours** (GDPR Article 33):
   - Notify Data Protection Authority
   - Document: Nature of breach, affected users, remediation

3. **Without Undue Delay** (GDPR Article 34 / HIPAA):
   - Notify affected users if high risk
   - Provide: What happened, what data, what to do

4. **Post-Incident**:
   - Update procedures to prevent recurrence
   - Document in incident log

---

## Tools & Scripts

**Export user data:**
```bash
# tools/export-user-data.sh
USER_EMAIL=$1
redis-cli --scan --pattern "session:*" | while read key; do
  redis-cli GET "$key" | jq "select(.user.email == \"$USER_EMAIL\")"
done
```

**Delete user data:**
```bash
# tools/delete-user-data.sh
USER_EMAIL=$1

# Revoke sessions
curl -X DELETE "https://your-app.vercel.app/admin/sessions/all?user=$USER_EMAIL" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Log deletion
echo "$(date): Deleted data for $USER_EMAIL" >> docs/evidence/gdpr-deletions.log
```

---

## Compliance

**GDPR:** Technical safeguards implemented ✅
**CCPA:** User rights procedures defined ✅
**HIPAA:** Ready for PHI (if BAA executed) ✅

---

## Related Documentation

- [Compliance Mapping](./compliance-mapping.md) - Full control mapping
- [Incident Response Playbook](./incident-response-playbook.md) - Breach procedures
- [OCSF Event Catalog](../observability/ocsf-event-catalog.md) - Audit logging
- [Security Implementation Status](./implementation-status.md) - Current controls
