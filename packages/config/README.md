# @mcp-typescript-simple/config

Extensible configuration management for MCP (Model Context Protocol) servers with Zod validation.

## Features

- **Type-Safe Configuration**: Full TypeScript support with Zod schema validation
- **Multi-Provider OAuth**: Support for Google, GitHub, Microsoft, and generic OAuth providers
- **LLM Integration**: Configuration for Claude, OpenAI, and Gemini providers
- **Storage Backend Selection**: Auto-detection for Memory, File, and Redis storage
- **Security-First**: Separate configuration and secrets schemas with validation
- **Extensible**: Optional logger integration for configuration diagnostics
- **Production-Ready**: Environment-based configuration with sensible defaults

## Installation

```bash
npm install @mcp-typescript-simple/config
```

## Basic Usage

```typescript
import { EnvironmentConfig, TransportMode } from '@mcp-typescript-simple/config';

// Load and validate environment configuration
const config = EnvironmentConfig.load();

// Check transport mode
const mode = EnvironmentConfig.getTransportMode();
if (mode === TransportMode.STREAMABLE_HTTP) {
  console.log('Running in HTTP mode');
}

// Check if running in production
if (EnvironmentConfig.isProduction()) {
  console.log('Production environment detected');
}

// Get server configuration
const serverConfig = EnvironmentConfig.getServerConfig();
console.log(`Server listening on ${serverConfig.host}:${serverConfig.port}`);
```

## Optional Logger Integration

```typescript
import { EnvironmentConfig } from '@mcp-typescript-simple/config';

// Set optional logger for configuration diagnostics
EnvironmentConfig.setLogger({
  debug: (message, data) => console.debug(message, data),
  info: (message, data) => console.info(message, data),
  warn: (message, data) => console.warn(message, data),
  error: (message, error) => console.error(message, error)
});

// Log configuration status (requires logger)
EnvironmentConfig.logConfiguration();
```

## Configuration Schema

### Base Configuration

- `MCP_MODE`: Transport mode (`stdio` | `streamable_http`)
- `MCP_DEV_SKIP_AUTH`: Skip authentication in development
- `HTTP_PORT`: HTTP server port (default: 3000)
- `HTTP_HOST`: HTTP server host (default: localhost)
- `NODE_ENV`: Environment (`development` | `production` | `test`)
- `REQUIRE_HTTPS`: Require HTTPS connections
- `ALLOWED_ORIGINS`: Comma-separated allowed CORS origins
- `ALLOWED_HOSTS`: Comma-separated allowed host headers

### OAuth Configuration

#### Google OAuth
- `GOOGLE_CLIENT_ID`: Google OAuth client ID (secret)
- `GOOGLE_CLIENT_SECRET`: Google OAuth client secret (secret)
- `GOOGLE_REDIRECT_URI`: Google OAuth redirect URI

#### GitHub OAuth
- `GITHUB_CLIENT_ID`: GitHub OAuth client ID (secret)
- `GITHUB_CLIENT_SECRET`: GitHub OAuth client secret (secret)
- `GITHUB_REDIRECT_URI`: GitHub OAuth redirect URI

#### Microsoft OAuth
- `MICROSOFT_CLIENT_ID`: Microsoft OAuth client ID (secret)
- `MICROSOFT_CLIENT_SECRET`: Microsoft OAuth client secret (secret)
- `MICROSOFT_REDIRECT_URI`: Microsoft OAuth redirect URI
- `MICROSOFT_TENANT_ID`: Microsoft tenant ID

#### Generic OAuth
- `OAUTH_CLIENT_ID`: Generic OAuth client ID (secret)
- `OAUTH_CLIENT_SECRET`: Generic OAuth client secret (secret)
- `OAUTH_REDIRECT_URI`: Generic OAuth redirect URI
- `OAUTH_AUTHORIZATION_URL`: Authorization endpoint URL
- `OAUTH_TOKEN_URL`: Token endpoint URL
- `OAUTH_USER_INFO_URL`: User info endpoint URL
- `OAUTH_REVOCATION_URL`: Token revocation endpoint URL
- `OAUTH_PROVIDER_NAME`: Provider display name
- `OAUTH_SCOPES`: OAuth scopes (comma-separated)

### LLM Provider Configuration

- `ANTHROPIC_API_KEY`: Anthropic/Claude API key (secret)
- `OPENAI_API_KEY`: OpenAI API key (secret)
- `GOOGLE_API_KEY`: Google/Gemini API key (secret)
- `LLM_DEFAULT_PROVIDER`: Default LLM provider (`claude` | `openai` | `gemini`)

### Storage Configuration

- `REDIS_URL`: Redis connection URL
- `STORAGE_TYPE`: Global storage type (`memory` | `file` | `redis`)
- `SESSION_STORE_TYPE`: Session storage override
- `TOKEN_STORE_TYPE`: Token storage override
- `CLIENT_STORE_TYPE`: Client storage override (DCR)
- `PKCE_STORE_TYPE`: PKCE storage override
- `MCP_METADATA_STORE_TYPE`: MCP metadata storage override

## API Reference

### EnvironmentConfig

#### Static Methods

- `load()`: Load and validate environment configuration
- `get()`: Get current environment configuration
- `getConfigurationStatus()`: Get configuration and secrets status
- `logConfiguration()`: Log configuration status (requires logger)
- `checkOAuthCredentials(provider)`: Check if OAuth provider is configured
- `checkLLMProviders()`: Get list of configured LLM providers
- `reset()`: Reset configuration (useful for testing)
- `isProduction()`: Check if running in production
- `isDevelopment()`: Check if running in development
- `getTransportMode()`: Get transport mode
- `shouldSkipAuth()`: Check if authentication should be skipped
- `getSecurityConfig()`: Get security configuration
- `getServerConfig()`: Get server configuration
- `setLogger(logger)`: Set optional logger

### Types

```typescript
export interface Configuration {
  // Base configuration (non-secret)
  MCP_MODE: 'stdio' | 'streamable_http';
  MCP_DEV_SKIP_AUTH: boolean;
  HTTP_PORT: number;
  HTTP_HOST: string;
  // ... (see schema above)
}

export interface Secrets {
  // Secret configuration (API keys, client secrets)
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  // ... (see schema above)
}

export interface Environment extends Configuration, Secrets {}

export interface ConfigurationStatus {
  configuration: Configuration;
  secrets: {
    configured: string[];
    missing: string[];
    total: number;
  };
}

export interface ConfigLogger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, error?: Error | unknown): void;
}
```

## License

MIT
