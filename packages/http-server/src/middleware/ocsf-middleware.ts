/**
 * OCSF Middleware
 *
 * Provides middleware and utilities for emitting OCSF events from HTTP requests
 */

import { Request, Response, NextFunction } from 'express';
import { emitOCSFEvent, apiActivityEvent, logger } from '@mcp-typescript-simple/observability';

/**
 * Sanitize IP address for OCSF events
 *
 * Handles malformed inputs and normalizes IPv6 addresses:
 * - Undefined/empty → 127.0.0.1
 * - IPv6 localhost (::1) → 127.0.0.1
 * - IPv4-mapped IPv6 (::ffff:192.168.1.1) → 192.168.1.1
 *
 * @param ip - IP address from req.ip or req.socket.remoteAddress
 * @returns Sanitized IP address
 */
function sanitizeIP(ip: string | undefined): string {
  if (!ip || ip === '::1') return '127.0.0.1';
  return ip.replace(/^::ffff:/, ''); // Strip IPv6 prefix
}

/**
 * Emit an OCSF API Activity event for an HTTP request
 *
 * Automatically populates common fields from Express req/res objects
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param options - Additional OCSF event options
 */
export function emitAPIActivityEvent(
  req: Request,
  res: Response,
  options?: {
    startTime?: number;
  }
): void {
  try {
    const startTime = options?.startTime || Date.now();
    const duration = Date.now() - startTime;

    // Determine status from HTTP status code
    const statusCode = res.statusCode;
    const statusId = statusCode >= 200 && statusCode < 300 ? 1 : 2; // 1 = Success, 2 = Failure

    // Construct full URL string (required by OCSF HTTPRequest)
    const protocol = req.protocol || 'http';
    const host = req.get('host') || req.hostname;
    const urlString = `${protocol}://${host}${req.url}`;

    // Build OCSF API Activity event using builder pattern
    const event = apiActivityEvent(1) // 1 = Create (API Activity default)
      .actor({
        user: {
          name: req.get('x-user-name') || 'anonymous',
          uid: req.get('x-user-id'),
        },
      })
      .api({
        operation: `${req.method} ${req.path}`,
        request: {
          uid: req.get('x-request-id'),
        },
        response: {
          code: statusCode,
          message: res.statusMessage || (statusCode >= 200 && statusCode < 300 ? 'OK' : 'Error'),
        },
      })
      .httpRequest({
        method: req.method,
        url: {
          url_string: urlString,
          path: req.path,
          hostname: req.hostname,
          port: req.socket?.localPort,
          scheme: protocol,
          query_string: req.url.includes('?') ? req.url.split('?')[1] : undefined,
        },
        user_agent: req.get('user-agent') || 'unknown',
      })
      .srcEndpoint({
        ip: sanitizeIP(req.ip || req.socket?.remoteAddress),
        port: req.socket?.remotePort,
      })
      .duration(duration)
      .status(statusId, statusCode.toString()) // status is auto-generated from statusId
      .build();

    emitOCSFEvent(event);
  } catch (error) {
    // Never throw from audit logging - use structured logger
    logger.error('Failed to emit OCSF API Activity event', { error });
  }
}

/**
 * Express middleware that automatically emits OCSF events after response
 *
 * Usage:
 * ```typescript
 * router.use(ocsf Middleware());
 * ```
 */
export function ocsfMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    // Capture the original res.json method
    const originalJson = res.json.bind(res);

    // Override res.json to emit OCSF event after response
    res.json = function (body: any) {
      const result = originalJson(body);

      // Emit OCSF event asynchronously after response completes
      // setImmediate schedules callback for next event loop iteration (after I/O)
      // This ensures event emission doesn't delay HTTP response to client
      setImmediate(() => {
        emitAPIActivityEvent(req, res, { startTime });
      });

      return result;
    };

    next();
  };
}
