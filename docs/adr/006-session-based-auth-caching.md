# ADR 004: Session-Based Authentication Caching

**Status**: Proposed

**Date**: 2025-01-11

**Authors**: Jeff Dutton, Claude Code

## Context

The current MCP server architecture stores OAuth bearer tokens in Redis/memory for two purposes:
1. **Provider identification**: Loop through all providers checking token stores to find which provider issued a token
2. **Auth info caching**: Store access tokens to avoid repeated userinfo API calls

This approach has several problems:

### Problems with Token Storage

1. **Security Risk**: Centralized storage of bearer credentials creates single point of compromise
2. **Synchronization Issues**: Client and server token state can diverge when client refreshes tokens
3. **Memory Waste**: Duplicating credentials that clients already possess (~2KB per session)
4. **Inefficient Provider Routing**: O(N) loop through all providers to identify token owner
5. **Unnecessary Complexity**: Token refresh synchronization logic between client and server
6. **Against OAuth Best Practices**: RFC 6749 expects clients to manage token lifecycle

### Current Flow

```
Client Request
  ↓
Extract Bearer token
  ↓
FOR EACH provider:                    ← O(N) complexity
  Check if provider.hasToken(token)   ← Redis lookup
  IF found: Use this provider
  ↓
provider.verifyAccessToken(token)
  ↓
Check Redis token store
  IF found: Return cached AuthInfo
  IF NOT found: Call provider API     ← Network latency + rate limits
```

### MCP Session Requirements

MCP HTTP transport is stateless per-request and requires session reconstruction:
- **Tool registry state**: Which tools are registered for this session
- **Session capabilities**: MCP protocol capabilities negotiated
- **User context**: Who owns this session (for authorization)

These requirements necessitate Redis-backed session storage for horizontal scalability. However, **session metadata** (tool registry) is fundamentally different from **bearer credentials** (access tokens).

## Decision

**Consolidate authentication caching within session storage, eliminate separate token storage.**

### Architecture Principles

1. **Session-Bound Auth Cache**: Store AuthInfo in session metadata, not bearer tokens
2. **Provider from Session**: Session knows its provider (no lookup loop)
3. **Token Binding**: Hash-based verification prevents token substitution attacks
4. **JWT vs Opaque Handling**: Different strategies based on token type
5. **Client Manages Tokens**: Server validates whatever token client sends

### Session Schema

```typescript
interface SessionMetadata {
  // Session identity
  sessionId: string;
  createdAt: number;
  expiresAt: number;

  // MCP state (required for reconstruction)
  registeredTools: string[];
  capabilities: Capability[];

  // OAuth authentication cache
  auth?: SessionAuthCache;
}

interface SessionAuthCache {
  // Provider identity
  provider: 'google' | 'github' | 'microsoft' | 'generic';

  // User identity (from initial OAuth flow)
  userId: string;      // OAuth 'sub' claim
  email?: string;      // User email
  scopes: string[];    // Granted OAuth scopes

  // Cached authentication info
  authInfo: AuthInfo;  // Full MCP SDK AuthInfo structure

  // Token binding (security - NOT the token itself)
  tokenHash: string;           // SHA-256(access_token)
  tokenBindingTime: number;    // When binding was established

  // Validation freshness (opaque tokens only)
  lastValidated?: number;      // Timestamp of last provider validation
  validationTTL?: number;      // Time-to-live before re-validation (default: 300000ms = 5 min)
}
```

### Authentication Flows

