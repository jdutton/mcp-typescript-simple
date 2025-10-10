# OAuth Provider Refactoring Analysis

## Executive Summary

**Current State:** 4 OAuth providers with significant code duplication
- GoogleOAuthProvider: 582 lines
- GitHubOAuthProvider: 495 lines
- MicrosoftOAuthProvider: 497 lines
- GenericOAuthProvider: 382 lines
- **Estimated duplication: ~60%** (~800 lines of duplicated code)

**Goal:** Consolidate common patterns while preserving provider-specific customizations

---

## Method-by-Method Comparison

### 1. `handleAuthorizationRequest`

**GitHub Implementation (lines 61-90):**
```typescript
async handleAuthorizationRequest(req, res) {
  const { clientRedirectUri, clientCodeChallenge, clientState } = this.extractClientParameters(req);
  const { state, codeVerifier, codeChallenge } = this.setupPKCE(clientCodeChallenge);
  const session = this.createOAuthSession(state, codeVerifier, codeChallenge, clientRedirectUri, undefined, clientState);
  this.storeSession(state, session);

  const authUrl = this.buildAuthorizationUrl(  // ✅ USES BASE METHOD
    this.GITHUB_AUTH_URL,
    state,
    codeChallenge,
    session.scopes
  );

  logger.oauthInfo('Redirecting to GitHub', { provider: 'github' });
  this.setAntiCachingHeaders(res);
  res.redirect(authUrl);
}
```

**Microsoft Implementation (lines 65-94):**
```typescript
async handleAuthorizationRequest(req, res) {
  const { clientRedirectUri, clientCodeChallenge, clientState } = this.extractClientParameters(req);
  const { state, codeVerifier, codeChallenge } = this.setupPKCE(clientCodeChallenge);
  const session = this.createOAuthSession(state, codeVerifier, codeChallenge, clientRedirectUri, undefined, clientState);
  this.storeSession(state, session);

  const authUrl = this.buildAuthorizationUrl(  // ✅ USES BASE METHOD
    this.MICROSOFT_AUTH_URL,
    state,
    codeChallenge,
    session.scopes
  );

  logger.oauthInfo('Redirecting to Microsoft', { provider: 'microsoft' });
  this.setAntiCachingHeaders(res);
  res.redirect(authUrl);
}
```

**Generic Implementation (lines 60-98):**
```typescript
async handleAuthorizationRequest(req, res) {
  const { clientRedirectUri, clientCodeChallenge, clientCodeChallengeMethod, clientState } = this.extractClientParameters(req);
  const { state, codeVerifier, codeChallenge } = this.setupPKCE(clientCodeChallenge);
  const session = this.createOAuthSession(state, codeVerifier, codeChallenge, clientRedirectUri, undefined, clientState);
  this.storeSession(state, session);

  // ❌ BUILDS URL MANUALLY (doesn't use base method)
  const authUrl = new URL(this.config.authorizationUrl);
  authUrl.searchParams.set('client_id', this.config.clientId);
  authUrl.searchParams.set('redirect_uri', this.config.redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', session.scopes.join(' '));
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', clientCodeChallengeMethod || 'S256');

  logger.oauthInfo('Redirecting to MockOAuth', { provider: 'generic' });
  this.setAntiCachingHeaders(res);
  res.redirect(authUrl.toString());
}
```

**Google Implementation (lines 68-105):**
```typescript
async handleAuthorizationRequest(req, res) {
  const { clientRedirectUri, clientCodeChallenge, clientCodeChallengeMethod, clientState } = this.extractClientParameters(req);
  const { state, codeVerifier, codeChallenge } = this.setupPKCE(clientCodeChallenge);
  const session = this.createOAuthSession(state, codeVerifier, codeChallenge, clientRedirectUri, undefined, clientState);
  this.storeSession(state, session);

  // ⚠️ USES GOOGLE'S LIBRARY (unique)
  const authUrl = this.oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: session.scopes,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: (clientCodeChallengeMethod || 'S256') as CodeChallengeMethod,
    prompt: 'consent',
    redirect_uri: this.config.redirectUri,
  });

  logger.oauthInfo('Redirecting to Google', { provider: 'google' });
  this.setAntiCachingHeaders(res);
  res.redirect(authUrl);
}
```

