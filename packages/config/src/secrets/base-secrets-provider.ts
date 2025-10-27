/**
 * Base Secrets Provider with OCSF Audit Events
 *
 * Abstract base class for secrets providers with built-in OCSF structured audit logging.
 * Eliminates code duplication and provides consistent security audit events.
 *
 * Features:
 * - OCSF API Activity events for all secret operations (read, create, update)
 * - Automatic trace correlation via OpenTelemetry
 * - Consistent caching logic with audit events
 * - Type-safe secret retrieval and storage
 */

import type { SecretsProvider, SecretsProviderOptions } from './secrets-provider.js';
import { getOCSFOTELBridge } from '@mcp-typescript-simple/observability/ocsf';
import {
  readAPIEvent,
  createAPIEvent,
  updateAPIEvent,
  SeverityId,
  StatusId,
  type APIActivityEvent,
} from '@mcp-typescript-simple/observability/ocsf';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Abstract base class for secrets providers with OCSF audit logging
 */
export abstract class BaseSecretsProvider implements SecretsProvider {
  protected readonly cache = new Map<string, CacheEntry<unknown>>();
  protected readonly cacheTtlMs: number;
  protected readonly auditLog: boolean;
  private readonly ocsfBridge = getOCSFOTELBridge('secrets-provider');

  /**
   * Provider name for identification (e.g., 'file', 'vault', 'vercel')
   */
  abstract readonly name: string;

  /**
   * Whether this provider is read-only
   */
  abstract readonly readOnly: boolean;

  constructor(options: SecretsProviderOptions = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? 300000; // 5 minutes default
    this.auditLog = options.auditLog ?? process.env.NODE_ENV === 'production';
  }

