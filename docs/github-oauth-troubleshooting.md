# GitHub OAuth Troubleshooting Guide

## Common Error: "Failed to fetch user information from GitHub"

This error typically occurs during the OAuth callback when the server successfully obtains an access token but fails to fetch user details from GitHub's API.

### Quick Diagnosis Steps

#### 1. **Check Server Logs**
With the enhanced logging, you should now see detailed information about what's failing:

```bash
npm run dev:oauth:github
```

Look for these log entries:
- `🔍 Fetching GitHub user info with token: abc123...`
- `📡 GitHub user API response status: 200 OK` (or error status)
- `👤 GitHub user data received:` with user details
- `📧 Initial email from user profile:` showing email status

#### 2. **Test with Debug Endpoint**
Use the new debug endpoint to test your GitHub token directly:

```bash
# Get your access token from MCP Inspector or OAuth flow
# Then test it directly
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
     http://localhost:3000/debug/github-oauth
```

This will show you exactly what GitHub's API returns for both user data and emails.

## Root Cause Analysis

### **Issue 1: GitHub Email Privacy Settings (Most Common)**

**Symptoms:**
- Log shows: `📧 Initial email from user profile: null (private)`
- Error: `No email address found for GitHub user`

**Solution:**
1. **Check GitHub Email Settings:**
   - Go to GitHub Settings → Emails
   - Ensure you have a verified email address
   - Check "Keep my email addresses private" setting

2. **Update GitHub App Permissions:**
   - Go to GitHub Settings → Developer settings → OAuth Apps
   - Find your MCP app
   - Ensure it requests `user:email` scope

3. **Test Email Access:**
   ```bash
   # Test if your token can access emails
   curl -H "Authorization: Bearer YOUR_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        https://api.github.com/user/emails
   ```

### **Issue 2: Invalid or Expired Access Token**

**Symptoms:**
- Log shows: `📡 GitHub user API response status: 401 Unauthorized`
- Error response: `{"message": "Bad credentials"}`

**Solutions:**
1. **Verify Token Format:**
   - GitHub tokens start with `gho_` (OAuth) or `ghp_` (Personal Access)
   - Ensure no extra characters or truncation

2. **Test Token Manually:**
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
        https://api.github.com/user
   ```

### **Issue 3: Insufficient GitHub App Permissions**

**Symptoms:**
- User API works (200) but emails API returns 403/404
- Log shows: `❌ GitHub emails API error: 403 Forbidden`

**Solutions:**
1. **Check OAuth App Scopes:**
   - Your `.env.github` has: `GITHUB_SCOPES="user:email,read:user"`
   - Verify GitHub app is authorized with these scopes

2. **Re-authorize the App:**
   - Go to GitHub Settings → Applications → Authorized OAuth Apps
   - Find your MCP app and revoke access
   - Re-run the OAuth flow to grant fresh permissions

### **Issue 4: GitHub App vs GitHub App (Different Types)**

**Symptoms:**
- OAuth flow works but API calls fail
- Unusual token format

**Solution:**
Ensure you created an **OAuth App**, not a **GitHub App**:
- Go to GitHub Settings → Developer settings
- Use **OAuth Apps** (not GitHub Apps)
- OAuth Apps use simpler flow and different token format

## GitHub App Configuration Checklist

### Required Settings:
```
Application name: MCP TypeScript Server (Development)
Homepage URL: http://localhost:3000
Authorization callback URL: http://localhost:3000/auth/github/callback
```

### Required Permissions:
- ✅ `user:email` - Access user email addresses (primary requirement)
- ✅ `read:user` - Read user profile information

### Environment Configuration:
```bash
# .env.github
OAUTH_PROVIDER=github
GITHUB_CLIENT_ID=Iv23liFokoaOwIyhDIwb
GITHUB_CLIENT_SECRET=92132818aae08ad852ac9f913e4238411cd9ee67
GITHUB_REDIRECT_URI=http://localhost:3000/auth/github/callback
GITHUB_SCOPES="user:email,read:user"
```

## Testing Steps

### 1. **Start Server with Debug Logging:**
```bash
npm run dev:oauth:github
```

### 2. **Test OAuth Flow:**
1. Open MCP Inspector
2. Connect with GitHub OAuth configuration
3. Watch server logs for detailed error information
4. Check each step of the process

### 3. **Manual Token Testing:**
If you have an access token, test it manually:

```bash
# Test user API
curl -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Accept: application/vnd.github.v3+json" \
     https://api.github.com/user

# Test emails API
curl -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Accept: application/vnd.github.v3+json" \
     https://api.github.com/user/emails

# Use debug endpoint
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:3000/debug/github-oauth
```

### 4. **Check GitHub Rate Limits:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
     https://api.github.com/rate_limit
```

## Common Solutions

### **Fix 1: Public Email Required**
If you want to keep your email private but still use OAuth:

1. Add a secondary public email to your GitHub account
2. Set it as primary in GitHub Settings → Emails
3. Re-run the OAuth flow

### **Fix 2: Update App Permissions**
1. Go to your GitHub OAuth App settings
2. Ensure description clearly states email access is needed
3. Update user-facing documentation about email requirements

### **Fix 3: Token Refresh**
GitHub OAuth tokens don't expire, but may be revoked:
1. Revoke and re-authorize the app
2. Check for token format issues
3. Verify client secret hasn't changed

## Advanced Debugging

### **Enable Maximum Logging:**
The enhanced GitHub provider now logs:
- Token preview (first 10 characters)
- API response status codes
- User data received (without sensitive info)
- Email discovery process
- Specific error details

### **Check Network Issues:**
```bash
# Test basic connectivity
curl -I https://api.github.com

# Test with exact headers we use
curl -H "User-Agent: MCP-TypeScript-Server" \
     -H "Accept: application/vnd.github.v3+json" \
     https://api.github.com/user
```

### **Verify CORS/Headers:**
GitHub API requires specific headers that our implementation includes:
- `Accept: application/vnd.github.v3+json`
- `User-Agent: MCP-TypeScript-Server`
- `Authorization: Bearer TOKEN`

## Still Having Issues?

1. **Capture Full Logs:**
   ```bash
   npm run dev:oauth:github 2>&1 | tee oauth-debug.log
   ```

2. **Test Debug Endpoint:**
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
        http://localhost:3000/debug/github-oauth > debug-output.json
   ```

3. **Check GitHub Status:**
   - Visit https://www.githubstatus.com
   - Verify API is operational

4. **Create Minimal Test:**
   Use the debug endpoint and manual curl commands to isolate the issue

The enhanced error logging should now provide much clearer information about exactly where the process fails, making it easier to identify and fix the specific issue.