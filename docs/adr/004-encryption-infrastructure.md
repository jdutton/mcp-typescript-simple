# ADR-004: Encryption Infrastructure and Hard Security Stance

**Date:** 2025-10-26
**Status:** ✅ Accepted and Implemented
**Related Issue:** #89 - Enterprise-Grade Security Implementation
**Supersedes:** None
**Superseded By:** None

**Note:** References to "phases" in this document are historical implementation tracking artifacts from the original PR. After merging to main, all encryption infrastructure exists as a unified feature set.

## Context

The MCP TypeScript Simple server initially stored sensitive data (OAuth tokens, access tokens, session data) in **plaintext** across multiple storage backends (Redis, file-based, in-memory). This created significant security risks:

1. **Plaintext Token Storage:** OAuth tokens, access tokens, and refresh tokens stored without encryption
2. **Plaintext PII:** Email addresses, user IDs, and provider information visible in Redis
3. **Redis Key Exposure:** OAuth tokens exposed in Redis key names (e.g., `oauth:token:ya29.a0ATi6K2...`)
4. **No Key Management:** No secrets management infrastructure
5. **Compliance Risk:** Violations of SOC-2, ISO 27001, GDPR, and HIPAA requirements

### Security Audit Results

**Initial Security Score:** ~71.5/100 (Medium-High Risk)

**Critical Gaps Identified:**
- Encryption at rest: ❌ Not implemented
- Key management: ❌ No infrastructure
- Secrets management: ❌ No abstraction
- Compliance readiness: ❌ Cannot certify

**Risk Assessment:**
- **Severity:** Critical (P0)
- **Impact:** Production data breach, compliance violations, customer trust loss
- **Likelihood:** High (read-only Redis access compromises all tokens)

## Decision

We will implement a **comprehensive encryption infrastructure** with the following principles:

### 1. Hard Security Stance: Encryption is Mandatory

**Decision:** All sensitive data MUST be encrypted at rest with NO optional/fallback modes.

**Rationale:**
- Security is not negotiable - encryption cannot be optional
- Fail-fast approach prevents silent security vulnerabilities
- Forces conscious decisions about security in all environments

**Implementation:**
- Encryption service is REQUIRED parameter (not optional)
- No plaintext fallback - decrypt errors cause hard failures
- Constructor signatures enforce encryption at compile-time

**Example:**
```typescript
// BEFORE (WRONG - encryption optional)
constructor(encryptionService?: TokenEncryptionService)

// AFTER (CORRECT - encryption mandatory)
constructor(encryptionService: TokenEncryptionService)
```

### 2. Encryption Algorithm: AES-256-GCM

**Decision:** Use AES-256-GCM for all token encryption with PBKDF2 key derivation.

**Rationale:**
- **AES-256-GCM:** NIST-approved, authenticated encryption (confidentiality + integrity)
- **PBKDF2:** Industry-standard key derivation (100,000 iterations)
- **Authenticated encryption:** Detects tampering (MAC validation)
- **Compliance:** SOC-2, ISO 27001, GDPR, HIPAA approved

**Alternatives Considered:**
| Algorithm | Why Rejected |
|-----------|--------------|
| AES-256-CBC | No built-in authentication (vulnerable to tampering) |
| ChaCha20-Poly1305 | Less widely supported, Node.js crypto limitations |
| RSA | Too slow for large-scale token encryption, key management complexity |

**Technical Specifications:**
- Algorithm: AES-256-GCM (256-bit key)
- Key derivation: PBKDF2-HMAC-SHA256 (100,000 iterations)
- IV: Random 12-byte nonce (unique per encryption)
- Auth tag: 16 bytes (128-bit MAC)
- Encoding: Base64 for storage

### 3. Secrets Management Abstraction

**Decision:** Create a provider-based secrets management system supporting multiple backends.

**Rationale:**
- Development needs different secrets management than production
- Enterprise customers require HashiCorp Vault, AWS Secrets Manager, etc.
- Abstraction enables future integrations without code changes
- Testability requires mock providers

**Providers Implemented:**
1. **VercelSecretsProvider:** Production (environment variables)
2. **VaultSecretsProvider:** Enterprise (HashiCorp Vault)
3. **EncryptedFileSecretsProvider:** Development (local encrypted files)
4. **FileSecretsProvider:** Testing only (plaintext files)
5. **Generic interface:** Custom provider support

