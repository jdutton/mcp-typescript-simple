# Vercel Project Setup Guide (Issue #62)

This guide documents the process of re-creating the Vercel project for `mcp-typescript-simple` after the previous project became corrupted.

## Problem

The original Vercel project (`prj_tO17qBZm2xfpmkTbfAMDsqprCCA8`) became corrupted and no longer applied code updates. This required creating a fresh Vercel project and updating the CI/CD pipeline.

## Solution Overview

1. Remove old Vercel project linkage
2. Create new Vercel project
3. Configure GitHub Actions for automated deployment
4. Set up GitHub secrets
5. Configure Vercel environment variables
6. Deploy to production via CI/CD

## Step 1: Remove Old Project Linkage

The old `.vercel` directory contained project linkage to the corrupted project:

```bash
# Remove old project linkage
rm -rf .vercel
```

**Old project details** (for reference only):
- Project ID: `prj_tO17qBZm2xfpmkTbfAMDsqprCCA8`
- Org ID: `team_8yfWBDPy4KYjNu452aJhEbD2`
- Project Name: `mcp-typescript-simple`

## Step 2: Create New Vercel Project

### Option A: Via Vercel CLI (Recommended)

```bash
# 1. Ensure you're logged in to Vercel
vercel login

# 2. Link the project (creates new project)
vercel link

# Follow the prompts:
# - Set up and deploy? Yes
# - Which scope? Select your account/team
# - Link to existing project? No (create new)
# - What's your project's name? mcp-typescript-simple
# - In which directory is your code located? ./

# 3. Record the Project ID and Org ID
cat .vercel/project.json
```

**Example output:**
```json
{
  "projectId": "prj_NEW_PROJECT_ID_HERE",
  "orgId": "team_YOUR_ORG_ID_HERE",
  "projectName": "mcp-typescript-simple"
}
```

### Option B: Via Vercel Dashboard

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "Add New" → "Project"
3. Import from GitHub: `jdutton/mcp-typescript-simple`
4. Configure project:
   - Framework Preset: Other
   - Root Directory: `./`
   - Build Command: `npm run build`
   - Output Directory: (leave empty, using API directory)
5. Note the Project ID from project settings

## Step 3: Configure GitHub Secrets

Add these secrets in GitHub repository settings (`Settings` → `Secrets and variables` → `Actions`):

### Required Secrets

