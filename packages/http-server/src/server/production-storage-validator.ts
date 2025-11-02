/**
 * Production Storage Validator
 *
 * Enforces Redis-only storage in production deployments to prevent data loss
 * and session inconsistencies across serverless instances.
 *
 * WHY THIS IS CRITICAL:
 * - Vercel serverless = multiple ephemeral instances
 * - File stores = each instance has separate filesystem (data inconsistency)
 * - Memory stores = data lost on cold start/restart (session loss)
 * - Only Redis = shared external storage that works across instances
 *
 * This validator FAILS FAST on startup if production is misconfigured,
 * preventing silent production bugs and mysterious user logouts.
 */

import { logger } from '@mcp-typescript-simple/observability';

/**
 * Check if environment is production
 */
function isProductionEnvironment(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL_ENV === 'production'
  );
}

/**
 * Validate that production deployments have Redis configured.
 *
 * FAILS FAST (process.exit(1)) if:
 * - NODE_ENV=production OR VERCEL_ENV=production
 * - AND REDIS_URL is not set
 *
 * Allows any storage backend in development/test environments.
 *
 * @throws Process exits with code 1 if validation fails
 *
 * @example
 * ```typescript
 * // In server startup:
 * validateProductionStorage(); // Fails fast if misconfigured
 * await startServer();
 * ```
 */
export function validateProductionStorage(): void {
  const isProduction = isProductionEnvironment();

  // Development/test: Any storage backend is fine
  if (!isProduction) {
    logger.debug('Storage validation: Development/test mode - any backend allowed', {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL_ENV: process.env.VERCEL_ENV,
    });
    return;
  }

  // Production: Redis is REQUIRED
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    // LOUD ERROR - multiple console.error calls for visibility
    console.error('');
    console.error('═══════════════════════════════════════════════════════════════');
    console.error('❌ PRODUCTION STORAGE MISCONFIGURATION - SERVER STARTUP FAILED');
    console.error('═══════════════════════════════════════════════════════════════');
    console.error('');
    console.error('Redis is REQUIRED for production deployments.');
    console.error('File-based and memory stores DO NOT WORK in serverless environments.');
    console.error('');
    console.error('WHY THIS MATTERS:');
    console.error('  • Vercel runs multiple server instances (horizontal scaling)');
    console.error('  • Each instance has a SEPARATE filesystem (not shared)');
    console.error('  • Instances are EPHEMERAL (restart on every cold start)');
    console.error('  • File stores → Data inconsistency between instances');
    console.error('  • Memory stores → Sessions lost on restart/cold start');
    console.error('  • Result: Users mysteriously logged out, data loss');
    console.error('');
    console.error('FIX: Set REDIS_URL environment variable');
    console.error('');
    console.error('Vercel Dashboard:');
    console.error('  1. Go to: Settings → Environment Variables');
    console.error('  2. Add: REDIS_URL = redis://default:YOUR_PASSWORD@hostname:port');
    console.error('  3. Redeploy');
    console.error('');
    console.error('Or via CLI:');
    console.error('  vercel env add REDIS_URL production');
    console.error('');
    console.error('Get Redis hosting:');
    console.error('  • Upstash: https://upstash.com/ (Vercel marketplace)');
    console.error('  • Redis Cloud: https://redis.com/cloud/');
    console.error('  • AWS ElastiCache: https://aws.amazon.com/elasticache/');
    console.error('');
    console.error('Current environment:');
    console.error(`  NODE_ENV: ${process.env.NODE_ENV || 'undefined'}`);
    console.error(`  VERCEL_ENV: ${process.env.VERCEL_ENV || 'undefined'}`);
    console.error(`  REDIS_URL: ${redisUrl ? 'SET' : '❌ NOT SET'}`);
    console.error('');
    console.error('═══════════════════════════════════════════════════════════════');
    console.error('');

    // Also log structured error for observability systems
    logger.error('Production storage validation failed - Redis required', {
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        VERCEL_ENV: process.env.VERCEL_ENV,
      },
      validation: {
        isProduction,
        hasRedis: false,
        required: 'REDIS_URL environment variable',
      },
      impact: 'Server startup blocked - deployment will fail health checks',
      remediation: 'Set REDIS_URL in Vercel environment variables',
    });

    // FAIL FAST - prevent server from starting
    process.exit(1);
  }

  // Production + Redis configured = SUCCESS
  logger.info('✅ Production storage validated: Redis configured', {
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL_ENV: process.env.VERCEL_ENV,
    },
    storage: {
      backend: 'redis',
      configured: true,
    },
  });
}

/**
 * Get current storage backend status for health checks
 *
 * @returns Storage backend information
 */
export function getStorageBackendStatus(): {
  environment: 'production' | 'development' | 'test';
  backend: 'redis' | 'file' | 'memory';
  redisConfigured: boolean;
  valid: boolean;
} {
  const isProduction = isProductionEnvironment();
  const hasRedis = Boolean(process.env.REDIS_URL);

  let environment: 'production' | 'development' | 'test';
  if (isProduction) {
    environment = 'production';
  } else if (process.env.NODE_ENV === 'test') {
    environment = 'test';
  } else {
    environment = 'development';
  }

  let backend: 'redis' | 'file' | 'memory';
  if (hasRedis) {
    backend = 'redis';
  } else if (environment === 'test') {
    backend = 'memory';
  } else {
    backend = 'file';
  }

  // Valid if: (production + redis) OR (not production)
  const valid = isProduction ? hasRedis : true;

  return {
    environment,
    backend,
    redisConfigured: hasRedis,
    valid,
  };
}
