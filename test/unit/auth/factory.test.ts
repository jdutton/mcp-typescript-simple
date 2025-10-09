import { jest } from '@jest/globals';
import { OAuthProviderFactory } from '../../../src/auth/factory.js';
import { logger } from '../../../src/utils/logger.js';
import { EnvironmentConfig } from '../../../src/config/environment.js';

const originalEnv = process.env;

jest.mock('../../../src/auth/providers/google-provider.js', () => ({
  GoogleOAuthProvider: jest.fn().mockImplementation((config) => ({ type: 'google', config, dispose: jest.fn() }))
}));

jest.mock('../../../src/auth/providers/github-provider.js', () => ({
  GitHubOAuthProvider: jest.fn().mockImplementation((config) => ({ type: 'github', config, dispose: jest.fn() }))
}));

jest.mock('../../../src/auth/providers/microsoft-provider.js', () => ({
  MicrosoftOAuthProvider: jest.fn().mockImplementation((config) => ({ type: 'microsoft', config, dispose: jest.fn() }))
}));

describe('OAuthProviderFactory', () => {
  beforeEach(() => {
    // CRITICAL: Clear EnvironmentConfig singleton cache to ensure tests don't inherit
    // cached env vars from previous tests. EnvironmentConfig.load() caches env vars in
    // a singleton _instance (src/config/environment.ts:102-104). Without this reset,
    // test 2 would see OAuth credentials cached from test 1 even after clearing process.env.
    EnvironmentConfig.reset();

    // Reset factory singleton instance after clearing env config
    OAuthProviderFactory.resetInstance();

    // Create clean environment without OAuth credentials
    // Don't use originalEnv as it may contain credentials from actual environment
    process.env = {
      NODE_ENV: 'test',
      // Keep only essential non-OAuth vars
      PATH: originalEnv.PATH || '',
      HOME: originalEnv.HOME || '',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
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
    expect(providers?.get('google')).toMatchObject({ type: 'google' });
  });

  it('returns null when no OAuth providers are configured', async () => {
    const warnSpy = jest.spyOn(logger, 'oauthWarn').mockImplementation(() => {});
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
    const typedProvider = provider as unknown as { dispose: jest.Mock };
    expect(typedProvider.dispose).not.toHaveBeenCalled();

    OAuthProviderFactory.disposeAll();
    expect(typedProvider.dispose).toHaveBeenCalled();
  });
});
