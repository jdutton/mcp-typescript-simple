import { jest } from '@jest/globals';
import { OAuthProviderFactory } from '../../../src/auth/factory.js';

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
    process.env = { ...originalEnv };
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
    process.env.OAUTH_PROVIDER = 'google';
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.GOOGLE_REDIRECT_URI = 'https://example.com/callback';

    const provider = await OAuthProviderFactory.createFromEnvironment();

    expect(provider).toMatchObject({ type: 'google' });
  });

  it('returns null when no OAuth provider is configured', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.OAUTH_PROVIDER;

    const provider = await OAuthProviderFactory.createFromEnvironment();

    expect(provider).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith('No OAuth provider configured. Set OAUTH_PROVIDER environment variable to enable OAuth authentication.');
  });

  it('returns null when provider type is unsupported', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.OAUTH_PROVIDER = 'unsupported';

    const provider = await OAuthProviderFactory.createFromEnvironment();

    expect(provider).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith('Unsupported OAuth provider: unsupported. Supported providers: google, github, microsoft');
  });

  it('returns null and logs an error when credentials are missing', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.OAUTH_PROVIDER = 'github';
    process.env.GITHUB_CLIENT_ID = '';
    process.env.GITHUB_CLIENT_SECRET = '';

    const provider = await OAuthProviderFactory.createFromEnvironment();

    expect(provider).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('disposes tracked providers via disposeAll', async () => {
    process.env.OAUTH_PROVIDER = 'google';
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.GOOGLE_REDIRECT_URI = 'https://example.com/callback';

    const provider = await OAuthProviderFactory.createFromEnvironment();
    expect(provider).toBeTruthy();

    const typedProvider = provider as unknown as { dispose: jest.Mock };
    expect(typedProvider.dispose).not.toHaveBeenCalled();

    OAuthProviderFactory.disposeAll();
    expect(typedProvider.dispose).toHaveBeenCalled();
  });
});