**Provider Selection:**
```typescript
// Auto-detection based on environment
const provider = SecretsFactory.createProvider();

// Or explicit provider for testing
const provider = new FileSecretsProvider('./secrets.json');
```

### 4. SHA-256 Key Hashing for Redis

**Decision:** Hash all sensitive data before using as Redis key names.

**Critical Discovery (Docker Testing):**
OAuth tokens were exposed in Redis **key names**, not just values:
- `oauth:token:ya29.a0ATi6K2...` ← Real Google access token visible
- `oauth:refresh:1//01qcb1z...` ← Real refresh token visible

**Risk:** Read-only Redis access exposes usable, valid tokens.

**Solution:**
```typescript
// BEFORE (WRONG - token exposed in key name)
await redis.set(`oauth:token:${accessToken}`, encryptedData);

// AFTER (CORRECT - token hashed before use)
const hashedKey = sha256(accessToken);
await redis.set(`oauth:token:${hashedKey}`, encryptedData);
```

**Implementation:**
- `TokenEncryptionService.hashKey()` - SHA-256 hashing utility
- Applied to `RedisTokenStore` - all token keys hashed
- Applied to `RedisOAuthTokenStore` - access tokens and refresh tokens hashed
- Applied to `RedisMCPMetadataStore` - session data encrypted

### 5. No Backward Compatibility

**Decision:** No support for decrypting old plaintext data. Production Redis will be flushed.

**Rationale:**
- Security fix, not a feature - backward compatibility is a security risk
- Development Redis can be easily flushed (no production data)
- Production Redis (Upstash) will be cleared during deployment
- Enables clean, simple encryption code without compatibility layers

**Migration Strategy:**
1. Deploy encryption infrastructure to production
2. Flush production Redis (clears all unencrypted data)
3. Users re-authenticate (new encrypted sessions created)
4. No code complexity for supporting both encrypted and plaintext

**Impact:**
- All users logged out on deployment
- OAuth clients need to re-authenticate
- Sessions recreated with encryption automatically
- Zero data migration needed

## Implementation

### File Structure

**Encryption Infrastructure:**
```
packages/persistence/src/encryption/
├── token-encryption-service.ts  # AES-256-GCM implementation
└── index.ts                      # Public API exports
```

**Secrets Management:**
```
packages/config/src/secrets/
├── secrets-provider.ts           # Interface definition
├── vercel-secrets-provider.ts    # Production provider
├── vault-secrets-provider.ts     # Enterprise provider
├── encrypted-file-secrets-provider.ts  # Development provider
├── file-secrets-provider.ts      # Testing provider
├── secrets-factory.ts            # Auto-detection factory
└── index.ts                      # Public API exports
```

**Token Store Updates:**
```
packages/persistence/src/stores/
├── redis/
│   ├── redis-token-store.ts           # ✅ Encryption + key hashing
│   ├── redis-oauth-token-store.ts     # ✅ Encryption + key hashing
│   └── redis-mcp-metadata-store.ts    # ✅ Encryption
├── file/
│   ├── file-token-store.ts            # ✅ Encryption
│   └── file-oauth-token-store.ts      # ✅ Encryption
└── memory/
    └── memory-test-token-store.ts     # ✅ No encryption (testing only)
```

### API Design

**TokenEncryptionService:**
```typescript
class TokenEncryptionService {
  constructor(encryptionKey: string);  // MANDATORY parameter

  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
  hashKey(input: string): string;  // SHA-256 for Redis keys
}
```

**Secrets Provider Interface:**
```typescript
interface SecretsProvider {
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
  listSecrets(): Promise<string[]>;
}
```

**Token Store Updates:**
```typescript
// BEFORE (no encryption)
class RedisTokenStore {
  constructor(redis: Redis) { ... }
}

// AFTER (mandatory encryption)
class RedisTokenStore {
  constructor(
    redis: Redis,
    encryptionService: TokenEncryptionService  // REQUIRED
  ) { ... }
}
```

### Factory Pattern for Encryption Service Creation

