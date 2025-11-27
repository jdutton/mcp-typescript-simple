#!/bin/bash
# Batch fix ESLint errors in base-provider.ts

FILE="/Users/jeff.dutton/Workspaces/mcp-typescript-simple/packages/auth/src/providers/base-provider.ts"

# Fix 1: Consolidate persistence imports (lines 25-29)
sed -i '' '25,29{
/import { ClientStore } from/d
/import { TokenStore } from/d
/import { PKCEStore } from/d
/import { SessionStore } from/d
/import { logger } from/d
}' "$FILE"

# Add consolidated import at line 25
sed -i '' '24a\
import { ClientStore, TokenStore, PKCEStore, SessionStore, logger } from '\''@mcp-typescript-simple/persistence'\'';
' "$FILE"

# Fix 2: Replace all || with ?? for nullish coalescing (be selective)
sed -i '' '
s/scopes: config\.scopes || /scopes: config.scopes ?? /g
s/redirectUri: config\.redirectUri || /redirectUri: config.redirectUri ?? /g
s/authorizeParams\.redirect_uri || /authorizeParams.redirect_uri ?? /g
s/storedState\.redirectUri || /storedState.redirectUri ?? /g
s/authorizeParams\.state || /authorizeParams.state ?? /g
s/req\.query\.code || /req.query.code ?? /g
s/req\.query\.state || /req.query.state ?? /g
s/storedPkce\.codeVerifier || /storedPkce.codeVerifier ?? /g
s/req\.headers\.authorization || /req.headers.authorization ?? /g
s/tokenResponse\.scope || /tokenResponse.scope ?? /g
s/idToken || /idToken ?? /g
s/refreshToken || /refreshToken ?? /g
s/session\.metadata\.redirectUri || /session.metadata.redirectUri ?? /g
s/session\.clientId || /session.clientId ?? /g
s/query\.client_id || /query.client_id ?? /g
s/session\.originalState || /session.originalState ?? /g
' "$FILE"

# Fix 3: Prefix unused parameters with _
sed -i '' '
s/async handleLogin(config,/async handleLogin(_config,/
s/async handleCallback(req, res)/async handleCallback(_req, _res)/
s/async handleLogout(req, res)/async handleLogout(_req, _res)/
s/async refreshAccessToken(accessToken/async refreshAccessToken(_accessToken/
s/async revokeToken(accessToken/async revokeToken(_accessToken/
' "$FILE"

# Fix 4: Replace non-null assertions with nullish coalescing
sed -i '' '
s/session\.state!/session.state ?? '"'"''"'"'/g
s/session\.codeVerifier!/session.codeVerifier ?? '"'"''"'"'/g
s/session\.originalState!/session.originalState ?? null/g
s/storedPkce\.state!/storedPkce.state ?? '"'"''"'"'/g
s/storedState\.state!/storedState.state ?? '"'"''"'"'/g
s/query\.state!/query.state ?? '"'"''"'"'/g
' "$FILE"

# Fix 5: Fix prefer-optional-chain
sed -i '' 's/session && session\.clientId/session?.clientId/g' "$FILE"

echo "Base provider fixes applied"
