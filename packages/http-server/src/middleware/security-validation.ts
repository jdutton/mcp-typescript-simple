/**
 * Security validation middleware for defense-in-depth protection against common attacks.
 *
 * This middleware provides input validation to protect against:
 * - ReDoS (Regular Expression Denial of Service) via path-to-regexp
 * - Path traversal attacks
 * - Malformed requests
 *
 * These validations are applied BEFORE requests reach routing logic.
 */

import type { Request, Response, NextFunction } from 'express';

/**
 * Maximum allowed path length to prevent ReDoS attacks from excessively long paths
 * that could trigger catastrophic backtracking in regex engines.
 */
const MAX_PATH_LENGTH = 2048;

/**
 * Maximum allowed query string length to prevent DoS via large query strings
 */
const MAX_QUERY_LENGTH = 8192;

/**
 * Suspicious path patterns that indicate potential attacks
 */
const SUSPICIOUS_PATTERNS = {
  /** Multiple consecutive slashes (e.g., ///path) */
  repeatedSlashes: /\/{3,}/,
  /** Multiple consecutive dots (path traversal attempt) */
  repeatedDots: /\.{3,}/,
  /** Null bytes (path traversal/injection attempt) */
  nullBytes: /\0/,
  /** Encoded path traversal sequences */
  encodedTraversal: /%2e%2e|%252e|%c0%ae/i,
};

/**
 * Create security validation middleware for request input sanitization.
 *
 * This middleware performs early validation on incoming requests to reject
 * potentially malicious inputs before they reach application logic.
 *
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * app.use(createSecurityValidationMiddleware());
 * ```
 */
export function createSecurityValidationMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Defense 1: Path length limit (prevents ReDoS from catastrophic backtracking)
    if (req.path.length > MAX_PATH_LENGTH) {
      res.status(414).json({
        error: 'URI Too Long',
        message: `Path length exceeds maximum allowed (${MAX_PATH_LENGTH} characters)`,
      });
      return;
    }

    // Defense 2: Query string length limit
    const queryString = req.url.split('?')[1] || '';
    if (queryString.length > MAX_QUERY_LENGTH) {
      res.status(414).json({
        error: 'URI Too Long',
        message: `Query string length exceeds maximum allowed (${MAX_QUERY_LENGTH} characters)`,
      });
      return;
    }

    // Defense 3: Reject suspicious path patterns
    for (const [patternName, pattern] of Object.entries(SUSPICIOUS_PATTERNS)) {
      if (pattern.test(req.path) || pattern.test(queryString)) {
        res.status(400).json({
          error: 'Invalid Request',
          message: `Request contains suspicious pattern: ${patternName}`,
        });
        return;
      }
    }

    // All validations passed
    next();
  };
}