| Secret Name | Description | How to Get |
|------------|-------------|------------|
| `VERCEL_TOKEN` | Vercel API token for CI/CD | [Generate at Vercel](https://vercel.com/account/tokens) |
| `VERCEL_ORG_ID` | Organization/team ID | From `.vercel/project.json` (orgId field) |
| `VERCEL_PROJECT_ID` | Project ID | From `.vercel/project.json` (projectId field) |

### Optional LLM Provider Secrets

These are required for AI-powered tools to work:

| Secret Name | Description |
|------------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key (for chat/analyze/summarize tools) |
| `OPENAI_API_KEY` | OpenAI API key (for GPT models) |
| `GOOGLE_API_KEY` | Google AI API key (for Gemini models) |

### Generate Vercel Token

1. Go to [Vercel Account Tokens](https://vercel.com/account/tokens)
2. Click "Create Token"
3. Token Name: `GitHub Actions - mcp-typescript-simple`
4. Scope: Select your team/account
5. Expiration: No expiration (or set appropriate expiration)
6. Copy the token and add it to GitHub secrets as `VERCEL_TOKEN`

## Step 4: Configure Vercel Environment Variables

In the Vercel dashboard, configure these environment variables:

### Production Environment

1. Go to Project Settings → Environment Variables
2. Add the following variables for **Production** environment:

#### Required: User Allowlist

```
Name: ALLOWED_USERS
Value: your-email@example.com,teammate@example.com
Environment: Production
```

**⚠️ CRITICAL**: Always configure `ALLOWED_USERS` to restrict access to authorized users only.

#### OAuth Configuration (Choose one or more)

**Google OAuth:**
```
GOOGLE_CLIENT_ID=your-production-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-production-secret
GOOGLE_REDIRECT_URI=https://your-project.vercel.app/auth/google/callback
```

**GitHub OAuth:**
```
GITHUB_CLIENT_ID=your-production-github-client-id
GITHUB_CLIENT_SECRET=your-production-github-secret
GITHUB_REDIRECT_URI=https://your-project.vercel.app/auth/github/callback
```

**Microsoft OAuth:**
```
MICROSOFT_CLIENT_ID=your-production-azure-client-id
MICROSOFT_CLIENT_SECRET=your-production-azure-secret
MICROSOFT_REDIRECT_URI=https://your-project.vercel.app/auth/microsoft/callback
MICROSOFT_TENANT_ID=common
```

#### LLM Provider Keys (Optional)

```
ANTHROPIC_API_KEY=your-production-claude-key
OPENAI_API_KEY=your-production-openai-key
GOOGLE_API_KEY=your-production-gemini-key
```

### Preview Environment

Configure similar variables for **Preview** environment with development/testing values:
- Use test OAuth apps with wildcard redirect URIs
- Use development LLM API keys
- Use test user emails for `ALLOWED_USERS`

## Step 5: Update GitHub Actions Workflow

The GitHub Actions workflow (`.github/workflows/ci.yml`) has been updated with automated deployment:

**Key Changes:**
- Added `deploy` job that runs after all tests pass
- Deploys only when code is merged to `main` branch
- Uses Vercel CLI for deployment with prebuilt artifacts
- Requires `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` secrets

**Deployment Process:**
1. Pull request is created → Tests run (no deployment)
2. PR is merged to `main` → Tests run → Deployment to production
3. Deployment URL is logged in GitHub Actions output

## Step 6: Verify Setup

### Test CI/CD Pipeline

1. Create a test branch and make a small change
2. Push and create a pull request
3. Verify all CI checks pass
4. Merge the PR to `main`
5. Monitor GitHub Actions for deployment job
6. Check deployment logs for Vercel deployment URL

### Verify Deployment

```bash
# 1. Check health endpoint
curl https://your-project.vercel.app/api/health

# Expected response:
# {
#   "status": "healthy",
#   "deployment": "vercel",
#   "mode": "streamable_http",
#   "auth": "enabled",
#   ...
# }

# 2. Check OAuth discovery
curl https://your-project.vercel.app/.well-known/oauth-authorization-server

# 3. Test OAuth flow (in browser)
open https://your-project.vercel.app/auth/google
```

## Troubleshooting

### Deployment Fails in GitHub Actions

**Check:**
1. All GitHub secrets are correctly set (no typos)
2. `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` match `.vercel/project.json`
3. `VERCEL_TOKEN` is valid and not expired
4. Vercel project exists and is accessible

### OAuth Redirect Errors

**Fix:**
1. Update OAuth app redirect URIs to match Vercel production URL
2. Ensure `GOOGLE_REDIRECT_URI` (or other provider) matches exactly
3. Use HTTPS for production (automatic on Vercel)

### Environment Variables Not Working

**Fix:**
1. Verify variables are set for correct environment (Production/Preview)
2. Redeploy after adding new variables
3. Check variable names for typos (case-sensitive)

## Rollback Plan

If the new deployment has issues:

1. **Emergency Rollback**: Redeploy previous working version via Vercel dashboard
2. **Fix Issues**: Address problems in a new PR
3. **Redeploy**: Merge fix to main for automated deployment

## Security Checklist

Before going live:

- [ ] `ALLOWED_USERS` configured with actual user emails
- [ ] OAuth redirect URIs match production domain (HTTPS)
- [ ] Separate OAuth apps for production vs preview/dev
- [ ] Production LLM API keys (not development/test keys)
- [ ] GitHub secrets are set (not exposed in code)
- [ ] Vercel token has appropriate permissions and expiration
- [ ] Test OAuth flow with real users
- [ ] Monitor logs for unauthorized access attempts

## Reference Links

- [Vercel Dashboard](https://vercel.com/dashboard)
- [Vercel CLI Documentation](https://vercel.com/docs/cli)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Vercel Deployment Documentation](./vercel-deployment.md)
- [OAuth Setup Guide](./oauth-setup.md)

## Related Issues

- Issue #62: Re-implement Vercel hobby project and deploy Vercel prod
