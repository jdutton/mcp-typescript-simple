# Vercel Deployment Setup

This document provides instructions for configuring automated Vercel deployments via GitHub Actions.

## Overview

The repository includes automated Vercel production deployments that trigger on every merge to the `main` branch. This requires configuring GitHub repository secrets for Vercel authentication.

## Required GitHub Secrets

The following secrets must be configured in the GitHub repository:

### 1. VERCEL_TOKEN

**Description:** Authentication token for Vercel CLI operations

**How to get it:**
1. Go to https://vercel.com/account/tokens
2. Click "Create Token"
3. Name it: `GitHub Actions - mcp-typescript-simple`
4. Set scope: Full Account
5. Copy the generated token

### 2. VERCEL_ORG_ID

**Description:** Your Vercel organization/team ID

**How to get it:**
1. Go to your Vercel project: https://vercel.com/dashboard
2. Select the `mcp-typescript-simple` project
3. Click "Settings" → "General"
4. Scroll to "Project ID" section
5. Copy the Organization ID value

**Alternative method:**
```bash
# Using Vercel CLI
vercel whoami
# The output shows your team/org ID
```

### 3. VERCEL_PROJECT_ID

**Description:** The specific Vercel project ID for mcp-typescript-simple

**How to get it:**
1. Go to https://vercel.com/dashboard
2. Select the `mcp-typescript-simple` project
3. Click "Settings" → "General"
4. Copy the "Project ID" value

**Alternative method:**
```bash
# From project directory
vercel project ls
# Shows project ID in the output
```

## Configuring GitHub Secrets

1. Go to your GitHub repository
2. Navigate to: **Settings** → **Secrets and variables** → **Actions**
3. Click **"New repository secret"**
4. Add each of the three secrets above:
   - Name: `VERCEL_TOKEN`, Value: `<your-token>`
   - Name: `VERCEL_ORG_ID`, Value: `<your-org-id>`
   - Name: `VERCEL_PROJECT_ID`, Value: `<your-project-id>`

## Deployment Workflow

Once secrets are configured, the deployment process is fully automated:

1. **Developer workflow:**
   - Create feature branch
   - Make changes
   - Run `npm run validate` (must pass)
   - Commit and push
   - Create pull request

2. **GitHub Actions workflow:**
   - Validation pipeline runs (`.github/workflows/validate.yml`)
   - All checks must pass (typecheck, lint, tests, build)
   - PR is reviewed and merged to `main`

3. **Automated deployment:**
   - Merge triggers `.github/workflows/vercel.yml`
   - Code is built and deployed to Vercel production
   - Health check verifies deployment
   - Production URL updated: https://mcp-typescript-simple.vercel.app

## Verifying Deployment

After a PR is merged to main:

1. Check GitHub Actions status:
   ```bash
   gh workflow view "Vercel Production Deployment"
   gh run list --workflow=vercel.yml --limit=1
   ```

2. Verify production deployment:
   ```bash
   curl https://mcp-typescript-simple.vercel.app/health
   ```

3. Check Vercel dashboard:
   - https://vercel.com/dashboard
   - View deployment logs and metrics

## Troubleshooting

### Deployment fails with "Invalid token"

**Cause:** `VERCEL_TOKEN` is incorrect or expired

**Solution:**
1. Generate a new token at https://vercel.com/account/tokens
2. Update the `VERCEL_TOKEN` secret in GitHub

### Deployment fails with "Project not found"

**Cause:** `VERCEL_ORG_ID` or `VERCEL_PROJECT_ID` is incorrect

**Solution:**
1. Verify IDs in Vercel project settings
2. Update the secrets in GitHub

### Health check fails after deployment

**Cause:** Deployment succeeded but application isn't responding correctly

**Solution:**
1. Check Vercel deployment logs in dashboard
2. Verify environment variables are set in Vercel project settings
3. Test the deployment URL manually

## Security Considerations

- **Never commit Vercel tokens to git** - always use GitHub Secrets
- **Rotate tokens periodically** - recommended every 90 days
- **Use minimum required scope** - Full Account access for deployment automation
- **Audit secret access** - Review GitHub Actions logs regularly

## Manual Deployment (Development Only)

For testing Vercel configuration locally (not recommended for production):

```bash
# Install Vercel CLI
npm install -g vercel

# Login to Vercel
vercel login

# Deploy to preview environment
npm run build
vercel

# NEVER use for production - let GitHub Actions handle production deployments
```

## Related Documentation

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Vercel CLI Documentation](https://vercel.com/docs/cli)
- [Vercel Deployment Documentation](https://vercel.com/docs/deployments/overview)
- Issue #74: Implementation tracking
