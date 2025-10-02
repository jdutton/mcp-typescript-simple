# Sharing Your MCP Server

This guide explains how to share your deployed MCP server with external users and teams.

## Overview

Once you've deployed your MCP server to Vercel with OAuth authentication and user allowlist, you can safely share it with authorized users. This guide covers:

- Adding users to the allowlist
- Providing connection instructions to users
- Testing connections before sharing
- Troubleshooting common user issues

## Prerequisites

Before sharing your MCP server:

1. ✅ Server deployed to Vercel (production environment)
2. ✅ OAuth provider configured (Google, GitHub, or Microsoft)
3. ✅ `ALLOWED_USERS` environment variable configured
4. ✅ Server tested and verified working

## Adding Users to the Allowlist

### Step 1: Get User Email Addresses

Collect email addresses from users who need access:
- For **Google OAuth**: Use their Gmail or Google Workspace email
- For **GitHub OAuth**: Use their GitHub account email (primary or public)
- For **Microsoft OAuth**: Use their Microsoft/Office 365 email

**Important**: The email must match what the OAuth provider returns. Users should verify their email in their account settings.

### Step 2: Update Vercel Environment Variable

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project
3. Go to **Settings** → **Environment Variables**
4. Find `ALLOWED_USERS` variable
5. Click **Edit**
6. Add new user emails (comma-separated):
   ```
   existing-user@company.com,new-user1@company.com,new-user2@company.com
   ```
7. Click **Save**
8. **Redeploy** the project (required for changes to take effect)

### Step 3: Trigger Redeployment

Option A: Via Vercel Dashboard
1. Go to **Deployments** tab
2. Click the three dots (...) on the latest deployment
3. Select **Redeploy**

Option B: Via Git Push
```bash
# Make a trivial commit to trigger redeployment
git commit --allow-empty -m "Update allowed users"
git push origin main
```

### Step 4: Verify User Access

After redeployment, test with the new user's credentials:
```bash
# Ask the user to test
npx @modelcontextprotocol/inspector https://your-app.vercel.app/api/mcp
```

## User Connection Instructions

### For End Users (Claude Desktop)

Share these instructions with your users:

---

**Connecting to [Your Company] MCP Server**

