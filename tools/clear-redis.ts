#!/usr/bin/env tsx
/**
 * Clear Vercel Redis cache
 *
 * Usage: REDIS_URL=<redis-url> tsx tools/clear-redis.ts
 */

import Redis from 'ioredis';

async function clearRedis() {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    console.error('❌ Error: REDIS_URL environment variable not set');
    console.log('Usage: REDIS_URL=<redis-url> tsx tools/clear-redis.ts');
    process.exit(1);
  }

  console.log('🔗 Connecting to Redis...');
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    }
  });

  try {
    // Test connection
    await redis.ping();
    console.log('✅ Connected to Redis');

    // Get all keys to show what will be deleted
    const keys = await redis.keys('*');
    console.log(`📊 Found ${keys.length} keys in Redis:`);

    if (keys.length > 0) {
      // Group keys by prefix
      const keyGroups: Record<string, number> = {};
      for (const key of keys) {
        const prefix = key.split(':')[0];
        keyGroups[prefix] = (keyGroups[prefix] || 0) + 1;
      }

      for (const [prefix, count] of Object.entries(keyGroups)) {
        console.log(`  - ${prefix}:* (${count} keys)`);
      }

      // Flush all keys
      console.log('\n🗑️  Flushing Redis database...');
      await redis.flushdb();
      console.log('✅ Redis cache cleared successfully');
    } else {
      console.log('ℹ️  Redis database is already empty');
    }

    // Verify
    const remainingKeys = await redis.keys('*');
    console.log(`\n✅ Final state: ${remainingKeys.length} keys remaining`);

  } catch (error) {
    console.error('❌ Error clearing Redis:', error);
    process.exit(1);
  } finally {
    await redis.quit();
    console.log('👋 Disconnected from Redis');
  }
}

clearRedis().catch(console.error);
