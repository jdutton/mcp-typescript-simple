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
import { OAuthRegisteredClientsStore } from '../../auth/stores/client-store-interface.js';
import { logger } from '../../observability/logger.js';

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
  // OAuth 2.0 Dynamic Client Registration Endpoint (RFC 7591)
  const registerClientHandler = async (req: Request, res: Response): Promise<void> => {
    try {
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
    } catch (error) {
      logger.error('Client registration error', error);
      res.status(500).json({
        error: 'server_error',
        error_description: error instanceof Error ? error.message : String(error),
      });
    }
  };
  router.post('/register', registerClientHandler);

  // Client Configuration Endpoint - GET /register/:client_id (RFC 7592 Section 2.1)
  const getClientHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const clientId = req.params.client_id;
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
          error: 'not_found',
          error_description: 'Client not found',
        });
        return;
      }

      logger.info('Client configuration retrieved', { clientId });
      res.json(client);
    } catch (error) {
      logger.error('Get client error', error);
      res.status(500).json({
        error: 'server_error',
        error_description: error instanceof Error ? error.message : String(error),
      });
    }
  };
  router.get('/register/:client_id', getClientHandler);

  // Client Configuration Endpoint - DELETE /register/:client_id (RFC 7592 Section 2.3)
  const deleteClientHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const clientId = req.params.client_id;
      if (!clientId) {
        logger.warn('Client ID missing in request');
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'client_id is required',
        });
        return;
      }

      const deleted = await clientStore.deleteClient!(clientId);
      if (!deleted) {
        logger.warn('Client deletion failed: not found', { clientId });
        res.status(404).json({
          error: 'not_found',
          error_description: 'Client not found',
        });
        return;
      }

      logger.info('Client deleted successfully', { clientId });
      res.status(204).send();
    } catch (error) {
      logger.error('Delete client error', error);
      res.status(500).json({
        error: 'server_error',
        error_description: error instanceof Error ? error.message : String(error),
      });
    }
  };
  router.delete('/register/:client_id', deleteClientHandler);
}