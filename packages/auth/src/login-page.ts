/**
 * Shared OAuth provider selection login page
 * Used by both Express and Vercel serverless deployments
 */

export interface LoginPageOptions {
  availableProviders: string[];
  clientState?: string;
  clientRedirectUri?: string;
}

/**
 * Build provider URL with state and redirect URI query parameters
 */
function buildProviderUrl(provider: string, clientState?: string, clientRedirectUri?: string): string {
  const params = new URLSearchParams();
  if (clientState) {
    params.set('state', clientState);
  }
  if (clientRedirectUri) {
    params.set('redirect_uri', clientRedirectUri);
  }
  const queryString = params.toString();
  const queryPart = queryString ? `?${queryString}` : '';
  return `/auth/${provider}${queryPart}`;
}

/**
 * Generate branded OAuth provider selection page HTML
 */
export function generateLoginPageHTML(options: LoginPageOptions): string {
  const { availableProviders, clientState, clientRedirectUri } = options;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sign in to MCP Server</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Helvetica Neue', sans-serif;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      .login-container {
        background: white;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        max-width: 400px;
        width: 100%;
        padding: 40px;
      }
      h1 {
        font-size: 28px;
        font-weight: 600;
        color: #1a202c;
        margin-bottom: 12px;
        text-align: center;
      }
      .subtitle {
        color: #718096;
        text-align: center;
        margin-bottom: 32px;
        font-size: 14px;
      }
      .provider-buttons {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .provider-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 14px 24px;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        background: white;
        color: #2d3748;
        font-size: 16px;
        font-weight: 500;
        cursor: pointer;
        text-decoration: none;
        transition: all 0.2s;
        gap: 12px;
      }
      .provider-btn:hover {
        border-color: #667eea;
        background: #f7fafc;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
      }
      .provider-icon {
        width: 24px;
        height: 24px;
      }
      .google { border-color: #4285f4; }
      .google:hover { border-color: #4285f4; background: #f8fbff; }
      .github { border-color: #24292e; }
      .github:hover { border-color: #24292e; background: #f6f8fa; }
      .microsoft { border-color: #00a4ef; }
      .microsoft:hover { border-color: #00a4ef; background: #f0f9ff; }
      .footer {
        margin-top: 32px;
        text-align: center;
        color: #a0aec0;
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <div class="login-container">
      <h1>Sign in to MCP Server</h1>
      <p class="subtitle">Choose your authentication provider</p>
      <div class="provider-buttons">
        ${availableProviders.includes('google') ? `
          <a href="${buildProviderUrl('google', clientState, clientRedirectUri)}" class="provider-btn google">
            <svg class="provider-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </a>
        ` : ''}
        ${availableProviders.includes('github') ? `
          <a href="${buildProviderUrl('github', clientState, clientRedirectUri)}" class="provider-btn github">
            <svg class="provider-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path fill="#24292e" d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            Continue with GitHub
          </a>
        ` : ''}
        ${availableProviders.includes('microsoft') ? `
          <a href="${buildProviderUrl('microsoft', clientState, clientRedirectUri)}" class="provider-btn microsoft">
            <svg class="provider-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path fill="#f25022" d="M0 0h11.377v11.372H0z"/>
              <path fill="#00a4ef" d="M12.623 0H24v11.372H12.623z"/>
              <path fill="#7fba00" d="M0 12.628h11.377V24H0z"/>
              <path fill="#ffb900" d="M12.623 12.628H24V24H12.623z"/>
            </svg>
            Continue with Microsoft
          </a>
        ` : ''}
      </div>
      <div class="footer">
        Secure authentication via OAuth 2.0
      </div>
    </div>
  </body>
</html>`;
}