**Analysis:**
- **GitHub & Microsoft**: 99% identical, only differ in URL constant and provider name
- **Generic**: Same logic, but builds URL manually instead of using base method
- **Google**: UNIQUE - uses OAuth2Client library with provider-specific options

**Consolidation Opportunity:**
- Move GitHub/Microsoft implementation to BaseOAuthProvider
- Make Generic use the same base method
- Keep Google separate (library-specific)

---

### 2. `handleAuthorizationCallback`

**All Providers (GitHub/Microsoft/Generic):**
Lines of IDENTICAL code:
- Error handling (lines 100-108)
- Parameter validation (lines 110-117)
- State validation (lines 113-118)
- Client redirect handling (lines 117-122)
- Token exchange (lines 122-130)
- User info fetching (lines 133-137) - **METHOD NAME DIFFERS**
- Allowlist checking (lines 136-148)
- Token storage (lines 148-160)
- Session cleanup (lines 163-165)
- Response formatting (lines 163-176)

**Only Difference: fetchUserInfo method name**
- GitHub: `fetchGitHubUserInfo(token)`
- Microsoft: `fetchMicrosoftUserInfo(token)`
- Generic: `fetchUserInfo(token)`

**Consolidation Opportunity:**
- Move entire method to BaseOAuthProvider
- Add abstract method: `protected abstract fetchUserInfo(token): Promise<OAuthUserInfo>`
- Each provider implements only `fetchUserInfo()`

---

### 3. `handleTokenExchange`

**GitHub/Microsoft/Generic: 100% IDENTICAL except:**
- Provider name in logs
- Token URL constant
- fetchUserInfo method name

**Consolidation Opportunity:**
- Move to BaseOAuthProvider entirely
- Use abstract `fetchUserInfo()` method

---

### 4. `handleLogout`

**GitHub/Microsoft/Generic: 100% IDENTICAL except:**
- Provider name in logs
- Microsoft calls `revokeMicrosoftToken()` before removing

**Microsoft has extra revocation logic:**
```typescript
try {
  await this.revokeMicrosoftToken(token);
} catch (revokeError) {
  logger.oauthWarn('Failed to revoke Microsoft token', { error: revokeError });
}
```

**Consolidation Opportunity:**
- Move to BaseOAuthProvider
- Add optional hook: `protected async revokeToken(token): Promise<void>`
- Only Microsoft implements the hook

---

### 5. `verifyAccessToken` & `getUserInfo`

**All providers: 100% IDENTICAL except:**
- fetchUserInfo method name

**Consolidation Opportunity:**
- Move to BaseOAuthProvider
- Use abstract `fetchUserInfo()` method

---

### 6. `fetchUserInfo` - Provider-Specific Implementation

**THIS is where providers differ significantly:**

**GitHub (lines 390-495):**
- Fetches from `/user` endpoint
- Fetches from `/user/emails` if email is private
- Special logic for GitHub noreply emails
- Extensive error handling for private emails

**Microsoft (lines 406-467):**
- Fetches from Microsoft Graph API `/me`
- Uses either `mail` or `userPrincipalName` for email
- Simpler than GitHub

**Generic (lines 227-248):**
- Simple fetch from configurable `userInfoUrl`
- Basic field mapping (sub, email, name, picture)
- Minimal error handling

**Google:**
- Uses OAuth2Client library methods

---

## Refactoring Strategy

### Phase 1: Move Common Implementations to BaseOAuthProvider

**Add abstract method to BaseOAuthProvider:**
```typescript
protected abstract fetchUserInfo(accessToken: string): Promise<OAuthUserInfo>;
```

**Move to BaseOAuthProvider (shared across GitHub/Microsoft/Generic):**
1. `handleAuthorizationCallback` - ~100 lines → 1 line (call to base)
2. `handleTokenExchange` - ~100 lines → 1 line (call to base)
3. `handleLogout` - ~20 lines → 1 line (call to base) + optional hook
4. `verifyAccessToken` - ~20 lines → inherited from base
5. `getUserInfo` - ~20 lines → inherited from base

**Keep in specific providers:**
1. `fetchUserInfo` - provider-specific user data fetching
2. Provider URLs (constructor initialization)
3. `getProviderType`, `getProviderName`, `getEndpoints`, `getDefaultScopes`

---

### Phase 2: Fix Generic Provider

