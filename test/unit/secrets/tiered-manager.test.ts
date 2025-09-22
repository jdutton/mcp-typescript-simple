import { jest } from '@jest/globals';
import { TieredSecretManager } from '../../../src/secrets/tiered-manager.js';
import { SecretNotFoundError, SecretTimeoutError } from '../../../src/secrets/types.js';
import type { SecretManager } from '../../../src/secrets/types.js';

const createMockProvider = (name: string, overrides: Partial<SecretManager> = {}): SecretManager => ({
  getSecret: jest.fn<SecretManager['getSecret']>().mockResolvedValue(name),
  isAvailable: jest.fn<SecretManager['isAvailable']>().mockResolvedValue(true),
  getName: () => name,
  ...overrides
});

describe('TieredSecretManager', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns cached value on subsequent lookups when cache is enabled', async () => {
    const provider = createMockProvider('env', {
      getSecret: jest.fn<SecretManager['getSecret']>().mockResolvedValue('value')
    });

    const manager = new TieredSecretManager({ cacheEnabled: true, cacheTtl: 60_000 });
    (manager as unknown as { providers: SecretManager[] }).providers = [provider];

    const first = await manager.getSecret('KEY');
    expect(first).toBe('value');
    expect(provider.getSecret).toHaveBeenCalledTimes(1);

    const second = await manager.getSecret('KEY');
    expect(second).toBe('value');
    expect(provider.getSecret).toHaveBeenCalledTimes(1);
  });

  it('falls back to the next provider when the first fails and caches result', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const failingProvider = createMockProvider('env', {
      getSecret: jest.fn<SecretManager['getSecret']>().mockRejectedValue(new Error('failure'))
    });
    const fallbackProvider = createMockProvider('file', {
      getSecret: jest.fn<SecretManager['getSecret']>().mockResolvedValue('fallback')
    });

    const manager = new TieredSecretManager({ cacheEnabled: true });
    (manager as unknown as { providers: SecretManager[] }).providers = [failingProvider, fallbackProvider];

    const value = await manager.getSecret('KEY');
    expect(value).toBe('fallback');
    expect(failingProvider.getSecret).toHaveBeenCalledTimes(1);
    expect(fallbackProvider.getSecret).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();

    const cached = await manager.getSecret('KEY');
    expect(cached).toBe('fallback');
    expect(failingProvider.getSecret).toHaveBeenCalledTimes(1);
    expect(fallbackProvider.getSecret).toHaveBeenCalledTimes(1);
  });

  it('throws SecretNotFoundError when no providers are available', async () => {
    const unavailableProvider = createMockProvider('env', {
      isAvailable: jest.fn<SecretManager['isAvailable']>().mockResolvedValue(false)
    });

    const manager = new TieredSecretManager({ cacheEnabled: false });
    (manager as unknown as { providers: SecretManager[] }).providers = [unavailableProvider];

    await expect(manager.getSecret('KEY')).rejects.toThrow(SecretNotFoundError);
  });

  it('treats per-provider timeouts as failures and reports missing secret', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const timeoutProvider = createMockProvider('env', {
      getSecret: jest.fn<SecretManager['getSecret']>().mockRejectedValue(new SecretTimeoutError('KEY', 'env', 5))
    });

    const manager = new TieredSecretManager({ cacheEnabled: false, timeout: 5 });
    (manager as unknown as { providers: SecretManager[] }).providers = [timeoutProvider];

    await expect(manager.getSecret('KEY')).rejects.toThrow(SecretNotFoundError);
    expect(timeoutProvider.getSecret).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('throws when configured providers are unknown', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(
      () => new TieredSecretManager({ providers: ['unknown'], cacheEnabled: false })
    ).toThrow('No valid secret providers configured');

    expect(warnSpy).toHaveBeenCalledWith('Unknown secret provider(s): unknown');
  });
});
