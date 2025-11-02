# Key Rotation Procedures

**Last Updated:** 2025-11-02
**Rotation Frequency:** Every 90 days (recommended) or immediately after suspected compromise

## Overview

This runbook provides step-by-step procedures for rotating encryption keys and secrets used by the MCP server. Key rotation is a critical security practice that limits the impact of key compromise.

**Keys That Need Rotation:**
1. `TOKEN_ENCRYPTION_KEY` - Encrypts tokens in Redis (AES-256-GCM)
2. OAuth client secrets (Google, GitHub, Microsoft)
3. LLM provider API keys (Anthropic, OpenAI, Google)
4. Redis credentials (REDIS_URL password)
5. Initial access tokens (admin authentication)

---

## 1. TOKEN_ENCRYPTION_KEY Rotation

**Frequency:** Every 90 days or immediately after suspected compromise

**Impact:** High - Requires re-encryption of all stored tokens

### Pre-Rotation Checklist

- [ ] Schedule maintenance window (30-60 minutes)
- [ ] Backup Redis database: `redis-cli --rdb /backup/redis-snapshot.rdb`
- [ ] Notify users of planned maintenance (if applicable)
- [ ] Have rollback plan ready

### Rotation Steps

#### Step 1: Generate New Key

```bash
# Generate new 32-byte encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Example output: Wp3suOcV+cleewUEOGUkE7JNgsnzwmiBMNqF7q9sQSI=
```

#### Step 2: Add New Key to Environment (Dual-Key Mode)

```bash
# Vercel: Add both keys temporarily
vercel env add TOKEN_ENCRYPTION_KEY_NEW production
# Paste new key when prompted

# Keep old key as TOKEN_ENCRYPTION_KEY (reads old data)
# New key as TOKEN_ENCRYPTION_KEY_NEW (writes new data)
```

#### Step 3: Deploy Dual-Key Reader

**Create migration script** (`tools/rotate-encryption-key.ts`):

```typescript
import { RedisTokenStore } from '@mcp-typescript-simple/persistence';

const oldKey = process.env.TOKEN_ENCRYPTION_KEY;
const newKey = process.env.TOKEN_ENCRYPTION_KEY_NEW;

// 1. Read all tokens with old key
// 2. Re-encrypt with new key
// 3. Write back to Redis
```

#### Step 4: Run Migration

```bash
# Local test with Redis backup
REDIS_URL=redis://localhost:6379 \
TOKEN_ENCRYPTION_KEY=OLD_KEY \
TOKEN_ENCRYPTION_KEY_NEW=NEW_KEY \
npx tsx tools/rotate-encryption-key.ts

# Production (after testing)
vercel env pull .env.production
npx tsx tools/rotate-encryption-key.ts --production
```

#### Step 5: Swap Keys

```bash
# Remove old key, promote new key
vercel env rm TOKEN_ENCRYPTION_KEY production
vercel env add TOKEN_ENCRYPTION_KEY production
# Paste NEW key (was TOKEN_ENCRYPTION_KEY_NEW)

vercel env rm TOKEN_ENCRYPTION_KEY_NEW production
```

#### Step 6: Redeploy

```bash
git push origin main  # Triggers deployment
# Or: vercel --prod
```

#### Step 7: Verify

```bash
# Check health endpoint
curl https://your-app.vercel.app/health | jq '.storage'

# Should show:
# {
#   "environment": "production",
#   "backend": "redis",
#   "redisConfigured": true,
#   "valid": true
# }

# Test OAuth login flow
# Test admin endpoints with initial access token
```

### Post-Rotation

- [ ] Verify all endpoints working
- [ ] Monitor error logs for 24 hours
- [ ] Document rotation in security log
- [ ] Schedule next rotation (90 days)

### Rollback Procedure

If rotation fails:

```bash
# 1. Restore Redis from backup
redis-cli --rdb /backup/redis-snapshot.rdb

# 2. Revert environment variable
vercel env rm TOKEN_ENCRYPTION_KEY production
vercel env add TOKEN_ENCRYPTION_KEY production
# Paste OLD key

# 3. Redeploy
git revert HEAD
git push origin main
```

---

## 2. OAuth Client Secret Rotation

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

## 3. LLM Provider API Key Rotation

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

## 4. Redis Credentials Rotation

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

## 5. Initial Access Token Rotation

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
| TOKEN_ENCRYPTION_KEY | 90 days | YYYY-MM-DD | YYYY-MM-DD |
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
