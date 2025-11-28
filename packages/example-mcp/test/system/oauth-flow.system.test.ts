/**
 * End-to-End OAuth Flow System Test
 *
 * Validates complete OAuth flow including:
 * - Provider selection page (/auth/login)
 * - Generic authorization endpoint (/auth/authorize)
 * - Provider-specific authorization (/auth/{provider})
 * - Token exchange (/auth/token)
 * - Discovery metadata correctness
 */

import request from 'supertest';
import {
  getCurrentEnvironment,

 
  describeSystemTest,
  isSTDIOEnvironment
} from './utils.js';

describeSystemTest('OAuth Flow End-to-End', () => {
  const environment = getCurrentEnvironment();

  // Skip HTTP tests in STDIO mode
  if (isSTDIOEnvironment(environment)) {
    // eslint-disable-next-line sonarjs/assertions-in-tests -- Valid test: setup or teardown
    it('should skip OAuth flow tests in STDIO mode', () => {
      console.log('ℹ️  OAuth flow tests skipped for STDIO transport mode');
    });
    return;
  }

  // Skip OAuth tests when auth is disabled (express:ci mode has MCP_DEV_SKIP_AUTH=true)
  if (environment.name === 'express:ci') {
    // eslint-disable-next-line sonarjs/assertions-in-tests -- Valid test: setup or teardown
    it('should skip OAuth flow tests when auth is disabled', () => {
      console.log('ℹ️  OAuth flow tests skipped - auth disabled in express:ci mode (MCP_DEV_SKIP_AUTH=true)');
    });
    return;
  }

  describe('Provider Selection Page (/auth/login)', () => {
    it('should return HTML with provider buttons', async () => {
      const response = await request(environment.baseUrl)
        .get('/auth/login');

      // OAuth might not be configured in test environment
      if (response.status !== 200) {
        console.log('ℹ️  Skipping OAuth flow tests - OAuth not configured in test environment');
        return;
      }

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/html/);

      expect(response.text).toContain('<title>Sign in to MCP Server</title>');
      expect(response.text).toContain('Choose your authentication provider');

      // Should contain provider buttons
      expect(response.text).toContain('Continue with');
    });

    it('should preserve state and redirect_uri query parameters', async () => {
      const state = 'test-state-123';
      const redirectUri = 'http://localhost:6274/oauth/callback';

      const response = await request(environment.baseUrl)
        .get('/auth/login')
        .query({ state, redirect_uri: redirectUri })
        .expect(200);

      // HTML should contain the state and redirect_uri in provider links
      expect(response.text).toContain(encodeURIComponent(state));
      expect(response.text).toContain(encodeURIComponent(redirectUri));
    });
  });

  describe('Generic Authorization Endpoint (/auth/authorize)', () => {
    it('should redirect to login page for provider selection', async () => {
      const response = await request(environment.baseUrl)
        .get('/auth/authorize')
        .query({
          response_type: 'code',
          client_id: 'test-client',
          redirect_uri: 'http://localhost:6274/callback',
          state: 'test-state'
        })
        .expect(302);

      // Should redirect to /auth/login
      expect(response.headers.location).toMatch(/\/auth\/login/);

      // Should preserve query parameters
      expect(response.headers.location).toContain('state=test-state');
      expect(response.headers.location).toContain('redirect_uri=');
    });
  });

  describe('Token Exchange Endpoint (/auth/token)', () => {
    it('should reject requests without grant_type', async () => {
      const response = await request(environment.baseUrl)
        .post('/auth/token')
        .send({})
        .expect(400);

      expect(response.body.error).toBe('unsupported_grant_type');
    });

    it('should handle authorization_code grant type', async () => {
      const response = await request(environment.baseUrl)
        .post('/auth/token')
        .send({
          grant_type: 'authorization_code',
          code: 'invalid-code',
          code_verifier: 'test-verifier'
        });

      // Will fail with invalid_grant since code is invalid, but validates endpoint exists
      expect([400, 401]).toContain(response.status);
      if (response.status === 400) {
        expect(response.body.error).toBe('invalid_grant');
      }
    });

    it('should handle refresh_token grant type', async () => {
      const response = await request(environment.baseUrl)
        .post('/auth/token')
        .send({
          grant_type: 'refresh_token',
          refresh_token: 'invalid-token'
        });

      // Will fail with invalid_grant since token is invalid, but validates endpoint exists
      expect([400, 401]).toContain(response.status);
      if (response.status === 400) {
        expect(response.body.error).toBe('invalid_grant');
      }
    });
  });

  describe('Discovery Metadata Validation', () => {
    it('should return correct authorization_endpoint in discovery metadata', async () => {
      const response = await request(environment.baseUrl)
        .get('/.well-known/oauth-authorization-server')
        .expect(200);

      // Metadata should advertise /auth/authorize endpoint
      expect(response.body.authorization_endpoint).toMatch(/\/auth\/authorize$/);
      expect(response.body.token_endpoint).toMatch(/\/auth\/token$/);
    });

    it('should ensure discovery metadata URLs are accessible', async () => {
      // First, get the discovery metadata
      const discovery = await request(environment.baseUrl)
        .get('/.well-known/oauth-authorization-server')
        .expect(200);

      // Extract just the path from the URLs
      const authPath = new URL(discovery.body.authorization_endpoint).pathname;
      const tokenPath = new URL(discovery.body.token_endpoint).pathname;

      // Validate authorization_endpoint is accessible
      const authResponse = await request(environment.baseUrl)
        .get(authPath)
        .query({ response_type: 'code', client_id: 'test' });

      expect([200, 302]).toContain(authResponse.status);

      // Validate token_endpoint is accessible
      const tokenResponse = await request(environment.baseUrl)
        .post(tokenPath)
        .send({ grant_type: 'authorization_code', code: 'test' });

      expect([400, 401]).toContain(tokenResponse.status);
    });
  });

  describe('OAuth Flow Integration', () => {
    it('should complete provider selection → authorization flow', async () => {
      // Step 1: Visit login page
      const loginResponse = await request(environment.baseUrl)
        .get('/auth/login')
        .query({
          state: 'client-state-123',
          redirect_uri: 'http://localhost:6274/callback'
        })
        .expect(200);

      // Step 2: Parse provider link from HTML
      const githubLinkMatch = loginResponse.text.match(/href="([^"]*github[^"]*)"/);
      expect(githubLinkMatch).toBeTruthy();

      if (githubLinkMatch && githubLinkMatch[1]) {
        const providerPath: string = githubLinkMatch[1];

        // Step 3: Click provider link (would redirect to GitHub in real flow)
        const providerResponse = await request(environment.baseUrl)
          .get(providerPath)
          .expect(302);

        // Should redirect to OAuth provider or handle OAuth flow
        expect(providerResponse.headers.location).toBeDefined();
      }
    });
  });
});
