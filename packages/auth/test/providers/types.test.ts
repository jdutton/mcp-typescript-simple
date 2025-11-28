import {
  OAuthProviderType,
  OAuthUserInfo,
  _OAuthConfig,
  OAuthError,
  OAuthStateError,
  OAuthTokenError,
  OAuthProviderError,
  BaseOAuthConfig,
  GoogleOAuthConfig,
  GitHubOAuthConfig,
  MicrosoftOAuthConfig,
  GenericOAuthConfig,
  OAuthTokenResponse,
} from '@mcp-typescript-simple/auth';


 
describe('OAuth Types', () => {
  test('OAuthProviderType should be valid string literals', () => {
    const google: OAuthProviderType = 'google';
    const github: OAuthProviderType = 'github';
    const microsoft: OAuthProviderType = 'microsoft';
    const generic: OAuthProviderType = 'generic';

    expect(google).toBe('google');
    expect(github).toBe('github');
    expect(microsoft).toBe('microsoft');
    expect(generic).toBe('generic');
  });

  test('BaseOAuthConfig should have required properties', () => {
    const baseConfig: BaseOAuthConfig = {
      clientId: 'client123',
      clientSecret: 'secret123',
      redirectUri: 'https://example.com/callback',
      scopes: ['openid', 'profile', 'email'],
    };

    expect(baseConfig.clientId).toBe('client123');
    expect(baseConfig.clientSecret).toBe('secret123');
    expect(baseConfig.redirectUri).toBe('https://example.com/callback');
    expect(baseConfig.scopes).toEqual(['openid', 'profile', 'email']);
  });

  test('GoogleOAuthConfig should extend BaseOAuthConfig', () => {
    const googleConfig: GoogleOAuthConfig = {
      type: 'google',
      clientId: 'google-client-id',
      clientSecret: 'google-client-secret',
      redirectUri: 'https://app.com/auth/google/callback',
      scopes: ['openid', 'profile', 'email'],
    };

    expect(googleConfig.type).toBe('google');
    expect(googleConfig.clientId).toBe('google-client-id');
    expect(googleConfig.scopes).toEqual(['openid', 'profile', 'email']);
  });

  test('GitHubOAuthConfig should extend BaseOAuthConfig', () => {
    const githubConfig: GitHubOAuthConfig = {
      type: 'github',
      clientId: 'github-client-id',
      clientSecret: 'github-client-secret',
      redirectUri: 'https://app.com/auth/github/callback',
      scopes: ['user:email', 'read:user'],
    };

    expect(githubConfig.type).toBe('github');
    expect(githubConfig.scopes).toEqual(['user:email', 'read:user']);
  });

  test('MicrosoftOAuthConfig should have optional tenantId', () => {
    const microsoftConfig: MicrosoftOAuthConfig = {
      type: 'microsoft',
      clientId: 'ms-client-id',
      clientSecret: 'ms-client-secret',
      redirectUri: 'https://app.com/auth/microsoft/callback',
      scopes: ['openid', 'profile', 'email'],
      tenantId: 'common',
    };

    expect(microsoftConfig.type).toBe('microsoft');
    expect(microsoftConfig.tenantId).toBe('common');
  });

  test('GenericOAuthConfig should have additional URL properties', () => {
    const genericConfig: GenericOAuthConfig = {
      type: 'generic',
      clientId: 'generic-client-id',
      clientSecret: 'generic-client-secret',
      redirectUri: 'https://app.com/auth/generic/callback',
      scopes: ['read', 'write'],
      authorizationUrl: 'https://provider.com/oauth/authorize',
      tokenUrl: 'https://provider.com/oauth/token',
      userInfoUrl: 'https://provider.com/oauth/userinfo',
      providerName: 'Custom Provider',
      revocationUrl: 'https://provider.com/oauth/revoke',
    };

    expect(genericConfig.type).toBe('generic');
    expect(genericConfig.authorizationUrl).toBe('https://provider.com/oauth/authorize');
    expect(genericConfig.tokenUrl).toBe('https://provider.com/oauth/token');
    expect(genericConfig.userInfoUrl).toBe('https://provider.com/oauth/userinfo');
    expect(genericConfig.providerName).toBe('Custom Provider');
    expect(genericConfig.revocationUrl).toBe('https://provider.com/oauth/revoke');
  });

  test('OAuthUserInfo should have required properties', () => {
    const userInfo: OAuthUserInfo = {
      sub: '12345',
      email: 'user@example.com',
      name: 'Test User',
      picture: 'https://example.com/avatar.jpg',
      provider: 'google',
      providerData: { locale: 'en' },
    };

    expect(userInfo.sub).toBe('12345');
    expect(userInfo.email).toBe('user@example.com');
    expect(userInfo.name).toBe('Test User');
    expect(userInfo.picture).toBe('https://example.com/avatar.jpg');
    expect(userInfo.provider).toBe('google');
    expect(userInfo.providerData).toEqual({ locale: 'en' });
  });

  test('OAuthTokenResponse should have required properties', () => {
    const tokenResponse: OAuthTokenResponse = {
      access_token: 'access123',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'read write',
      refresh_token: 'refresh123',
      id_token: 'jwt.token.here',
      user: {
        sub: '12345',
        email: 'user@example.com',
        name: 'Test User',
        provider: 'google',
      },
    };

    expect(tokenResponse.access_token).toBe('access123');
    expect(tokenResponse.token_type).toBe('Bearer');
    expect(tokenResponse.expires_in).toBe(3600);
    expect(tokenResponse.user.sub).toBe('12345');
  });
});

describe('OAuth Error Classes', () => {
  test('OAuthError should be created with all properties', () => {
    const error = new OAuthError('Something went wrong', 'invalid_request', 'google', { extra: 'data' });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('OAuthError');
    expect(error.message).toBe('Something went wrong');
    expect(error.code).toBe('invalid_request');
    expect(error.provider).toBe('google');
    expect(error.details).toEqual({ extra: 'data' });
  });

  test('OAuthStateError should extend OAuthError', () => {
    const error = new OAuthStateError('Invalid state parameter', 'github');

    expect(error).toBeInstanceOf(OAuthError);
    expect(error.name).toBe('OAuthStateError');
    expect(error.code).toBe('invalid_state');
    expect(error.provider).toBe('github');
  });

  test('OAuthTokenError should extend OAuthError', () => {
    const error = new OAuthTokenError('Token exchange failed', 'microsoft', { httpStatus: 400 });

    expect(error).toBeInstanceOf(OAuthError);
    expect(error.name).toBe('OAuthTokenError');
    expect(error.code).toBe('token_error');
    expect(error.provider).toBe('microsoft');
    expect(error.details).toEqual({ httpStatus: 400 });
  });

  test('OAuthProviderError should extend OAuthError', () => {
    const error = new OAuthProviderError('Provider configuration error', 'generic');

    expect(error).toBeInstanceOf(OAuthError);
    expect(error.name).toBe('OAuthProviderError');
    expect(error.code).toBe('provider_error');
    expect(error.provider).toBe('generic');
  });
});