#### 1. Initial OAuth Flow (Session Creation)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. OAuth Authorization                                       │
│                                                              │
│    Client → Provider authorization endpoint                  │
│         ↓                                                    │
│    User authenticates with provider                          │
│         ↓                                                    │
│    Client ← Authorization code                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 2. Token Exchange & Session Creation                        │
│                                                              │
│    Client → MCP /token endpoint                              │
│      Body: { code, provider }                                │
│         ↓                                                    │
│    Server → Provider token endpoint                          │
│         ↓                                                    │
│    Server ← access_token, refresh_token, expires_in         │
│         ↓                                                    │
│    Server → Provider userinfo endpoint (validate)            │
│         ↓                                                    │
│    Server ← User info (sub, email, name, etc.)              │
│         ↓                                                    │
│    Server creates session:                                   │
│      {                                                       │
│        sessionId: uuid(),                                    │
│        auth: {                                               │
│          provider: 'github',                                 │
│          userId: userInfo.sub,                               │
│          email: userInfo.email,                              │
│          scopes: tokenResponse.scope.split(' '),             │
│          authInfo: buildAuthInfo(userInfo),                  │
│          tokenHash: sha256(access_token),                    │
│          tokenBindingTime: Date.now(),                       │
│          lastValidated: Date.now(),                          │
│          validationTTL: 300000  // 5 minutes                 │
│        }                                                     │
│      }                                                       │
│         ↓                                                    │
│    Client ← {                                                │
│      sessionId,                                              │
│      access_token,     // Client stores this                 │
│      refresh_token,    // Client stores this                 │
│      expires_in                                              │
│    }                                                         │
└─────────────────────────────────────────────────────────────┘
```

**Key Points:**
- Server **validates token once** during session creation
- Server **stores AuthInfo + token hash** in session
- Server **returns tokens to client** (never stores them)
- Client **manages token lifecycle** (storage, refresh)

#### 2. Subsequent MCP Requests (JWT Tokens)

```
┌─────────────────────────────────────────────────────────────┐
│ JWT Token Validation (Google, Microsoft)                    │
│                                                              │
│    Client → MCP /mcp endpoint                                │
│      Headers:                                                │
│        Authorization: Bearer <jwt_token>                     │
│        mcp-session-id: <sessionId>                           │
│         ↓                                                    │
│    Server:                                                   │
│      1. Load session from Redis                             │
│         session = await sessionManager.getSession(sessionId) │
│                                                              │
│      2. Get provider from session (O(1) lookup)             │
│         provider = providers.get(session.auth.provider)      │
│                                                              │
│      3. Verify token binding (security check)               │
│         tokenHash = sha256(token)                            │
│         if (tokenHash !== session.auth.tokenHash) {          │
│           // Token changed - client refreshed               │
│           await handleTokenRefresh(session, token)           │
│         }                                                    │
│                                                              │
│      4. Validate JWT signature locally (NO API CALL)        │
│         const payload = jwt.verify(token, publicKey)         │
│         if (payload.exp < now) throw 'Expired'               │
│                                                              │
│      5. Use cached AuthInfo from session                    │
│         return session.auth.authInfo                         │
│         ↓                                                    │
│    Server processes MCP request with AuthInfo                │
└─────────────────────────────────────────────────────────────┘
```

**Performance:**
- **JWT validation**: ~1ms (local signature verification)
- **Session lookup**: ~5ms (Redis)
- **Total**: ~6ms per request
- **Provider API calls**: Zero

#### 3. Subsequent MCP Requests (Opaque Tokens)

```
┌─────────────────────────────────────────────────────────────┐
│ Opaque Token Validation (GitHub)                            │
│                                                              │
│    Client → MCP /mcp endpoint                                │
│      Headers:                                                │
│        Authorization: Bearer gho_xxxxxxxxxxxxx               │
│        mcp-session-id: <sessionId>                           │
│         ↓                                                    │
│    Server:                                                   │
│      1. Load session from Redis                             │
│         session = await sessionManager.getSession(sessionId) │
│                                                              │
│      2. Get provider from session (O(1) lookup)             │
│         provider = providers.get(session.auth.provider)      │
│                                                              │
│      3. Verify token binding (security check)               │
│         tokenHash = sha256(token)                            │
│         if (tokenHash !== session.auth.tokenHash) {          │
│           // Token changed - re-validate with provider      │
│           authInfo = await provider.fetchUserInfo(token)     │
│           await updateSessionTokenBinding(session, token)    │
│           return authInfo                                    │
│         }                                                    │
│                                                              │
│      4. Check validation freshness (TTL)                    │
│         age = now - session.auth.lastValidated               │
│         if (age < session.auth.validationTTL) {              │
│           // Within TTL - use cached AuthInfo (NO API CALL) │
│           return session.auth.authInfo                       │
│         }                                                    │
│                                                              │
│      5. TTL expired - re-validate with provider             │
│         authInfo = await provider.fetchUserInfo(token)       │
│         await updateSessionAuthCache(session, authInfo)      │
│         return authInfo                                      │
│         ↓                                                    │
│    Server processes MCP request with AuthInfo                │
└─────────────────────────────────────────────────────────────┘
```

**Performance:**
- **Cached validation** (within TTL): ~5ms (Redis only)
- **Re-validation** (TTL expired): ~200ms (GitHub API)
- **Re-validation frequency**: Once per 5 minutes per session
- **Provider API calls**: ~99% reduction vs current approach

#### 4. Token Refresh Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Client-Managed Token Refresh                                │
│                                                              │
│    Client detects token expiry:                             │
│      - JWT: Read 'exp' claim                                │
│      - Opaque: 401 response from MCP server                 │
│         ↓                                                    │
│    Client → Provider /token endpoint                         │
│      Body:                                                   │
│        grant_type: refresh_token                             │
│        refresh_token: <stored_refresh_token>                 │
│         ↓                                                    │
│    Client ← New tokens                                       │
│      {                                                       │
│        access_token: <new_token>,                            │
│        refresh_token: <new_refresh_token>,                   │
│        expires_in: 3600                                      │
│      }                                                       │
│         ↓                                                    │
│    Client updates local storage                              │
│         ↓                                                    │
│    Client → MCP /mcp endpoint (with new token)               │
│      Headers:                                                │
│        Authorization: Bearer <new_token>                     │
│        mcp-session-id: <sessionId>                           │
│         ↓                                                    │
│    Server detects hash mismatch:                            │
│      tokenHash = sha256(new_token)                           │
│      tokenHash !== session.auth.tokenHash                    │
│         ↓                                                    │
│    Server re-validates with provider:                       │
│      authInfo = await provider.fetchUserInfo(new_token)      │
│         ↓                                                    │
│    Server updates session binding:                          │
│      session.auth.tokenHash = sha256(new_token)              │
│      session.auth.authInfo = authInfo                        │
│      session.auth.lastValidated = Date.now()                 │
│      await sessionManager.updateSession(session)             │
│         ↓                                                    │
│    Server processes request normally                         │
└─────────────────────────────────────────────────────────────┘
```

