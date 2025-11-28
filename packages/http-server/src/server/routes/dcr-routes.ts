/**
 * OAuth 2.0 Dynamic Client Registration (DCR) Routes
 *
 * Implements RFC 7591 (Dynamic Client Registration Protocol)
 * and RFC 7592 (Dynamic Client Registration Management Protocol)
 *
 * Endpoints:
 * - POST /register - Register new OAuth client
 * - GET /register/:client_id - Retrieve client configuration
 * - DELETE /register/:client_id - Delete registered client
 */

import { Router, Request, Response } from 'express';
import { OAuthRegisteredClientsStore } from '@mcp-typescript-simple/persistence';
import { logger } from '@mcp-typescript-simple/observability';

/**
 * Setup OAuth 2.0 Dynamic Client Registration routes
 *
 * @param router - Express router to attach routes to
 * @param clientStore - Client store for managing registered clients
 */
export function setupDCRRoutes(
  router: Router,
  clientStore: OAuthRegisteredClientsStore
): void {
  // Helper to set anti-caching headers for OAuth endpoints (RFC 6749, RFC 9700)
  // Prevents Vercel edge cache from serving stale OAuth responses
  const setAntiCachingHeaders = (res: Response): void => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  };

  // OAuth 2.0 Dynamic Client Registration Endpoint (RFC 7591)
  const registerClientHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      setAntiCachingHeaders(res);
      logger.info('Client registration request received', {
        clientName: req.body.client_name,
        redirectUris: req.body.redirect_uris,
      });

      // Validate required fields (RFC 7591 Section 2)
      if (!req.body.redirect_uris || !Array.isArray(req.body.redirect_uris) || req.body.redirect_uris.length === 0) {
        logger.warn('Client registration failed: missing redirect_uris');
        res.status(400).json({
          error: 'invalid_client_metadata',
          error_description: 'redirect_uris is required and must be a non-empty array',
        });
        return;
      }

      // Validate redirect URIs format
      for (const uri of req.body.redirect_uris) {
        try {
          new URL(uri);
        } catch {
          logger.warn('Client registration failed: invalid redirect_uri', { uri });
          res.status(400).json({
            error: 'invalid_redirect_uri',
            error_description: `Invalid redirect URI: ${uri}`,
          });
          return;
        }
      }

      // Register the client
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
        token_endpoint_auth_method: req.body.token_endpoint_auth_method ?? 'client_secret_post',
        grant_types: req.body.grant_types ?? ['authorization_code', 'refresh_token'],
        response_types: req.body.response_types ?? ['code'],
      });

      logger.info('Client registered successfully', {
        clientId: registeredClient.client_id,
        clientName: registeredClient.client_name,
      });

      // Return client information (RFC 7591 Section 3.2.1)
      res.status(201).json(registeredClient);
    } catch (error) {
      logger.error('Client registration error', error);
      setAntiCachingHeaders(res);
      res.status(500).json({
        error: 'server_error',
        error_description: error instanceof Error ? error.message : String(error),
      });
    }
  };
  router.post('/register', registerClientHandler);

  // Client Configuration Endpoint - GET /register/:client_id (RFC 7592 Section 2.1)
  // Also supports query parameter format: GET /register?client_id=X
  const getClientHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      setAntiCachingHeaders(res);
      // Support both path param and query param for flexibility
      const clientId = req.params.client_id ?? req.query.client_id as string;
      if (!clientId) {
        logger.warn('Client ID missing in request');
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'client_id is required',
        });
        return;
      }

      const client = await clientStore.getClient(clientId);
      if (!client) {
        logger.warn('Client not found', { clientId });
        res.status(404).json({
          error: 'invalid_client',
          error_description: 'Client not found',
        });
        return;
      }

      // Omit client_secret from response for security (RFC 7592)
      // eslint-disable-next-line sonarjs/no-unused-vars
      const { client_secret: _, ...clientWithoutSecret } = client;

      logger.info('Client configuration retrieved', { clientId });
      res.json(clientWithoutSecret);
    } catch (error) {
      logger.error('Get client error', error);
      setAntiCachingHeaders(res);
      res.status(500).json({
        error: 'server_error',
        error_description: error instanceof Error ? error.message : String(error),
      });
    }
  };
  // Support both path parameter and query parameter formats
  router.get('/register/:client_id', getClientHandler);
  router.get('/register', getClientHandler);

  // Client Configuration Endpoint - DELETE /register/:client_id (RFC 7592 Section 2.3)
  // Also supports query parameter format: DELETE /register?client_id=X
  const deleteClientHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      setAntiCachingHeaders(res);
      // Support both path param and query param for flexibility
      const clientId = req.params.client_id ?? req.query.client_id as string;
      if (!clientId) {
        logger.warn('Client ID missing in request');
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'client_id is required',
        });
        return;
      }

      const deleted = await clientStore.deleteClient?.(clientId);
      if (!deleted) {
        logger.warn('Client deletion failed: not found', { clientId });
        res.status(404).json({
          error: 'invalid_client',
          error_description: 'Client not found',
        });
        return;
      }

      logger.info('Client deleted successfully', { clientId });
      res.status(204).send();
    } catch (error) {
      logger.error('Delete client error', error);
      setAntiCachingHeaders(res);
      res.status(500).json({
        error: 'server_error',
        error_description: error instanceof Error ? error.message : String(error),
      });
    }
  };
  // Support both path parameter and query parameter formats
  router.delete('/register/:client_id', deleteClientHandler);
  router.delete('/register', deleteClientHandler);

  // Handle unsupported HTTP methods on /register (return 405)
  router.all('/register', (req: Request, res: Response) => {
    res.status(405).json({
      error: 'method_not_allowed',
      error_description: `Method ${req.method} not allowed on /register`,
      allowed_methods: ['GET', 'POST', 'DELETE']
    });
  });
  router.all('/register/:client_id', (req: Request, res: Response) => {
    res.status(405).json({
      error: 'method_not_allowed',
      error_description: `Method ${req.method} not allowed on /register/:client_id`,
      allowed_methods: ['GET', 'DELETE']
    });
  });
}