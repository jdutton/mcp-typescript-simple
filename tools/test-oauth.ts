#!/usr/bin/env -S npx tsx

/* eslint-disable sonarjs/updated-loop-counter, sonarjs/no-ignored-exceptions, no-unused-vars, @typescript-eslint/no-unused-vars, unicorn/prefer-top-level-await -- Development testing tool */
/**
 * OAuth connectivity and authentication flow testing tool
 */

// Handle help argument
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
OAuth Authentication Flow Testing Tool

Usage:
  ./tools/test-oauth.ts [options]
  npx tsx tools/test-oauth.ts [options]

Description:
  Tests OAuth authentication flows across different deployment modes.
  Validates OAuth providers, token handling, and MCP endpoint authentication.

Options:
  --help, -h                    Show this help message
  --url <url>                   Server URL (default: http://localhost:3000)
  --provider <provider>         OAuth provider: google|github|microsoft|generic (default: google)
  --flow                        Test interactive OAuth flow (opens browser)
  --token <access_token>        Test with existing access token
  --start                       Start server and test (local development only)

Deployment Mode Examples:

  Local Development (npm run dev:oauth):
    ./tools/test-oauth.ts
    ./tools/test-oauth.ts --flow --provider google
    ./tools/test-oauth.ts --token <your_token>

  Local Docker Deployment:
    ./tools/test-oauth.ts --url http://localhost:3000
    ./tools/test-oauth.ts --url http://localhost:3000 --flow

  Vercel Preview Deployment:
    ./tools/test-oauth.ts --url https://your-branch-abc123.vercel.app
    ./tools/test-oauth.ts --url https://your-branch-abc123.vercel.app --flow

  Vercel Production Deployment:
    ./tools/test-oauth.ts --url https://your-app.vercel.app
    ./tools/test-oauth.ts --url https://your-app.vercel.app --provider github

Features:
  - OAuth provider testing (Google, GitHub, Microsoft, generic)
  - Interactive authentication flow validation
  - Redirect URI configuration validation (catches common setup errors)
  - Token validation and MCP endpoint testing
  - Multi-deployment mode support
  - Session management testing
  - Health check validation

Environment Variables (for OAuth setup):
  GOOGLE_CLIENT_ID              Google OAuth client ID
  GOOGLE_CLIENT_SECRET          Google OAuth client secret
  GITHUB_CLIENT_ID              GitHub OAuth app client ID
  GITHUB_CLIENT_SECRET          GitHub OAuth app client secret
  MCP_MODE=streamable_http      Enable HTTP mode with OAuth

Examples:
  # Test local development server health
  ./tools/test-oauth.ts

  # Test OAuth flow on local server
  ./tools/test-oauth.ts --flow --provider google

  # Test with existing token on Vercel deployment
  ./tools/test-oauth.ts --url https://myapp.vercel.app --token abc123

  # Test GitHub OAuth on preview deployment
  ./tools/test-oauth.ts --url https://branch-xyz.vercel.app --flow --provider github
  `);
  process.exit(0);
}

import { spawn, ChildProcess } from 'node:child_process';

interface ServerHealthData {
  auth?: string;
  oauth_provider?: string;
  [key: string]: any;
}

interface TestOptions {
  url: string;
  provider: string;
  flow: boolean;
  token?: string;
  start: boolean;
}

function parseArgs(): TestOptions {
  const args = process.argv.slice(2);

  const options: TestOptions = {
    url: 'http://localhost:3000',
    provider: 'google',
    flow: false,
    start: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--url':
        if (args[i + 1]) {
          options.url = args[i + 1];
          i++;
        }
        break;
      case '--provider':
        if (args[i + 1]) {
          options.provider = args[i + 1];
          i++;
        }
        break;
      case '--flow':
        options.flow = true;
        break;
      case '--token':
        if (args[i + 1]) {
          options.token = args[i + 1];
          i++;
        }
        break;
      case '--start':
        options.start = true;
        break;
    }
  }

  return options;
}

async function testServerHealth(serverUrl: string): Promise<ServerHealthData> {
  console.log('🔍 Testing server health...');

  try {
    // Try both /health and /api/health endpoints
    let response: Response;
    let healthUrl: string;

    try {
      healthUrl = `${serverUrl}/api/health`;
      response = await fetch(healthUrl);

      // Check if response is successful and contains JSON
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('Invalid response from /api/health');
      }
    } catch {
      // Fallback to /health for local dev
      healthUrl = `${serverUrl}/health`;
      response = await fetch(healthUrl);

      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
        throw new Error(`Health check failed: ${response.status} ${response.statusText}`);
      }
    }

    const data = await response.json() as ServerHealthData;

    console.log('✅ Server health check passed');
    console.log(`📡 Health endpoint: ${healthUrl}`);
    console.log('📊 Server info:', JSON.stringify(data, null, 2));

    if (data.auth === 'enabled') {
      console.log(`🔐 OAuth provider: ${data.oauth_provider || 'configured'}`);
      return data;
    } else {
      console.log('⚠️  OAuth authentication is disabled');
      return data;
    }
  } catch (error: any) {
    console.error('❌ Health check failed:', error.message);
    console.log('💡 Make sure the server is running');
    console.log('   Local dev: npm run dev:oauth');
    console.log('   Docker: docker run -p 3000:3000 your-image');
    console.log('   Vercel: Check deployment status');
    throw error;
  }
}

async function testOAuthFlow(serverUrl: string, provider: string): Promise<void> {
  console.log('🚀 Testing OAuth flow...');

  const healthData = await testServerHealth(serverUrl);

  if (healthData.auth !== 'enabled') {
    console.log('❌ OAuth is not enabled. Set required environment variables:');
    console.log(`   ${provider.toUpperCase()}_CLIENT_ID`);
    console.log(`   ${provider.toUpperCase()}_CLIENT_SECRET`);
    console.log('   MCP_MODE=streamable_http');
    return;
  }

  console.log(`\n🔗 OAuth Flow Test for ${provider}:`);

  // Determine auth endpoint based on server type
  const authUrl = serverUrl.includes('vercel.app')
    ? `${serverUrl}/api/auth/${provider}`  // Vercel serverless functions
    : `${serverUrl}/auth/${provider}`;     // Direct server (local dev)

  // Validate redirect URI configuration
  await validateRedirectUri(authUrl, serverUrl, provider);

  console.log(`1. Open your browser to: ${authUrl}`);
  console.log('2. Complete the OAuth authorization');
  console.log('3. Copy the access_token from the response');
  console.log(`4. Run: npx tsx tools/test-oauth.ts --url ${serverUrl} --token <access_token>`);
  console.log('\n💡 Tip: Check browser network tab for the token response');
}

async function validateRedirectUri(authUrl: string, serverUrl: string, provider: string): Promise<void> {
  try {
    console.log('🔍 Validating OAuth redirect URI configuration...');

    // Make a request to the auth endpoint to get the OAuth redirect
    const response = await fetch(authUrl, { redirect: 'manual' });

    if (response.status !== 302) {
      console.log('⚠️  Expected redirect from auth endpoint, got status:', response.status);
      return;
    }

    const location = response.headers.get('location');
    if (!location) {
      console.log('⚠️  No redirect location found in auth response');
      return;
    }

    // Parse the OAuth URL to extract redirect_uri
    const oauthUrl = new URL(location);
    const redirectUri = oauthUrl.searchParams.get('redirect_uri');

    if (!redirectUri) {
      console.log('⚠️  No redirect_uri found in OAuth URL');
      return;
    }

    // Determine expected redirect URI based on server type
    const expectedRedirectUri = serverUrl.includes('vercel.app')
      ? `${serverUrl}/api/auth/${provider}/callback`  // Vercel serverless functions
      : `${serverUrl}/auth/${provider}/callback`;     // Direct server (local dev)

    console.log(`📍 Redirect URI being sent: ${redirectUri}`);
    console.log(`📍 Expected redirect URI: ${expectedRedirectUri}`);

    if (redirectUri === expectedRedirectUri) {
      console.log('✅ Redirect URI configuration is correct');
    } else {
      console.log('❌ Redirect URI MISMATCH detected!');
      console.log('\n🔧 To fix this issue:');
      console.log('1. Go to your OAuth provider\'s console (Google Cloud Console, GitHub, etc.)');
      console.log(`2. Add this EXACT redirect URI: ${redirectUri}`);
      console.log('3. Remove any incorrect redirect URIs');
      console.log('4. Save changes and wait a few moments for propagation');
      console.log('\nThis mismatch will cause "redirect_uri_mismatch" errors during OAuth flow.');
    }

  } catch (error) {
    console.log('⚠️  Could not validate redirect URI:', error instanceof Error ? error.message : String(error));
  }

  console.log(''); // Add spacing
}

async function testWithToken(serverUrl: string, token: string): Promise<void> {
  console.log('🔑 Testing with provided access token...');

  // Test token with MCP endpoint
  try {
    // Determine MCP endpoint based on server type
    const mcpUrl = serverUrl.includes('vercel.app') || serverUrl.includes('localhost') && serverUrl.includes('3000')
      ? `${serverUrl}/api/mcp`
      : `${serverUrl}/mcp`;

    const response = await fetch(mcpUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'text/event-stream'
      }
    });

    if (response.ok) {
      console.log('✅ Token is valid and accepted by MCP endpoint');
      console.log(`📡 Response status: ${response.status}`);
      console.log(`🎯 Content-Type: ${response.headers.get('content-type')}`);
    } else {
      console.log(`❌ Token rejected: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.log('Error details:', errorText);
    }
  } catch (error: any) {
    console.error('❌ Token test failed:', error.message);
  }

  // Check active sessions (if available)
  try {
    const sessionsUrl = serverUrl.includes('vercel.app') || serverUrl.includes('localhost')
      ? `${serverUrl}/api/admin/sessions`
      : `${serverUrl}/admin/sessions`;

    const sessionsResponse = await fetch(sessionsUrl);
    if (sessionsResponse.ok) {
      const sessions = await sessionsResponse.json();
      console.log('📋 Active sessions:', JSON.stringify(sessions, null, 2));
    }
  } catch (error) {
    console.log('ℹ️  Session endpoint not available (might be using SSE mode)');
  }
}