**Token Store Factories:**
```typescript
// packages/persistence/src/factories/token-store-factory.ts
class TokenStoreFactory {
  static async create(): Promise<TokenStore> {
    // 1. Detect storage backend (Redis vs file vs memory)
    // 2. Load encryption key from secrets provider
    // 3. Create TokenEncryptionService
    // 4. Create token store with encryption service
    // 5. Return fully configured store
  }
}
```

**Benefits:**
- Single place to manage encryption service creation
- Auto-detection of storage backend
- Automatic encryption key loading
- Type-safe factory methods

### Testing Strategy

**Unit Tests:**
- Encryption/decryption round-trip tests
- Key hashing uniqueness tests
- Decrypt error handling (fail-fast validation)
- Provider interface compliance tests

**Integration Tests:**
- Store creation with encryption service
- Token CRUD operations with encryption
- Redis key hashing verification (inspect raw Redis)
- Load-balanced session cleanup (7 tests)

**Test Coverage:**
- 968 unit tests passing (0 failures)
- 16 integration tests passing (encryption validation)
- Security scanners validate no plaintext storage

## Consequences

### Positive

1. **Security Posture Improved**
   - Before: ~71.5/100 (Medium-High Risk)
   - After: ~85/100 (Production-Ready)

2. **Compliance Readiness**
   - ✅ SOC-2 encryption requirements met
   - ✅ ISO 27001 cryptographic controls met
   - ✅ GDPR encryption at rest met
   - ✅ HIPAA encryption safeguards met

3. **No Silent Failures**
   - Decrypt errors cause hard failures (fail-fast)
   - Missing encryption keys detected at startup
   - No gradual security degradation

4. **Future-Proof Architecture**
   - Secrets provider abstraction enables enterprise integrations
   - Multiple storage backends supported (Redis, File, Memory)
   - Clean separation of concerns (encryption vs storage)

5. **Horizontal Scalability**
   - Redis encryption enables multi-instance deployments
   - Sessions work across Vercel serverless functions
   - Load-balanced environments fully supported

### Negative

1. **Performance Impact**
   - Encryption adds ~1-5ms per token operation
   - PBKDF2 key derivation adds ~50ms on startup (acceptable)
   - Redis key hashing adds ~<1ms per operation

2. **Operational Complexity**
   - Production deployments require `TOKEN_ENCRYPTION_KEY` environment variable
   - Key rotation procedures needed (Phase 6 future work)
   - Secrets management provider configuration

3. **Breaking Change**
   - All users logged out on production deployment
   - OAuth clients need to re-authenticate
   - Redis flush required (no backward compatibility)

### Mitigation Strategies

**Performance:**
- Key derivation cached on startup (not per-operation)
- Encryption service singleton pattern (no repeated initialization)
- Redis pipelining for batch operations (future optimization)

**Operational:**
- Clear documentation: `docs/vercel-deployment.md`
- Key generation command documented: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- GitHub secrets setup documented in `CLAUDE.md`

**Breaking Change:**
- Advance notice to users (deployment communication)
- Health endpoint for post-deployment verification
- Automatic session recreation on re-authentication

## Verification

### Test Results

**Unit Tests:**
- ✅ 968 tests passing
- ✅ 4 tests skipped (intentional)
- ✅ 0 failures

**Integration Tests:**
- ✅ 9 core integration tests passing
- ✅ 7 session cleanup tests passing (Phase 2.5c)
- ✅ Redis encryption validation tests passing

**System Tests:**
- ✅ STDIO mode: Passing
- ✅ HTTP mode: Passing
- ✅ Docker multi-node (3 instances + nginx): Passing

**Security Validation:**
- ✅ Admin endpoint protection: 0 violations
- ✅ Secrets in logs: 0 violations
- ✅ Production file storage: 0 violations

**Full Validation:**
- ✅ Total time: ~200 seconds
- ✅ All phases passing (Code Quality, Security, Fast Tests, System Tests, Headless Browser, Contract Tests)

### Manual Verification

**Redis Inspection (Encryption Verification):**
```bash
# Before encryption (WRONG - plaintext visible)
redis-cli GET "oauth:token:ya29.a0ATi6K2..."
# Returns: {"access_token":"ya29.a0ATi6K2...","..."}

# After encryption (CORRECT - encrypted data)
redis-cli GET "oauth:token:5a7b..."  # SHA-256 hashed key
# Returns: "v1:5a7b...:3f2c...:encrypted-base64-data"
```

