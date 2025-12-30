# Key Rotation Procedures

**Last Updated:** 2025-11-02
**Rotation Frequency:** Every 90 days (recommended) or immediately after suspected compromise

## Overview

This runbook provides step-by-step procedures for rotating encryption keys and secrets used by the MCP server. Key rotation is a critical security practice that limits the impact of key compromise.

**Keys That Need Rotation:**
1. OAuth client secrets (Google, GitHub, Microsoft)
2. LLM provider API keys (Anthropic, OpenAI, Google)
3. Redis credentials (REDIS_URL password)
4. Initial access tokens (admin authentication)

**Note:** TOKEN_ENCRYPTION_KEY was removed in ADR 006 (Session-Based Authentication Caching). Tokens are no longer stored server-side.

---

## 1. OAuth Client Secret Rotation

**Frequency:** Every 180 days or after compromise

### Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to: APIs & Services → Credentials
3. Select your OAuth 2.0 Client ID
4. Click "Reset Secret" → Generate new secret
5. Update Vercel environment:
   ```bash
   vercel env add GOOGLE_CLIENT_SECRET production
   # Paste new secret
   ```
6. Redeploy: `git push origin main`

### GitHub OAuth

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Select your OAuth App
3. Click "Generate a new client secret"
4. Update Vercel environment:
   ```bash
   vercel env add GITHUB_CLIENT_SECRET production
   # Paste new secret
   ```
5. Revoke old secret after confirming new one works
6. Redeploy: `git push origin main`

### Microsoft OAuth

1. Go to [Azure Portal](https://portal.azure.com/)
2. Navigate to: Azure Active Directory → App Registrations
3. Select your application
4. Certificates & secrets → New client secret
5. Update Vercel environment:
   ```bash
   vercel env add MICROSOFT_CLIENT_SECRET production
   # Paste new secret
   ```
6. Delete old secret after confirming new one works
7. Redeploy: `git push origin main`

---

## 2. LLM Provider API Key Rotation

**Frequency:** Every 90 days or after compromise

### Anthropic (Claude)

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Settings → API Keys → Create Key
3. Update Vercel environment:
   ```bash
   vercel env add ANTHROPIC_API_KEY production
   # Paste new key
   ```
4. Delete old key after confirmation
5. Test: `curl /health | jq '.llm_providers'`

### OpenAI

1. Go to [OpenAI Platform](https://platform.openai.com/)
2. API Keys → Create new secret key
3. Update Vercel environment:
   ```bash
   vercel env add OPENAI_API_KEY production
   # Paste new key
   ```
4. Revoke old key after confirmation

### Google AI (Gemini)

1. Go to [Google AI Studio](https://makersuite.google.com/)
2. Get API Key → Create API Key
3. Update Vercel environment:
   ```bash
   vercel env add GOOGLE_API_KEY production
   # Paste new key
   ```
4. Delete old key after confirmation

---

## 3. Redis Credentials Rotation

**Frequency:** Every 90 days or after compromise

### Upstash Redis

1. Go to [Upstash Console](https://console.upstash.com/)
2. Select your database
3. Details → Reset Password
4. Update REDIS_URL:
   ```bash
   # New URL format: redis://default:NEW_PASSWORD@host:port
   vercel env add REDIS_URL production
   # Paste new URL with new password
   ```
5. Redeploy immediately (old password invalidated)

**CRITICAL**: Zero-downtime rotation not possible. Plan maintenance window.

---

## 4. Initial Access Token Rotation

**Frequency:** After each use (recommended) or every 30 days

### Manual Rotation

```bash
# Generate new token
curl -X POST https://your-app.vercel.app/admin/tokens/initial \
  -H "Content-Type: application/json" \
  -d '{"expiresIn": 3600}'

# Use token once for DCR
# Then revoke it
curl -X DELETE https://your-app.vercel.app/admin/tokens/initial/TOKEN_ID \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

### Automated Rotation (Recommended)

Create cron job to rotate tokens monthly:

```typescript
// tools/rotate-admin-tokens.ts
import { TokenStoreFactory } from '@mcp-typescript-simple/persistence';

async function rotateTokens() {
  const store = await TokenStoreFactory.create();

  // 1. List all tokens
  // 2. Delete expired tokens (> 30 days old)
  // 3. Generate new token for upcoming needs
}
```

---

## Rotation Schedule

| Key/Secret | Frequency | Last Rotated | Next Rotation |
|------------|-----------|--------------|---------------|
| GOOGLE_CLIENT_SECRET | 180 days | YYYY-MM-DD | YYYY-MM-DD |
| GITHUB_CLIENT_SECRET | 180 days | YYYY-MM-DD | YYYY-MM-DD |
| MICROSOFT_CLIENT_SECRET | 180 days | YYYY-MM-DD | YYYY-MM-DD |
| ANTHROPIC_API_KEY | 90 days | YYYY-MM-DD | YYYY-MM-DD |
| OPENAI_API_KEY | 90 days | YYYY-MM-DD | YYYY-MM-DD |
| GOOGLE_API_KEY | 90 days | YYYY-MM-DD | YYYY-MM-DD |
| REDIS_URL (password) | 90 days | YYYY-MM-DD | YYYY-MM-DD |

---

## Automation (Future Enhancement)

**Recommended Tools:**
- **HashiCorp Vault**: Automated secret rotation with dynamic credentials
- **AWS Secrets Manager**: Automatic rotation with Lambda
- **Azure Key Vault**: Managed rotation policies
- **Google Secret Manager**: Rotation with Cloud Functions

**Implementation Priority:** Medium (manual rotation sufficient for current scale)

---

## Security Incident Response

**If key compromise suspected:**

1. **IMMEDIATE** - Rotate compromised key(s) following emergency procedures
2. Revoke all active sessions: `DELETE /admin/sessions/all`
3. Audit access logs for unauthorized activity
4. Review OCSF security events in SIEM
5. Document incident in security log
6. Conduct post-incident review

---

## Compliance

**SOC-2 CC6.6.4:** Key rotation procedures documented ✅
**ISO 27001 A.10.1.2:** Key management procedures defined ✅
**NIST SP 800-57:** Cryptographic key management lifecycle implemented ✅

---

## Related Documentation

- [Encryption Infrastructure (ADR-004)](../adr/004-encryption-infrastructure.md)
- [Secrets Management](../../CLAUDE.md#secrets-management)
- [Incident Response Playbook](./incident-response-playbook.md)