async function startServer(): Promise<ChildProcess> {
  console.log('🚀 Starting MCP server for testing...');

  return new Promise((resolve, reject) => {
    const server = spawn('npm', ['run', 'dev:oauth'], {
      stdio: 'pipe',
      env: { ...process.env }
    });

    let output = '';
    server.stdout?.on('data', (data) => {
      output += data.toString();
      process.stdout.write(data);

      // Wait for server to be ready
      if (output.includes('listening on') || output.includes('running on') || output.includes('Local:')) {
        setTimeout(() => resolve(server), 2000); // Give it 2 seconds to fully start
      }
    });

    server.stderr?.on('data', (data) => {
      process.stderr.write(data);
    });

    server.on('error', reject);
    server.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Server exited with code ${code}`));
      }
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      reject(new Error('Server start timeout'));
    }, 30000);
  });
}

async function main() {
  const options = parseArgs();

  try {
    if (options.start) {
      console.log('🚀 Starting server...');
      const server = await startServer();

      // Test after server starts
      await new Promise(resolve => setTimeout(resolve, 3000));
      await testServerHealth(options.url);

      console.log('\n💡 Server is running. Press Ctrl+C to stop.');

      process.on('SIGINT', () => {
        console.log('\n🛑 Stopping server...');
        server.kill();
        process.exit(0);
      });

      return;
    }

    if (options.flow) {
      await testOAuthFlow(options.url, options.provider);
      return;
    }

    if (options.token) {
      await testWithToken(options.url, options.token);
      return;
    }

    // Default: just test health
    await testServerHealth(options.url);
    console.log('\n💡 Use --flow to test OAuth, or --token <token> to test with existing token');

  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

main();