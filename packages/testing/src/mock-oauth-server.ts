/**
 * OAuth Mock Server Helper for Playwright Tests
 *
 * Provides a configured oauth2-mock-server instance for testing OAuth flows
 * without requiring real OAuth provider credentials.
 */

import { OAuth2Server } from 'oauth2-mock-server';
import { TEST_PORTS } from './port-registry.js';

// Re-export from centralized port registry
export const MOCK_OAUTH_PORT = TEST_PORTS.MOCK_OAUTH;
export const MOCK_OAUTH_BASE_URL = `http://localhost:${MOCK_OAUTH_PORT}`;

/**
 * Mock user data returned by the mock OAuth server
 */
export const MOCK_USER_DATA = {
  sub: 'mock-user-123',
  email: 'playwright-test@example.com',
  name: 'Playwright Test User',
  picture: 'https://example.com/avatar.png'
};

/**
 * Mock OAuth client credentials
 */
export const MOCK_CLIENT_CONFIG = {
  clientId: 'mock-client-id',
  clientSecret: 'mock-client-secret'
};

/**
 * Create and configure an OAuth2 mock server for testing
 *
 * The server auto-approves all authorization requests and returns
 * mock tokens and user data.
 */
export async function createMockOAuthServer(): Promise<OAuth2Server> {
  const server = new OAuth2Server();

  // Generate signing keys
  await server.issuer.keys.generate('RS256');

  // Configure the server to return mock user data
  server.service.once('beforeUserinfo', (userInfoResponse, req) => {
    // Set custom user data in the userinfo response
    userInfoResponse.body = {
      ...MOCK_USER_DATA,
      // Include additional OIDC standard claims
      email_verified: true,
      updated_at: Math.floor(Date.now() / 1000)
    };
  });

  // Configure token response
  server.service.on('beforeTokenSigning', (token, req) => {
    // Add custom claims to ID token
    token.payload = {
      ...token.payload,
      ...MOCK_USER_DATA,
      email_verified: true
    };
  });

  return server;
}

/**
 * Start the mock OAuth server
 */
export async function startMockOAuthServer(server: OAuth2Server): Promise<void> {
  await server.start(MOCK_OAUTH_PORT, 'localhost');
  console.log(`✅ Mock OAuth server started on ${MOCK_OAUTH_BASE_URL}`);
  console.log(`   Authorization: ${server.issuer.url}/authorize`);
  console.log(`   Token: ${server.issuer.url}/token`);
  console.log(`   Userinfo: ${server.issuer.url}/userinfo`);
}

/**
 * Stop the mock OAuth server
 */
export async function stopMockOAuthServer(server: OAuth2Server): Promise<void> {
  await server.stop();
  console.log('🛑 Mock OAuth server stopped');
}

/**
 * Get environment variables for configuring MCP server to use mock OAuth
 *
 * @param mcpServerPort - Port where MCP server will run
 */
export function getMockOAuthEnvVars(mcpServerPort: number = 3555): Record<string, string> {
  return {
    // Enable OAuth mock mode
    OAUTH_MOCK_MODE: 'true',

    // Generic OAuth provider configuration pointing to mock server
    OAUTH_CLIENT_ID: MOCK_CLIENT_CONFIG.clientId,
    OAUTH_CLIENT_SECRET: MOCK_CLIENT_CONFIG.clientSecret,
    OAUTH_REDIRECT_URI: `http://localhost:${mcpServerPort}/oauth/callback`,
    OAUTH_AUTHORIZATION_URL: `${MOCK_OAUTH_BASE_URL}/authorize`,
    OAUTH_TOKEN_URL: `${MOCK_OAUTH_BASE_URL}/token`,
    OAUTH_USER_INFO_URL: `${MOCK_OAUTH_BASE_URL}/userinfo`,
    OAUTH_PROVIDER_NAME: 'MockOAuth',
    OAUTH_SCOPES: 'openid,email,profile'
  };
}