**Current issue:** Generic manually builds auth URL instead of using base method

**Fix:** Update Generic to use `buildAuthorizationUrl()` from base

---

### Phase 3: Add Optional Hooks

**Add to BaseOAuthProvider:**
```typescript
// Optional hook for token revocation (Microsoft uses this)
protected async revokeToken(token: string): Promise<void> {
  // Default: no-op
}
```

---

## Expected Code Reduction

### Before Refactoring:
- GitHub: 495 lines
- Microsoft: 497 lines
- Generic: 382 lines
- **Total: 1,374 lines**

### After Refactoring:
- GitHub: ~150 lines (only fetchUserInfo + metadata)
- Microsoft: ~120 lines (only fetchUserInfo + metadata + revoke hook)
- Generic: ~100 lines (only fetchUserInfo + metadata)
- BaseOAuthProvider: +150 lines (moved shared code)
- **Total: ~520 lines**

**Reduction: ~850 lines** (~62% code reduction)

---

## Benefits

1. **Bug fixes propagate** - Fix callback logic once, all providers benefit
2. **Easier testing** - Test BaseOAuthProvider thoroughly, minimal tests for specific providers
3. **Faster development** - New providers just implement `fetchUserInfo()`
4. **Maintainability** - Less duplication = less surface area for bugs
5. **No breaking changes** - External interface remains identical

---

## Risks

1. **Regression risk** - Moving working code always has risk
2. **Testing burden** - Need comprehensive test coverage before refactoring
3. **Provider-specific edge cases** - Might break subtle differences

---

## Mitigation Strategy

1. **Write comprehensive tests FIRST** - Ensure current behavior is captured
2. **Refactor incrementally** - One provider at a time
3. **Run full test suite after each change**
4. **Keep commits small** - Easy to revert if issues arise

---

## Current Status

### ✅ Completed
1. **Analysis complete** - Documented all duplications and differences
2. **Comprehensive tests written** - GenericOAuthProvider fully tested (see `test/unit/auth/providers/generic-provider.test.ts`)
3. **All tests passing** - 745 tests, 51 test suites

### 🚧 In Progress
None - ready to begin refactoring

### ⏳ Not Started
- Abstract method implementation in BaseOAuthProvider
- Moving common implementations to base
- Refactoring individual providers

---

## Detailed Implementation Plan

### Phase 1: Add Abstract Methods to BaseOAuthProvider

**File: `src/auth/providers/base-provider.ts`**

**Step 1.1: Add abstract fetchUserInfo method**
```typescript
// Add after line 100 (after existing abstract methods)

/**
 * Fetch user information from provider's API
 *
 * Each provider implements this to fetch user data from their specific endpoint.
 * This is the ONLY provider-specific method that differs between implementations.
 *
 * @param accessToken - Valid access token
 * @returns User information in standardized format
 */
protected abstract fetchUserInfo(accessToken: string): Promise<OAuthUserInfo>;
```

**Step 1.2: Add optional revokeToken hook**
```typescript
// Add after fetchUserInfo

/**
 * Optional hook for provider-specific token revocation
 *
 * Default implementation does nothing. Providers like Microsoft that support
 * token revocation can override this method.
 *
 * @param accessToken - Token to revoke
 */
protected async revokeToken(accessToken: string): Promise<void> {
  // Default: no-op
  // Microsoft will override this
}
```

**Validation:** Run `npm run typecheck` - should pass

---

### Phase 2: Move Common Implementations to BaseOAuthProvider

#### Step 2.1: Move `handleAuthorizationCallback`

**Location:** Add to `base-provider.ts` around line 300

