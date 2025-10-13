/**
 * OAuth 2.0 Dynamic Client Registration endpoint for Vercel deployment
 * Implements RFC 7591 (Dynamic Client Registration Protocol)
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { ClientStoreFactory } from '../src/auth/client-store-factory.js';
import { OAuthRegisteredClientsStore } from '../src/auth/stores/client-store-interface.js';
import { logger } from '../src/observability/logger.js';
import { setOAuthAntiCachingHeaders } from '../src/auth/shared/oauth-helpers.js';

// Global client store instance for reuse across function invocations
let clientStoreInstance: OAuthRegisteredClientsStore | null = null;

/**
 * Initialize client store for serverless environment (uses factory for environment-based store selection)
 */
function initializeClientStore(): OAuthRegisteredClientsStore {
  if (clientStoreInstance) {
    return clientStoreInstance;
  }

  const store = ClientStoreFactory.create();
  clientStoreInstance = store;
  logger.info("OAuth client store initialized for Vercel DCR endpoint");
  return store;
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

    // Initialize client store (uses factory for environment-based selection)
    const clientStore = initializeClientStore();

    // POST /register - Register new OAuth client (RFC 7591 Section 3.1)
    if (req.method === 'POST') {
      try {
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

        // Validate individual redirect URIs for detailed error reporting
        for (const uri of req.body.redirect_uris) {
          try {
            new URL(uri);
          } catch {
            logger.warn('Invalid redirect URI', { uri });
            res.status(400).json({
              error: 'invalid_redirect_uri',
              error_description: `Invalid redirect URI: ${uri}`,
            });
            return;
          }
        }

        // Register client (store generates credentials automatically)
        const registeredClient = await clientStore.registerClient({
          redirect_uris: req.body.redirect_uris,
          client_name: req.body.client_name,
          client_uri: req.body.client_uri,
          logo_uri: req.body.logo_uri,
          scope: req.body.scope,
          contacts: req.body.contacts,
          tos_uri: req.body.tos_uri,
          policy_uri: req.body.policy_uri,
          jwks_uri: req.body.jwks_uri,
          token_endpoint_auth_method: req.body.token_endpoint_auth_method || 'client_secret_post',
          grant_types: req.body.grant_types || ['authorization_code', 'refresh_token'],
          response_types: req.body.response_types || ['code'],
        });

        logger.info('Client registered successfully', {
          clientId: registeredClient.client_id,
          clientName: registeredClient.client_name,
        });

        // Return client information (RFC 7591 Section 3.2.1)
        res.status(201).json(registeredClient);
        return;
      } catch (error) {
        logger.error('Client registration error', error);
        if (!res.headersSent) {
          res.status(500).json({
            error: 'server_error',
            error_description: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
    }

    // GET /register/:client_id - Retrieve client configuration (RFC 7592 Section 2.1)
    // Supports query parameter format: GET /register?client_id=X
    if (req.method === 'GET') {
      try {
        const { client_id } = req.query;

        if (!client_id || typeof client_id !== 'string') {
          logger.warn('Client ID missing in request');
          res.status(400).json({
            error: 'invalid_request',
            error_description: 'client_id is required',
          });
          return;
        }

        const client = await clientStore.getClient(client_id);

        if (!client) {
          logger.warn('Client not found', { clientId: client_id });
          res.status(404).json({
            error: 'invalid_client',
            error_description: 'Client not found',
          });
          return;
        }

        // Omit client_secret from response for security (RFC 7592)
        const { client_secret, ...clientWithoutSecret } = client;

        logger.info('Client configuration retrieved', { clientId: client_id });
        res.json(clientWithoutSecret);
        return;
      } catch (error) {
        logger.error('Get client error', error);
        if (!res.headersSent) {
          res.status(500).json({
            error: 'server_error',
            error_description: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
    }

    // DELETE /register/:client_id - Delete registered client (RFC 7592 Section 2.3)
    // Supports query parameter format: DELETE /register?client_id=X
    if (req.method === 'DELETE') {
      try {
        const { client_id } = req.query;

        if (!client_id || typeof client_id !== 'string') {
          logger.warn('Client ID missing in delete request');
          res.status(400).json({
            error: 'invalid_request',
            error_description: 'client_id is required',
          });
          return;
        }

        const deleted = await clientStore.deleteClient(client_id);

        if (!deleted) {
          logger.warn('Client not found for deletion', { clientId: client_id });
          res.status(404).json({
            error: 'invalid_client',
            error_description: 'Client not found',
          });
          return;
        }

        logger.info('Client deleted successfully', { clientId: client_id });
        res.status(204).end();
        return;
      } catch (error) {
        logger.error('Delete client error', error);
        if (!res.headersSent) {
          res.status(500).json({
            error: 'server_error',
            error_description: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
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
