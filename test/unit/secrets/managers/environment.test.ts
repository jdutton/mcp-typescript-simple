import { EnvironmentSecretManager } from '../../../../src/secrets/managers/environment.js';

describe('EnvironmentSecretManager', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns existing environment variables', async () => {
    process.env.TEST_SECRET = 'super-secret';
    const manager = new EnvironmentSecretManager();

    await expect(manager.getSecret('TEST_SECRET')).resolves.toBe('super-secret');
  });

  it('throws when environment variable is missing', async () => {
    const manager = new EnvironmentSecretManager();

    await expect(manager.getSecret('MISSING_SECRET')).rejects.toThrow('Environment variable MISSING_SECRET not found');
  });

  it('reports availability and name', async () => {
    const manager = new EnvironmentSecretManager();

    await expect(manager.isAvailable()).resolves.toBe(true);
    expect(manager.getName()).toBe('Environment');
  });
});