**Key Points:**
- Client **manages refresh lifecycle** (no server involvement)
- Server **detects refresh via hash mismatch**
- Server **re-validates once** to establish new binding
- Subsequent requests **use cached AuthInfo**

## Implementation

### Phase 1: Add Session Auth Cache (Backwards Compatible)

**Duration**: 1 week

**Goal**: Add session-based auth caching alongside existing token storage (parallel systems).

```typescript
// packages/persistence/src/types.ts
export interface SessionAuthCache {
  provider: OAuthProviderType;
  userId: string;
  email?: string;
  scopes: string[];
  authInfo: AuthInfo;
  tokenHash: string;
  tokenBindingTime: number;
  lastValidated?: number;
  validationTTL?: number;
}

// packages/http-server/src/session/session-manager.ts
export interface SessionInfo {
  sessionId: string;
  createdAt: number;
  expiresAt: number;
  authInfo?: AuthInfo;  // Deprecated - use auth.authInfo
  auth?: SessionAuthCache;  // NEW
  metadata?: Record<string, unknown>;
}
```

**Changes:**
1. Extend `SessionMetadata` with optional `auth` field
2. Update `handleSessionInitialized()` to populate `auth` cache
3. Add `updateSessionTokenBinding()` helper for refresh detection
4. Add feature flag: `MCP_USE_SESSION_AUTH_CACHE=true`

### Phase 2: Implement Provider-Specific Validation

**Duration**: 2 weeks

**Goal**: Use session auth cache for token validation instead of token store lookups.