**Implementation:**
```typescript
/**
 * Handle OAuth authorization callback (common implementation)
 *
 * This implementation is shared by GitHub, Microsoft, and Generic providers.
 * Google uses its own implementation due to OAuth2Client library.
 */
async handleAuthorizationCallback(req: Request, res: Response): Promise<void> {
  try {
    const { code, state, error } = req.query;

    // Error handling
    if (error) {
      logger.oauthError(`${this.getProviderName()} OAuth error`, { error });
      this.setAntiCachingHeaders(res);
      res.status(400).json({ error: 'Authorization failed', details: error });
      return;
    }

    // Parameter validation
    if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
      this.setAntiCachingHeaders(res);
      res.status(400).json({ error: 'Missing authorization code or state' });
      return;
    }

    // Validate session
    logger.oauthDebug('Validating state', {
      provider: this.getProviderType(),
      statePrefix: state.substring(0, 8)
    });
    const session = await this.validateState(state);

    // Handle client redirect flow
    if (await this.handleClientRedirect(session, code, state, res)) {
      return;
    }

    // Exchange code for tokens
    const tokenData = await this.exchangeCodeForTokens(
      this.getTokenUrl(), // Subclasses must provide this
      code,
      session.codeVerifier
    );

    if (!tokenData.access_token) {
      throw new OAuthTokenError('No access token received', this.getProviderType());
    }

    // Get user information (calls subclass implementation)
    const userInfo = await this.fetchUserInfo(tokenData.access_token);

    // Check allowlist
    const allowlistError = this.checkUserAllowlist(userInfo.email);
    if (allowlistError) {
      logger.warn('User denied by allowlist', {
        email: userInfo.email,
        provider: this.getProviderType()
      });
      this.setAntiCachingHeaders(res);
      res.status(403).json({
        error: 'access_denied',
        error_description: allowlistError
      });
      return;
    }

    // Store token
    const tokenInfo: StoredTokenInfo = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || undefined,
      idToken: tokenData.id_token || undefined,
      expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
      userInfo,
      provider: this.getProviderType(),
      scopes: session.scopes,
    };

    await this.storeToken(tokenData.access_token, tokenInfo);

    // Clean up session
    this.removeSession(state);

    // Return response
    const response: OAuthTokenResponse = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      id_token: tokenData.id_token,
      expires_in: tokenData.expires_in || 3600,
      token_type: 'Bearer',
      scope: tokenData.scope,
      user: userInfo,
    };

    this.setAntiCachingHeaders(res);
    res.json(response);

  } catch (error) {
    logger.oauthError(`${this.getProviderName()} OAuth callback error`, error);
    this.setAntiCachingHeaders(res);
    res.status(500).json({
      error: 'Authorization failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Get token URL for this provider (must be implemented by subclasses)
 */
protected abstract getTokenUrl(): string;
```

