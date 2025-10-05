/**
 * OAuth 2.0 Dynamic Client Registration endpoint for Vercel deployment
 * Implements RFC 7591 (Dynamic Client Registration Protocol)
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { InMemoryClientStore } from '../build/auth/stores/memory-client-store.js';
import { logger } from '../build/observability/logger.js';
import { setOAuthAntiCachingHeaders } from './_utils/headers.js';

// Global client store instance for reuse across function invocations
let clientStoreInstance: InMemoryClientStore | null = null;

/**
 * Initialize client store for serverless environment
 */
function getClientStore(): InMemoryClientStore {
  if (!clientStoreInstance) {
    clientStoreInstance = new InMemoryClientStore();
    logger.info("Client store initialized for DCR");
  }
  return clientStoreInstance;
}

/**
 * Validate redirect URIs format
 */
function validateRedirectUris(uris: unknown): boolean {
  if (!Array.isArray(uris) || uris.length === 0) {
    return false;
  }

  for (const uri of uris) {
    try {
      new URL(uri);
    } catch {
      return false;
    }
  }

  return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Set anti-caching headers for OAuth endpoints (RFC 6749, RFC 9700)
    setOAuthAntiCachingHeaders(res);

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    const clientStore = getClientStore();

    // POST /register - Register new OAuth client (RFC 7591 Section 3.1)
    if (req.method === 'POST') {
      logger.info('Client registration request received', {
        clientName: req.body?.client_name,
        redirectUris: req.body?.redirect_uris,
      });

      // Validate required fields
      if (!validateRedirectUris(req.body?.redirect_uris)) {
        logger.warn('Client registration failed: invalid redirect_uris');
        res.status(400).json({
          error: 'invalid_client_metadata',
          error_description: 'redirect_uris is required and must be a non-empty array of valid URLs',
        });
        return;
      }

      // Generate client credentials
      const clientId = `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const clientSecret = `secret_${Date.now()}_${Math.random().toString(36).substr(2, 16)}`;
      const clientIdIssuedAt = Math.floor(Date.now() / 1000);

      // Register client
      const clientMetadata = {
        client_id: clientId,
        client_secret: clientSecret,
        client_id_issued_at: clientIdIssuedAt,
        client_name: req.body.client_name || 'MCP Client',
        redirect_uris: req.body.redirect_uris,
        token_endpoint_auth_method: req.body.token_endpoint_auth_method || 'client_secret_post',
        grant_types: req.body.grant_types || ['authorization_code', 'refresh_token'],
        response_types: req.body.response_types || ['code'],
        scope: req.body.scope || 'openid email profile',
      };

      await clientStore.registerClient(clientMetadata);

      logger.info('Client registered successfully', {
        clientId,
        clientName: clientMetadata.client_name,
      });

      // Return client credentials (RFC 7591 Section 3.2.1)
      res.status(201).json(clientMetadata);
      return;
    }

    // GET /register/:client_id - Retrieve client configuration
    if (req.method === 'GET') {
      const { client_id } = req.query;

      if (!client_id || typeof client_id !== 'string') {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'client_id parameter is required',
        });
        return;
      }

      const client = await clientStore.getClient(client_id);

      if (!client) {
        res.status(404).json({
          error: 'invalid_client',
          error_description: 'Client not found',
        });
        return;
      }

      // Don't return the client_secret for GET requests
      const { client_secret, ...clientWithoutSecret } = client;
      res.status(200).json(clientWithoutSecret);
      return;
    }

    // DELETE /register/:client_id - Delete registered client
    if (req.method === 'DELETE') {
      const { client_id } = req.query;

      if (!client_id || typeof client_id !== 'string') {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'client_id parameter is required',
        });
        return;
      }

      const deleted = await clientStore.deleteClient(client_id);

      if (!deleted) {
        res.status(404).json({
          error: 'invalid_client',
          error_description: 'Client not found',
        });
        return;
      }

      logger.info('Client deleted successfully', { clientId: client_id });
      res.status(204).end();
      return;
    }

    // Method not allowed
    res.status(405).json({
      error: 'method_not_allowed',
      error_description: `HTTP method ${req.method} is not supported for this endpoint`,
    });

  } catch (error) {
    logger.error("Client registration endpoint error", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: 'server_error',
        error_description: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  }
}