1. **Install Claude Desktop** (if not already installed)
   - Download from [claude.ai/download](https://claude.ai/download)

2. **Locate Claude Configuration**
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

3. **Add MCP Server**

   Open the config file and add:
   ```json
   {
     "mcpServers": {
       "company-mcp": {
         "url": "https://your-app.vercel.app/api/mcp",
         "transport": "streamableHttp"
       }
     }
   }
   ```

4. **Restart Claude Desktop**

5. **Authenticate**
   - Claude will prompt for authentication
   - Click the authentication link
   - Sign in with your [Google/GitHub/Microsoft] account
   - Authorize the application

6. **Verify Connection**
   - Look for the MCP server icon in Claude's interface
   - Try using an MCP tool (e.g., ask Claude to "echo hello")

**Troubleshooting:**
- If authentication fails, verify your email is on the allowed list
- If tools don't appear, restart Claude Desktop
- Contact your administrator if issues persist

---

### For Developers (MCP Inspector)

For developers who want to test the MCP server:

```bash
# Test MCP server connection
npx @modelcontextprotocol/inspector https://your-app.vercel.app/api/mcp

# The inspector will:
# 1. Open a browser for OAuth authentication
# 2. Show available tools and prompts
# 3. Allow interactive testing

# Available tools:
# - Basic: echo, hello, current-time
# - AI-powered: chat, analyze, summarize, explain (if LLM keys configured)
```

### For API Users (Direct HTTP)

For programmatic access:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Create transport
const transport = new StreamableHTTPClientTransport({
  url: 'https://your-app.vercel.app/api/mcp',
  // OAuth flow will be handled automatically
});

// Create client
const client = new Client({
  name: 'my-app',
  version: '1.0.0',
}, {
  capabilities: {}
});

// Connect
await client.connect(transport);

// Use tools
const result = await client.callTool({
  name: 'echo',
  arguments: { message: 'Hello, MCP!' }
});
```

## Testing Before Sharing

### Pre-Share Checklist

Test your MCP server before sharing with users:

1. **Health Check**
   ```bash
   curl https://your-app.vercel.app/health
   ```
   Should return 200 OK with server status

2. **OAuth Flow**
   ```bash
   # Open in browser
   open https://your-app.vercel.app/auth/google
   # (or /auth/github or /auth/microsoft)
   ```
   Should redirect to OAuth provider and back successfully

3. **MCP Inspector**
   ```bash
   npx @modelcontextprotocol/inspector https://your-app.vercel.app/api/mcp
   ```
   Should authenticate and show available tools

4. **Tool Execution**
   In MCP Inspector, test basic tools:
   - `echo` with message "test"
   - `hello` with name "tester"
   - `current-time`

5. **Allowlist Enforcement**
   Try connecting with an unauthorized email (should fail with 403)

### Pilot Testing

Before rolling out to all users:

1. **Add 1-2 pilot users** to the allowlist
2. **Provide connection instructions**
3. **Watch Vercel logs** for any issues
4. **Collect feedback** on the connection experience
5. **Fix any issues** before broader rollout

## Managing User Access

### Adding Multiple Users at Once

```bash
# In Vercel environment variables
ALLOWED_USERS=user1@company.com,user2@company.com,user3@company.com,user4@company.com,user5@company.com
```

**Tip**: Keep a master list in a secure location (1Password, etc.) to track who has access.

### Removing User Access

1. Go to Vercel Dashboard → Environment Variables
2. Find `ALLOWED_USERS`
3. Remove the user's email from the list
4. Save and redeploy

The user will immediately lose access after redeployment.

### Auditing Access

Check Vercel logs to see who's accessing the server:

```bash
# Via Vercel CLI
vercel logs --follow

# Or via Vercel Dashboard
# Go to Deployments → [Latest] → Runtime Logs
```

Look for authentication events:
```json
{
  "level": "info",
  "msg": "User authenticated",
  "email": "user@company.com",
  "provider": "google"
}
```

And access denials:
```json
{
  "level": "warn",
  "msg": "Access denied - user not on allowlist",
  "email": "unauthorized@example.com"
}
```

## Common User Issues

### Issue 1: "Access Denied" Error

**Symptom**: User gets 403 error after OAuth authentication

**Causes**:
- User email not in `ALLOWED_USERS`
- Email mismatch (OAuth provider returns different email)
- Environment variable not redeployed

**Solution**:
1. Verify exact email OAuth provider returns (check logs)
2. Add email to `ALLOWED_USERS` in Vercel
3. Redeploy the application
4. Ask user to try again

### Issue 2: OAuth Redirect Loop

**Symptom**: User gets stuck in authentication loop

**Causes**:
- OAuth redirect URI mismatch
- Browser blocking cookies/redirects
- OAuth app not approved for production use

**Solution**:
1. Verify OAuth redirect URI in provider settings:
   - `https://your-app.vercel.app/auth/[provider]/callback`
2. Ask user to try incognito/private browsing
3. Check OAuth app is approved for external users (Google, Microsoft)

### Issue 3: Tools Not Appearing in Claude

**Symptom**: User connects but no tools are available

**Causes**:
- Claude Desktop not restarted after config change
- Config file has JSON syntax errors
- MCP server not fully initialized

**Solution**:
1. Verify JSON syntax in config file (use jsonlint.com)
2. Completely quit and restart Claude Desktop
3. Check connection status in Claude settings

### Issue 4: "No LLM Provider" Error

**Symptom**: AI-powered tools fail with provider error

**Causes**:
- No LLM API keys configured in Vercel
- API keys expired or invalid
- API quota exceeded

**Solution**:
1. Verify LLM API keys in Vercel environment variables
2. Check API key validity with provider
3. Check billing/quota limits
4. Note: Basic tools (echo, hello, current-time) work without LLM keys

## Scaling to Teams

### Organization-Wide Deployment

For larger teams:

1. **Use Google Workspace / Microsoft 365**
   - Configure OAuth with your organization's IdP
   - Use domain-based allowlist (requires custom implementation)

2. **Implement Groups**
   - Create user groups (engineering, product, etc.)
   - Manage allowlist via group membership
   - Requires custom group sync implementation

3. **Set Up Monitoring**
   - Configure alerts for:
     - Failed authentication attempts
     - API quota warnings
     - Error rate spikes
   - Use Vercel Analytics or external monitoring (DataDog, etc.)

4. **Document Internal Processes**
   - How to request access
   - Who approves new users
   - How to report issues
   - Expected response times

### Cost Management

Monitor usage and costs:

1. **Vercel Usage**
   - Check Vercel dashboard for bandwidth/compute
   - Set spending limits if on Pro plan
   - Monitor preview deployment usage

2. **LLM API Costs**
   - Check provider dashboards (Anthropic, OpenAI, Google)
   - Set up billing alerts
   - Monitor per-user usage if needed
   - Consider rate limiting for high-volume users

3. **Optimize Costs**
   - Use cheaper models for simple tasks
   - Implement response caching
   - Set reasonable token limits
   - Archive unused preview deployments

## Security Best Practices

### Regular Access Review

- **Monthly**: Review allowlist, remove departed users
- **Quarterly**: Rotate OAuth secrets and API keys
- **Audit logs**: Check for suspicious access patterns

### User Training

Provide users with:
- What data the MCP server can access
- What data is logged/stored
- Privacy and security policies
- How to report security concerns

### Incident Response

If unauthorized access detected:

1. **Immediately**: Remove user from allowlist and redeploy
2. **Review logs**: Check what actions were taken
3. **Rotate secrets**: Change OAuth secrets and API keys
4. **Notify stakeholders**: Inform affected teams
5. **Document incident**: Record for future prevention

## Example: Company Rollout Plan

Here's a template rollout plan:

**Week 1: Pilot (5 users)**
- Add 5 power users to allowlist
- Provide detailed instructions
- Daily check-ins for feedback
- Fix any issues discovered

**Week 2: Department (25 users)**
- Add entire engineering team
- Hold training session
- Monitor usage and costs
- Gather feedback

**Week 3: Company-Wide (100+ users)**
- Add all approved users
- Send company-wide announcement
- Set up support channel (Slack, email)
- Monitor for scale issues

**Ongoing: Maintenance**
- Weekly access review
- Monthly cost review
- Quarterly security audit
- Regular user feedback collection

## Support Resources

### For Administrators

- [Vercel Deployment Guide](vercel-deployment.md)
- [MCP Inspector Testing](mcp-inspector.md)
- [Vercel Documentation](https://vercel.com/docs)

### For End Users

- [Claude Desktop Documentation](https://claude.ai/docs)
- [MCP Specification](https://modelcontextprotocol.io)

### Getting Help

- **Project Issues**: [GitHub Issues](https://github.com/jdutton/mcp-typescript-simple/issues)
- **Vercel Support**: [Vercel Support](https://vercel.com/support)
- **MCP Community**: [MCP Discord](https://discord.gg/modelcontextprotocol)

## Conclusion

Sharing your MCP server securely requires:

1. ✅ Proper allowlist configuration
2. ✅ Clear user instructions
3. ✅ Thorough testing before rollout
4. ✅ Ongoing access management
5. ✅ Regular security reviews

Follow this guide to ensure a smooth, secure deployment for your team.
