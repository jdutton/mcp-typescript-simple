import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileSecretManager } from '../../../../src/secrets/managers/file.js';

describe('FileSecretManager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'file-secret-manager-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  const createEnvFile = (fileName: string, contents: string) => {
    const filePath = join(tempDir, fileName);
    writeFileSync(filePath, contents);
    return filePath;
  };

  it('loads secrets from an env file and trims quotes', async () => {
    const envPath = createEnvFile('.env.local', `# comment\nAPI_KEY=abc123\nQUOTED="quoted value"\nMULTI=value=with=equals\n`);
    const manager = new FileSecretManager(envPath);

    await expect(manager.getSecret('API_KEY')).resolves.toBe('abc123');
    await expect(manager.getSecret('QUOTED')).resolves.toBe('quoted value');
    await expect(manager.getSecret('MULTI')).resolves.toBe('value=with=equals');
  });

  it('throws when secret is missing', async () => {
    const envPath = createEnvFile('.env', 'API_KEY=abc123');
    const manager = new FileSecretManager(envPath);

    await expect(manager.getSecret('MISSING')).rejects.toThrow(`Secret MISSING not found in ${envPath}`);
  });

  it('caches parsed secrets after first load', async () => {
    const envPath = createEnvFile('.env.caching', 'TOKEN=test-token');
    const manager = new FileSecretManager(envPath);

    await expect(manager.getSecret('TOKEN')).resolves.toBe('test-token');
    writeFileSync(envPath, 'TOKEN=changed');
    await expect(manager.getSecret('TOKEN')).resolves.toBe('test-token');
    expect(manager['loaded']).toBe(true);
  });

  it('exposes availability based on file existence', async () => {
    const existingEnv = createEnvFile('.env.available', 'VALUE=1');
    const existingManager = new FileSecretManager(existingEnv);
    const missingManager = new FileSecretManager(join(tempDir, 'missing.env'));

    await expect(existingManager.isAvailable()).resolves.toBe(true);
    await expect(missingManager.isAvailable()).resolves.toBe(false);
  });

  it('wraps file load errors with descriptive message', async () => {
    const missingPath = join(tempDir, 'missing.env');
    const manager = new FileSecretManager(missingPath);

    await expect(manager.getSecret('ANY')).rejects.toThrow(`Failed to load ${missingPath}`);
  });
});