**Docker Load-Balanced Testing:**
```bash
docker-compose up -d  # 3 instances + nginx + Redis
# Test disconnect/reconnect with MCP Inspector
# Verify sessions persist across instances
# Confirm Redis has encrypted session data
```

**Vercel Production Testing:**
```bash
vercel deploy --prod
# Verify TOKEN_ENCRYPTION_KEY environment variable set
# Test OAuth flow end-to-end
# Verify sessions work across serverless instances
# Check health endpoint: GET /health
```

## Security Considerations

### Threat Model

**Threats Mitigated:**
1. ✅ **Unauthorized Redis access** - Encrypted data + hashed keys prevent token exposure
2. ✅ **File system compromise** - Encrypted file storage (development mode)
3. ✅ **Memory dumps** - Session data encrypted before storage
4. ✅ **Man-in-the-middle** - TLS 1.3 for Redis connections (Upstash)
5. ✅ **Token theft** - SHA-256 key hashing prevents key name enumeration

**Residual Risks:**
1. ⚠️ **Encryption key compromise** - If `TOKEN_ENCRYPTION_KEY` leaked, all data decryptable
   - Mitigation: Key rotation procedures (Phase 6 future work)
   - Mitigation: Secrets management providers (Vault, AWS Secrets Manager)

2. ⚠️ **Memory access** - Decrypted data briefly in memory during processing
   - Mitigation: Minimize decrypted data lifetime
   - Mitigation: No logging of decrypted data (security scanner enforces)

3. ⚠️ **Side-channel attacks** - Timing attacks on encryption operations
   - Mitigation: AES-GCM uses constant-time operations (Node.js crypto)
   - Mitigation: No user-controlled inputs to encryption algorithm

### Cryptographic Algorithm Choices

**AES-256-GCM:**
- **Standardization:** NIST FIPS 197 approved
- **Key size:** 256 bits (post-quantum resistant for foreseeable future)
- **Mode:** Galois/Counter Mode (authenticated encryption)
- **Authentication:** 128-bit auth tag prevents tampering

**PBKDF2:**
- **Standardization:** NIST SP 800-132 approved
- **Hash:** HMAC-SHA-256
- **Iterations:** 100,000 (OWASP recommendation for 2023+)
- **Salt:** Random 16-byte salt per key derivation

**SHA-256 (Key Hashing):**
- **Standardization:** NIST FIPS 180-4 approved
- **Collision resistance:** No known collisions (as of 2025)
- **One-way:** Cannot reverse hash to recover original token

### Key Management

**Current Implementation:**
- Environment variable: `TOKEN_ENCRYPTION_KEY` (32-byte base64)
- Secrets providers: Vercel, Vault, File (abstraction)
- No automatic rotation (Phase 6 future work)

**Future Improvements:**
- Automated key rotation (90-day rotation policy)
- Key versioning (support multiple keys simultaneously)
- Hardware Security Module (HSM) integration
- AWS KMS / Azure Key Vault integration

## Related Documentation

- [Implementation Status](../security/implementation-status.md) - Phases 0-2.5 complete summary
- [Compliance Mapping](../security/compliance-mapping.md) - SOC-2/ISO/GDPR/HIPAA controls
- [Automated Security Validation](../security/automated-security-validation.md) - Shift-left security
- [Vercel Deployment](../vercel-deployment.md) - TOKEN_ENCRYPTION_KEY setup instructions
- [Session Management](../session-management.md) - SessionManager interface documentation

## References

- NIST FIPS 197: Advanced Encryption Standard (AES)
- NIST SP 800-132: Recommendation for Password-Based Key Derivation
- NIST FIPS 180-4: Secure Hash Standard (SHA-256)
- OWASP Key Management Cheat Sheet
- SOC-2 Trust Services Criteria (CC6.6: Encryption)
- ISO/IEC 27001:2022 (A.10: Cryptography)
- GDPR Article 32: Security of Processing
- HIPAA §164.312(a)(2)(iv): Encryption and Decryption

## Revision History

- **2025-10-26:** Initial ADR created with encryption infrastructure
- **2025-10-27:** Added Redis security enhancements (key hashing, session encryption)
- **2025-10-27:** Added verification results and manual testing procedures

**Status:** ✅ Accepted and Implemented
**Last Updated:** 2025-10-27