**Validation:**
- Run `npm test -- test/unit/auth/providers/base-provider.test.ts`
- Should pass (base provider tests don't test this directly)

#### Step 2.2: Move `handleTokenExchange`

**Add after `handleAuthorizationCallback`:**

```typescript
/**
 * Handle token exchange (common implementation)
 */
async handleTokenExchange(req: Request, res: Response): Promise<void> {
  try {
    const validation = this.validateTokenExchangeRequest(req, res);
    if (!validation.isValid) {
      return;
    }

    const { code, code_verifier, redirect_uri } = validation;

    // Resolve code_verifier
    const codeVerifierToUse = await this.resolveCodeVerifierForTokenExchange(code!, code_verifier);

    // Log request
    await this.logTokenExchangeRequest(code!, code_verifier, redirect_uri);

    // Exchange code for tokens
    const tokenData = await this.exchangeCodeForTokens(
      this.getTokenUrl(),
      code!,
      codeVerifierToUse!,
      {},
      this.config.redirectUri
    );

    if (!tokenData.access_token) {
      throw new OAuthTokenError('No access token received', this.getProviderType());
    }

    // Get user info
    const userInfo = await this.fetchUserInfo(tokenData.access_token);

    // Store token
    const tokenInfo: StoredTokenInfo = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || undefined,
      idToken: tokenData.id_token || undefined,
      expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
      userInfo,
      provider: this.getProviderType(),
      scopes: tokenData.scope?.split(/[,\s]+/).filter(Boolean) || [],
    };

    await this.storeToken(tokenData.access_token, tokenInfo);

    // Cleanup
    await this.cleanupAfterTokenExchange(code!);

    // Response
    const response: OAuthTokenResponse = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in || 3600,
      token_type: 'Bearer',
      scope: tokenData.scope,
      user: userInfo,
    };

    logger.oauthInfo('Token exchange successful', {
      provider: this.getProviderType(),
      userName: userInfo.name
    });
    this.setAntiCachingHeaders(res);
    res.json(response);

  } catch (error) {
    logger.oauthError('Token exchange error', error);
    this.setAntiCachingHeaders(res);
    res.status(500).json({
      error: 'server_error',
      error_description: error instanceof Error ? error.message : String(error)
    });
  }
}
```

#### Step 2.3: Move `handleLogout`

```typescript
/**
 * Handle logout (common implementation)
 */
async handleLogout(req: Request, res: Response): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);

      // Optional provider-specific revocation
      try {
        await this.revokeToken(token);
      } catch (revokeError) {
        logger.oauthWarn(`Failed to revoke ${this.getProviderName()} token`, { error: revokeError });
      }

      await this.removeToken(token);
    }

    this.setAntiCachingHeaders(res);
    res.json({ success: true });
  } catch (error) {
    logger.oauthError(`${this.getProviderName()} logout error`, error);
    this.setAntiCachingHeaders(res);
    res.status(500).json({ error: 'Logout failed' });
  }
}
```

#### Step 2.4: Move `verifyAccessToken`

```typescript
/**
 * Verify access token (common implementation)
 */
async verifyAccessToken(token: string): Promise<AuthInfo> {
  try {
    // Check local store first
    const tokenInfo = await this.getToken(token);
    if (tokenInfo) {
      return this.buildAuthInfoFromCache(token, tokenInfo);
    }

    // Fetch from provider API
    const userInfo = await this.fetchUserInfo(token);
    return this.buildAuthInfoFromUserInfo(token, userInfo);

  } catch (error) {
    logger.oauthError(`${this.getProviderName()} token verification error`, error);
    throw new OAuthTokenError('Invalid or expired token', this.getProviderType());
  }
}
```

#### Step 2.5: Move `getUserInfo`

```typescript
/**
 * Get user info (common implementation)
 */
async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
  try {
    // Check local store first
    const tokenInfo = await this.getToken(accessToken);
    if (tokenInfo) {
      return tokenInfo.userInfo;
    }

    // Fetch from provider API
    return await this.fetchUserInfo(accessToken);

  } catch (error) {
    logger.oauthError(`${this.getProviderName()} getUserInfo error`, error);
    throw new OAuthProviderError('Failed to get user information', this.getProviderType());
  }
}
```

**Validation after Phase 2:**
```bash
npm run typecheck  # Should pass
npm test           # All existing tests should still pass
```

---

### Phase 3: Refactor GenericOAuthProvider

**File: `src/auth/providers/generic-provider.ts`**

**Step 3.1: Implement getTokenUrl()**
```typescript
protected getTokenUrl(): string {
  return this.config.tokenUrl;
}
```

**Step 3.2: Rename fetchUserInfo to make it protected**
```typescript
// Change from:
private async fetchUserInfo(accessToken: string): Promise<OAuthUserInfo>

// To:
protected async fetchUserInfo(accessToken: string): Promise<OAuthUserInfo>
```

**Step 3.3: Remove duplicated methods**

Delete these methods (they're now inherited from base):
- `handleAuthorizationCallback` (lines 103-186)
- `handleTokenExchange` (lines 302-361)
- `handleLogout` (lines 261-276)
- `verifyAccessToken` (lines 281-297)
- `getUserInfo` (lines 366-381)

**Keep these methods:**
- `getProviderType()`
- `getProviderName()`
- `getEndpoints()`
- `getDefaultScopes()`
- `handleAuthorizationRequest()` (uses manual URL building)
- `fetchUserInfo()` (provider-specific)
- `exchangeCodeForToken()` (private helper)

**Expected result:** GenericOAuthProvider goes from 382 lines → ~150 lines

**Validation:**
```bash
npm test -- test/unit/auth/providers/generic-provider.test.ts
# All tests should still pass (behavior unchanged)
```

---

### Phase 4: Refactor GitHubOAuthProvider

**File: `src/auth/providers/github-provider.ts`**

**Step 4.1: Implement getTokenUrl()**
```typescript
protected getTokenUrl(): string {
  return this.GITHUB_TOKEN_URL;
}
```

**Step 4.2: Rename fetchGitHubUserInfo to fetchUserInfo**
```typescript
// Change from:
private async fetchGitHubUserInfo(accessToken: string): Promise<OAuthUserInfo>

// To:
protected async fetchUserInfo(accessToken: string): Promise<OAuthUserInfo>
```

**Step 4.3: Remove duplicated methods**

Delete:
- `handleAuthorizationCallback` (lines 95-183)
- `handleTokenExchange` (lines 190-277)
- `handleLogout` (lines 329-344)
- `verifyAccessToken` (lines 349-365)
- `getUserInfo` (lines 370-385)

**Keep:**
- Metadata methods
- `handleAuthorizationRequest()` (uses buildAuthorizationUrl)
- `handleTokenRefresh()` (GitHub-specific)
- `fetchUserInfo()` (GitHub-specific email handling)

**Expected result:** GitHubOAuthProvider goes from 495 lines → ~200 lines

**Validation:**
```bash
npm test -- test/unit/auth/providers/github-provider.test.ts
```

---

### Phase 5: Refactor MicrosoftOAuthProvider

**File: `src/auth/providers/microsoft-provider.ts`**

**Step 5.1: Implement getTokenUrl()**
```typescript
protected getTokenUrl(): string {
  return this.MICROSOFT_TOKEN_URL;
}
```

**Step 5.2: Rename fetchMicrosoftUserInfo to fetchUserInfo**
```typescript
// Change from:
private async fetchMicrosoftUserInfo(accessToken: string): Promise<OAuthUserInfo>

// To:
protected async fetchUserInfo(accessToken: string): Promise<OAuthUserInfo>
```

**Step 5.3: Implement revokeToken hook**
```typescript
// Change from:
private async revokeMicrosoftToken(accessToken: string): Promise<void>

// To:
protected async revokeToken(accessToken: string): Promise<void>
```

**Step 5.4: Remove duplicated methods**

Delete:
- `handleAuthorizationCallback` (lines 99-189)
- `handleTokenExchange` (lines 196-269)
- `handleLogout` (lines 337-360) - now uses base with revokeToken hook
- `verifyAccessToken` (lines 365-381)
- `getUserInfo` (lines 386-401)

**Keep:**
- Metadata methods
- `handleAuthorizationRequest()`
- `handleTokenRefresh()`
- `fetchUserInfo()` (Microsoft-specific)
- `revokeToken()` (hook implementation)

**Expected result:** MicrosoftOAuthProvider goes from 497 lines → ~200 lines

**Validation:**
```bash
npm test -- test/unit/auth/providers/microsoft-provider.test.ts
```

---

## Testing Checklist

After each phase, run:

```bash
# Type checking
npm run typecheck

# Unit tests for specific provider
npm test -- test/unit/auth/providers/[provider]-provider.test.ts

# All auth tests
npm test -- test/unit/auth/

# Full test suite
npm run test:unit

# Validation
npm run validate
```

---

## Final Validation

Before committing:

```bash
# Full validation
npm run validate

# Playwright tests (OAuth mock integration)
npm run test:system:headless

# Manual smoke test
npm run dev:oauth:google  # Test Google OAuth flow
npm run dev:oauth:github  # Test GitHub OAuth flow
npm run dev:oauth:microsoft  # Test Microsoft OAuth flow
```

---

## Rollback Plan

If issues arise:

```bash
# Revert to last good commit
git log --oneline
git reset --hard <commit-sha>

# Or revert individual files
git checkout HEAD -- src/auth/providers/generic-provider.ts
```

---

## Expected Benefits

### Before
- GenericOAuthProvider: 382 lines
- GitHubOAuthProvider: 495 lines
- MicrosoftOAuthProvider: 497 lines
- **Total: 1,374 lines**

### After
- BaseOAuthProvider: +150 lines (new common implementations)
- GenericOAuthProvider: ~150 lines (-232 lines, 61% reduction)
- GitHubOAuthProvider: ~200 lines (-295 lines, 60% reduction)
- MicrosoftOAuthProvider: ~200 lines (-297 lines, 60% reduction)
- **Total: ~700 lines**

### Reduction: ~674 lines (49% reduction)

---

## Notes

- **Google provider unchanged** - uses OAuth2Client library, keep as-is
- **No breaking changes** - external interfaces remain identical
- **All tests must pass** - comprehensive test coverage ensures safety
- **Incremental approach** - one provider at a time minimizes risk

---

## Next Steps

1. Start with Phase 1 (add abstract methods to BaseOAuthProvider)
2. Validate type checking passes
3. Proceed through phases incrementally
4. Test after each phase
5. Full validation before commit

**Resume point:** Start Phase 1 - Add abstract methods to BaseOAuthProvider