```typescript
// packages/auth/src/providers/base-provider.ts
async verifyAccessTokenWithSession(
  token: string,
  sessionId: string
): Promise<AuthInfo> {
  // 1. Get session auth cache
  const session = await this.sessionManager.getSession(sessionId);
  if (!session?.auth) {
    throw new Error('Session not found or not authenticated');
  }

  // 2. Verify provider match
  if (session.auth.provider !== this.getProviderType()) {
    throw new Error('Provider mismatch');
  }

  // 3. Verify token binding
  const tokenHash = this.hashToken(token);
  if (tokenHash !== session.auth.tokenHash) {
    // Token changed - re-validate and update binding
    return this.revalidateAndBind(token, sessionId, session);
  }

  // 4. Check validation freshness (opaque tokens only)
  if (this.isOpaqueToken()) {
    const age = Date.now() - (session.auth.lastValidated ?? 0);
    if (age >= (session.auth.validationTTL ?? 300000)) {
      // TTL expired - re-validate
      return this.revalidateAndCache(token, sessionId, session);
    }
  }

  // 5. Use cached AuthInfo
  return session.auth.authInfo;
}

// JWT provider override
async verifyAccessTokenWithSession(
  token: string,
  sessionId: string
): Promise<AuthInfo> {
  const session = await this.sessionManager.getSession(sessionId);

  // JWT validation is always fresh (signature check)
  const payload = await this.verifyJWTSignature(token);

  // Check token binding
  const tokenHash = this.hashToken(token);
  if (tokenHash !== session.auth.tokenHash) {
    // Token refreshed - update binding
    await this.updateSessionTokenBinding(sessionId, token, payload);
  }

  return this.buildAuthInfoFromJWT(payload);
}
```

**Changes:**
1. Add `verifyAccessTokenWithSession()` to all providers
2. Update HTTP server middleware to pass `sessionId` to provider
3. Implement JWT signature verification (Google, Microsoft)
4. Implement TTL-based caching (GitHub)

### Phase 3: Remove Token Storage

**Duration**: 1 week

**Goal**: Delete deprecated token storage code and migrate existing sessions.

```typescript
// Migration script
async function migrateTokenStorageToSessionCache() {
  // 1. Find all sessions
  const sessions = await sessionManager.getAllSessions();

  for (const session of sessions) {
    // 2. Skip if already migrated
    if (session.auth) continue;

    // 3. Skip if no auth info
    if (!session.authInfo) continue;

    // 4. Find token in provider stores (last time we use this)
    let accessToken: string | undefined;
    for (const provider of providers.values()) {
      const tokens = await provider.findTokensByUserId(session.userId);
      if (tokens.length > 0) {
        accessToken = tokens[0];
        break;
      }
    }

    if (!accessToken) {
      console.warn(`No token found for session ${session.sessionId}`);
      continue;
    }

    // 5. Create session auth cache
    const tokenHash = crypto.createHash('sha256')
      .update(accessToken)
      .digest('hex');

    session.auth = {
      provider: session.authInfo.extra?.provider as OAuthProviderType,
      userId: session.authInfo.extra?.userInfo?.sub ?? session.userId,
      email: session.authInfo.extra?.userInfo?.email,
      scopes: session.authInfo.scopes ?? [],
      authInfo: session.authInfo,
      tokenHash,
      tokenBindingTime: Date.now(),
      lastValidated: Date.now(),
      validationTTL: 300000
    };

    // 6. Update session
    await sessionManager.updateSession(session);

    console.log(`Migrated session ${session.sessionId}`);
  }

  console.log('Migration complete - token stores can now be deleted');
}
```

**Deleted code:**
- `packages/persistence/src/redis/token-store.ts` (entire file)
- `packages/persistence/src/memory/token-store.ts` (entire file)
- `packages/auth/src/providers/base-provider.ts` - Remove `tokenStore` field
- `packages/auth/src/providers/base-provider.ts` - Delete `storeToken()`, `getToken()`, `hasToken()`
- `packages/http-server/src/server/streamable-http-server.ts:625-642` - Delete provider loop

**Result**: ~500 lines of code deleted, architecture simplified.

## Security Considerations

### Token Binding (Prevents Substitution Attacks)

**Attack scenario**: Malicious client steals session ID and attempts to use their own access token.

