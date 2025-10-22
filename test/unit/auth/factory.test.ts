import { vi } from 'vitest';

import { OAuthProviderFactory } from '@mcp-typescript-simple/auth';
import { logger } from '@mcp-typescript-simple/auth';
import { EnvironmentConfig } from '../../../src/config/environment.js';
import { preserveEnv } from '../../helpers/env-helper.js';

vi.mock('@mcp-typescript-simple/auth', async () => {
  const actual = await vi.importActual<typeof import('@mcp-typescript-simple/auth')>('@mcp-typescript-simple/auth');
  return {
    ...actual,
    GoogleOAuthProvider: vi.fn().mockImplementation((config) => ({
      type: 'google',
      config,
      dispose: vi.fn(),
      getProviderType: () => 'google',
      getProviderName: () => 'Google OAuth',
    })),
    GitHubOAuthProvider: vi.fn().mockImplementation((config) => ({
      type: 'github',
      config,
      dispose: vi.fn(),
      getProviderType: () => 'github',
      getProviderName: () => 'GitHub OAuth',
    })),
    MicrosoftOAuthProvider: vi.fn().mockImplementation((config) => ({
      type: 'microsoft',
      config,
      dispose: vi.fn(),
      getProviderType: () => 'microsoft',
      getProviderName: () => 'Microsoft OAuth',
    })),
  };
});

describe('OAuthProviderFactory', () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = preserveEnv();

    // CRITICAL: Clear EnvironmentConfig singleton cache to ensure tests don't inherit
    // cached env vars from previous tests. EnvironmentConfig.load() caches env vars in
    // a singleton _instance (src/config/environment.ts:102-104). Without this reset,
    // test 2 would see OAuth credentials cached from test 1 even after clearing process.env.
    EnvironmentConfig.reset();

    // Reset factory singleton instance after clearing env config
    OAuthProviderFactory.resetInstance();

    // Clear OAuth credentials from environment
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.GITHUB_REDIRECT_URI;
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_SECRET;
    delete process.env.MICROSOFT_REDIRECT_URI;
  });

  afterEach(() => {
    restoreEnv();
    vi.clearAllMocks();
    try {
      OAuthProviderFactory.disposeAll();
    } catch {
      // Swallow disposal errors in tests to avoid masking assertions; individual tests handle expectations.
    }
  });

  it('creates Google provider when credentials are present', async () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.GOOGLE_REDIRECT_URI = 'https://example.com/callback';

    const providers = await OAuthProviderFactory.createAllFromEnvironment();

    expect(providers).not.toBeNull();
    expect(providers?.has('google')).toBe(true);
    const googleProvider = providers?.get('google');
    expect(googleProvider?.getProviderType()).toBe('google');
  });

  it('returns null when no OAuth providers are configured', async () => {
    const warnSpy = vi.spyOn(logger, 'oauthWarn').mockImplementation(() => {});
    // No OAuth credentials set - beforeEach already cleared environment

    const providers = await OAuthProviderFactory.createAllFromEnvironment();

    expect(providers).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith('No OAuth providers configured. Set credentials for at least one provider (Google, GitHub, Microsoft, or Generic OAuth).');
  });

  it('creates multiple providers when multiple credentials are configured', async () => {
    process.env.GOOGLE_CLIENT_ID = 'google-id';
    process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
    process.env.GOOGLE_REDIRECT_URI = 'https://example.com/callback';
    process.env.GITHUB_CLIENT_ID = 'github-id';
    process.env.GITHUB_CLIENT_SECRET = 'github-secret';
    process.env.GITHUB_REDIRECT_URI = 'https://example.com/callback';

    const providers = await OAuthProviderFactory.createAllFromEnvironment();

    expect(providers).not.toBeNull();
    expect(providers?.size).toBe(2);
    expect(providers?.has('google')).toBe(true);
    expect(providers?.has('github')).toBe(true);
  });

  it('disposes tracked providers via disposeAll', async () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.GOOGLE_REDIRECT_URI = 'https://example.com/callback';

    const providers = await OAuthProviderFactory.createAllFromEnvironment();
    expect(providers).toBeTruthy();

    const provider = providers?.get('google');
    expect(provider).toBeTruthy();

    // Spy on the dispose method of the actual provider instance
    const disposeSpy = vi.spyOn(provider!, 'dispose');
    expect(disposeSpy).not.toHaveBeenCalled();

    OAuthProviderFactory.disposeAll();
    expect(disposeSpy).toHaveBeenCalled();
  });
});