  /**
   * Retrieve a secret by key (with caching and audit logging)
   */
  async getSecret<T = string>(key: string): Promise<T | undefined> {
    const startTime = Date.now();

    try {
      // Check cache first
      if (this.cacheTtlMs > 0) {
        const cached = this.cache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
          this.emitSecretAccessEvent({
            key,
            operation: 'read',
            cached: true,
            success: true,
            duration: Date.now() - startTime,
          });
          return cached.value as T;
        }
      }

      // Retrieve from storage
      const value = await this.retrieveSecret<T>(key);

      if (value === undefined) {
        this.emitSecretAccessEvent({
          key,
          operation: 'read',
          cached: false,
          success: false,
          duration: Date.now() - startTime,
          statusDetail: 'Secret not found',
        });
        return undefined;
      }

      // Cache the value
      if (this.cacheTtlMs > 0) {
        this.cache.set(key, {
          value,
          expiresAt: Date.now() + this.cacheTtlMs,
        });
      }

      this.emitSecretAccessEvent({
        key,
        operation: 'read',
        cached: false,
        success: true,
        duration: Date.now() - startTime,
        valueType: typeof value,
      });

      return value;
    } catch (error) {
      this.emitSecretAccessEvent({
        key,
        operation: 'read',
        cached: false,
        success: false,
        duration: Date.now() - startTime,
        statusDetail: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Store a secret (with audit logging)
   */
  async setSecret<T = string>(key: string, value: T): Promise<void> {
    const startTime = Date.now();

    try {
      // Check if secret already exists to determine operation type
      const exists = await this.hasSecret(key);
      const operation = exists ? 'update' : 'create';

      // Store in provider-specific storage
      await this.storeSecret(key, value);

      // Update cache
      if (this.cacheTtlMs > 0) {
        this.cache.set(key, {
          value,
          expiresAt: Date.now() + this.cacheTtlMs,
        });
      }

      this.emitSecretAccessEvent({
        key,
        operation,
        cached: false,
        success: true,
        duration: Date.now() - startTime,
        valueType: typeof value,
      });
    } catch (error) {
      this.emitSecretAccessEvent({
        key,
        operation: 'create',
        cached: false,
        success: false,
        duration: Date.now() - startTime,
        statusDetail: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Check if a secret exists
   */
  abstract hasSecret(key: string): Promise<boolean>;

  /**
   * Dispose of resources
   */
  async dispose(): Promise<void> {
    this.cache.clear();

    if (this.auditLog) {
      this.emitProviderLifecycleEvent('dispose');
    }

    await this.disposeResources();
  }

  /**
   * Retrieve secret from provider-specific storage (to be implemented by subclasses)
   */
  protected abstract retrieveSecret<T = string>(key: string): Promise<T | undefined>;

  /**
   * Store secret in provider-specific storage (to be implemented by subclasses)
   */
  protected abstract storeSecret<T = string>(key: string, value: T): Promise<void>;

  /**
   * Dispose provider-specific resources (to be implemented by subclasses)
   */
  protected abstract disposeResources(): Promise<void>;

  /**
   * Emit provider initialization event (to be called by subclass constructors)
   */
  protected emitInitializationEvent(metadata: Record<string, unknown> = {}): void {
    if (!this.auditLog) {
      return;
    }

    try {
      const event = readAPIEvent()
        .actor({
          user: {
            name: 'system',
            uid: 'secrets-provider',
          },
        })
        .api({
          operation: 'initialize',
          service: {
            name: 'secrets-provider',
            version: '1.0.0',
          },
        })
        .resource({
          name: this.name,
          type: 'secrets-provider',
        })
        .message(`${this.name} secrets provider initialized`)
        .severity(SeverityId.Informational, 'Informational')
        .status(StatusId.Success)
        .unmapped(metadata)
        .build();

      this.ocsfBridge.emitAPIActivityEvent(event);
    } catch (error) {
      // Never throw from audit logging
      console.error('Failed to emit OCSF initialization event:', error);
    }
  }

  /**
   * Emit secret access event (read, create, update)
   */
  private emitSecretAccessEvent(params: {
    key: string;
    operation: 'read' | 'create' | 'update';
    cached: boolean;
    success: boolean;
    duration: number;
    valueType?: string;
    statusDetail?: string;
  }): void {
    if (!this.auditLog) {
      return;
    }

    try {
      const { key, operation, cached, success, duration, valueType, statusDetail } = params;

      // Select appropriate builder based on operation
      let builder;
      if (operation === 'read') {
        builder = readAPIEvent();
      } else if (operation === 'create') {
        builder = createAPIEvent();
      } else {
        builder = updateAPIEvent();
      }

      const event: APIActivityEvent = builder
        .actor({
          user: {
            name: 'system',
            uid: 'secrets-provider',
          },
        })
        .api({
          operation,
          service: {
            name: 'secrets-provider',
            version: '1.0.0',
          },
        })
        .resource({
          name: key,
          type: 'secret',
        })
        .message(
          `Secret ${operation} ${success ? 'succeeded' : 'failed'} for key: ${key}${
            cached ? ' (from cache)' : ''
          }`
        )
        .severity(
          success ? SeverityId.Informational : SeverityId.Medium,
          success ? 'Informational' : 'Warning'
        )
        .status(
          success ? StatusId.Success : StatusId.Failure,
          success ? 'SUCCESS' : 'FAILURE',
          statusDetail
        )
        .duration(duration)
        .unmapped({
          provider: this.name,
          cached,
          valueType,
        })
        .build();

      this.ocsfBridge.emitAPIActivityEvent(event);
    } catch (error) {
      // Never throw from audit logging
      console.error('Failed to emit OCSF access event:', error);
    }
  }

  /**
   * Emit provider lifecycle event (dispose)
   */
  private emitProviderLifecycleEvent(operation: 'dispose'): void {
    try {
      const event = readAPIEvent()
        .actor({
          user: {
            name: 'system',
            uid: 'secrets-provider',
          },
        })
        .api({
          operation,
          service: {
            name: 'secrets-provider',
            version: '1.0.0',
          },
        })
        .resource({
          name: this.name,
          type: 'secrets-provider',
        })
        .message(`${this.name} secrets provider ${operation}d`)
        .severity(SeverityId.Informational, 'Informational')
        .status(StatusId.Success)
        .build();

      this.ocsfBridge.emitAPIActivityEvent(event);
    } catch (error) {
      // Never throw from audit logging
      console.error('Failed to emit OCSF lifecycle event:', error);
    }
  }
}