**Defense**:
```typescript
// Server verifies token hash matches session binding
const tokenHash = sha256(request.token);
if (tokenHash !== session.auth.tokenHash) {
  // Hash mismatch detected
  // Either legitimate refresh OR attack attempt

  // Re-validate with provider to establish new binding
  const authInfo = await provider.fetchUserInfo(request.token);

  // Check if user ID matches (prevents impersonation)
  if (authInfo.userId !== session.auth.userId) {
    throw new Error('Token user mismatch - possible attack');
  }

  // Legitimate refresh - update binding
  session.auth.tokenHash = tokenHash;
  await sessionManager.updateSession(session);
}
```

### Session Expiration

Sessions have TTL for security:
```typescript
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface SessionMetadata {
  expiresAt: number;  // createdAt + SESSION_TTL
}

// Automatic cleanup
sessionManager.cleanup(); // Deletes expired sessions
```

### Validation Freshness (Revocation Detection)

**GitHub tokens can be revoked** - periodic re-validation detects this:

```typescript
// Every 5 minutes, re-validate with GitHub
const VALIDATION_TTL = 5 * 60 * 1000;

if (Date.now() - session.auth.lastValidated > VALIDATION_TTL) {
  try {
    await provider.fetchUserInfo(token);
    session.auth.lastValidated = Date.now();
  } catch (error) {
    // Token revoked - delete session
    await sessionManager.deleteSession(sessionId);
    throw new Error('Token revoked');
  }
}
```

**Trade-off**: 5-minute window where revoked tokens still work. Acceptable for MCP use case.

### No Token Storage = Smaller Attack Surface

**Before**: Compromise Redis → get all bearer tokens → impersonate all users

**After**: Compromise Redis → get session IDs + token hashes → cannot impersonate (no tokens)

Token hashes are useless without original token (SHA-256 is one-way function).

## Consequences

### Positive

1. **Security**: No centralized bearer token storage
2. **Performance**: ~99% reduction in provider API calls (opaque tokens)
3. **Simplicity**: Single source of truth for session state
4. **Correctness**: Client manages refresh, server validates current state
5. **Scalability**: Lighter Redis memory usage
6. **OAuth Compliance**: Follows RFC 6749 client-managed token lifecycle

### Negative

1. **Revocation Window**: Up to 5 minutes for opaque token revocation detection
2. **Migration Effort**: Existing sessions need migration
3. **Client Changes**: Clients must send `mcp-session-id` header with every request

### Metrics

**Memory usage** (10,000 concurrent sessions):
- **Before**: ~30MB (3KB per session: metadata + tokens)
- **After**: ~15MB (1.5KB per session: metadata + auth cache)
- **Savings**: 50% reduction

**GitHub API calls** (10,000 requests/hour):
- **Before**: 10,000 calls/hour (every request)
- **After**: ~33 calls/hour (once per 5 min per session)
- **Reduction**: 99.67%

**Average request latency**:
- **JWT tokens**: 6ms (was: 200ms with API calls)
- **Opaque tokens (cached)**: 5ms (was: 200ms)
- **Opaque tokens (re-validation)**: 200ms (same, but 1/60th as frequent)

## Alternatives Considered

### Alternative 1: Keep Token Storage, Add Session Cache

**Rejected**: Maintains complexity and security risk of dual storage.

### Alternative 2: Stateless JWT-Only Auth

**Rejected**: GitHub tokens are opaque, cannot be validated without API calls or caching.

### Alternative 3: Client Sends Provider Hint Header

**Partial adoption**: Use `X-OAuth-Provider` header to skip provider identification, but still use session auth cache for validation.

## References

- [RFC 6749: OAuth 2.0 Authorization Framework](https://datatracker.ietf.org/doc/html/rfc6749)
- [RFC 7519: JSON Web Token (JWT)](https://datatracker.ietf.org/doc/html/rfc7519)
- [GitHub OAuth Tokens Documentation](https://docs.github.com/en/developers/apps/building-oauth-apps/authorizing-oauth-apps)
- [Google OAuth JWT Validation](https://developers.google.com/identity/protocols/oauth2/openid-connect#validatinganidtoken)
- ADR 002: OAuth Client State Preservation
- ADR 003: Remove Server-Side Token Storage (superseded by this ADR)

## Related Issues

- Issue #68: Architecture research on SDLC tooling
- OAuth token persistence discussion (2025-01-11)
