/**
 * System test utilities and helpers
 */

import axios, { AxiosInstance, AxiosResponse } from 'axios';

// Re-export types for use in other test files
export type { AxiosInstance, AxiosResponse };

export interface TestEnvironment {
  name: string;
  baseUrl: string;
  description: string;
}

export const TEST_ENVIRONMENTS: Record<string, TestEnvironment> = {
  express: {
    name: 'express',
    baseUrl: 'http://localhost:3000',
    description: 'Express HTTP server (npm run dev:http)'
  },
  'express:ci': {
    name: 'express:ci',
    baseUrl: `http://localhost:${process.env.HTTP_TEST_PORT || '3001'}`,
    description: 'Express HTTP server for CI testing (npm run dev:http:ci)'
  },
  stdio: {
    name: 'stdio',
    baseUrl: 'stdio://localhost',
    description: 'STDIO transport mode (npm run dev:stdio)'
  },
  'vercel:local': {
    name: 'vercel:local',
    baseUrl: 'http://localhost:3000',
    description: 'Local Vercel dev server (npm run dev:vercel)'
  },
  'vercel:preview': {
    name: 'vercel:preview',
    baseUrl: process.env.VERCEL_PREVIEW_URL || 'https://mcp-typescript-simple-preview.vercel.app',
    description: 'Vercel preview deployment'
  },
  'vercel:production': {
    name: 'vercel:production',
    baseUrl: process.env.VERCEL_PRODUCTION_URL || 'https://mcp-typescript-simple.vercel.app',
    description: 'Vercel production deployment'
  },
  docker: {
    name: 'docker',
    baseUrl: 'http://localhost:3000',
    description: 'Docker container (docker run with exposed port)'
  }
};

export function getCurrentEnvironment(): TestEnvironment {
  const envName = process.env.TEST_ENV || 'vercel:local';
  const environment = TEST_ENVIRONMENTS[envName];

  if (!environment) {
    throw new Error(`Unknown test environment: ${envName}. Available: ${Object.keys(TEST_ENVIRONMENTS).join(', ')}`);
  }

  // Allow override of base URL for testing (useful for Docker with different port)
  if (process.env.TEST_BASE_URL) {
    return {
      ...environment,
      baseUrl: process.env.TEST_BASE_URL
    };
  }

  return environment;
}

export function createHttpClient(): AxiosInstance {
  const environment = getCurrentEnvironment();

  // For CI environment, simulate cross-origin requests by setting Origin header
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add Origin header for CI testing to trigger CORS
  if (environment.name === 'express:ci') {
    headers['Origin'] = 'http://localhost:3000'; // Simulate request from port 3000 to 3001
  }

  const client = axios.create({
    baseURL: environment.baseUrl,
    timeout: 10000,
    headers,
    // Don't throw on HTTP error status codes - let tests handle them
    validateStatus: () => true,
  });

  // Request interceptor for logging
  client.interceptors.request.use((config) => {
    console.log(`🔄 ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);
    return config;
  });

  // Response interceptor for logging
  client.interceptors.response.use((response) => {
    const status = response.status;
    let emoji = '⚠️'; // 3xx or unexpected
    if (status >= 200 && status < 300) {
      emoji = '✅'; // Success
    } else if (status >= 400) {
      emoji = '❌'; // Error
    }
    console.log(`${emoji} ${status} ${response.config.method?.toUpperCase()} ${response.config.url}`);
    return response;
  });

  return client;
}

export async function waitForServer(client: AxiosInstance, maxAttempts = 10, delayMs = 1000): Promise<boolean> {
  const environment = getCurrentEnvironment();
  console.log(`⏳ Waiting for server at ${environment.baseUrl}...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await client.get('/health');
      if (response.status === 200) {
        console.log(`✅ Server is ready at ${environment.baseUrl}`);
        return true;
      }
    } catch {
      console.log(`⏳ Attempt ${attempt}/${maxAttempts} failed, retrying in ${delayMs}ms...`);
    }

    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  console.log(`❌ Server not ready after ${maxAttempts} attempts`);
  return false;
}

export interface HealthCheckResponse {
  status: string;
  timestamp: string;
  deployment?: string;
  mode?: string;
  auth?: string;
  oauth_provider?: string;
  llm_providers?: string[];
  version?: string;
  node_version?: string;
  region?: string;
  vercel_deployment_id?: string;
  performance?: {
    uptime_seconds: number;
    memory_usage: any;
    cpu_usage?: any;
  };
}

export function validateHealthResponse(response: AxiosResponse): HealthCheckResponse {
  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/application\/json/);

  const health = response.data as HealthCheckResponse;
  expect(health.status).toBe('healthy');
  expect(health.timestamp).toBeDefined();
  expect(new Date(health.timestamp).getTime()).toBeGreaterThan(0);

  return health;
}

export function expectValidApiResponse(response: AxiosResponse, expectedStatus = 200) {
  expect(response.status).toBe(expectedStatus);
  expect(response.headers['content-type']).toMatch(/application\/json/);
  expect(response.data).toBeDefined();
}

export function expectErrorResponse(response: AxiosResponse, expectedStatus: number) {
  expect(response.status).toBe(expectedStatus);

  // Check if response is JSON (some servers return HTML for errors)
  const contentType = response.headers['content-type'] || '';
  if (contentType.includes('application/json')) {
    expect(response.data.error).toBeDefined();
  } else {
    // For non-JSON responses (like Express 404 HTML), just verify status
    console.log(`ℹ️  Expected non-JSON error: ${contentType} (Express returns HTML for unmatched routes)`);
  }
}

export async function testEndpointExists(client: AxiosInstance, path: string): Promise<AxiosResponse> {
  const response = await client.get(path);
  expect(response.status).not.toBe(404);
  return response;
}

export function describeSystemTest(testName: string, testFn: () => void) {
  const environment = getCurrentEnvironment();
  describe(`${testName} (${environment.name})`, () => {
    console.log(`📋 Testing: ${testName} on ${environment.description}`);
    testFn();
  });
}

export interface ServerCapabilities {
  hasAuth: boolean;
  hasLLM: boolean;
  oauthProvider?: string;
  endpoints: Record<string, string>;
  llmProviders: string[];
}

export async function detectServerCapabilities(client: AxiosInstance): Promise<ServerCapabilities> {
  try {
    const health = await client.get('/health');
    const healthData = health.data as HealthCheckResponse;

    const capabilities: ServerCapabilities = {
      hasAuth: healthData.auth === 'enabled',
      hasLLM: Array.isArray(healthData.llm_providers) && healthData.llm_providers.length > 0,
      oauthProvider: healthData.oauth_provider,
      endpoints: {},
      llmProviders: healthData.llm_providers || []
    };

    // If server provides endpoint information, use it
    if ((healthData as any).endpoints) {
      capabilities.endpoints = (healthData as any).endpoints;
    } else {
      // Discover endpoints dynamically
      capabilities.endpoints = await discoverEndpoints(client);
    }

    return capabilities;
  } catch (error) {
    console.warn('⚠️  Failed to detect server capabilities:', error);
    return {
      hasAuth: false,
      hasLLM: false,
      endpoints: {},
      llmProviders: []
    };
  }
}

async function discoverEndpoints(client: AxiosInstance): Promise<Record<string, string>> {
  const endpoints: Record<string, string> = {};

  // Always available endpoints
  endpoints.health = '/health';
  endpoints.mcp = '/mcp';

  // Try to find auth endpoints
  const authCandidates = ['/auth', '/api/auth'];
  for (const candidate of authCandidates) {
    const response = await tryGet(client, candidate);
    if (response && response.status < 400) {
      endpoints.auth = candidate;
      break;
    }
  }

  return endpoints;
}

async function tryGet(client: AxiosInstance, path: string): Promise<AxiosResponse | null> {
  try {
    return await client.get(path);
  } catch {
    return null;
  }
}

export async function discoverOAuthEndpoints(client: AxiosInstance, oauthProvider: string, baseAuthPath: string): Promise<Record<string, string>> {
  const endpoints: Record<string, string> = {};

  if (!oauthProvider || !baseAuthPath) {
    return endpoints;
  }

  // Try provider-specific endpoints
  const basePath = `${baseAuthPath}/${oauthProvider}`;

  const candidates = [
    { key: 'oauth_login', path: basePath },
    { key: 'oauth_logout', path: `${basePath}/logout` },
    { key: 'oauth_callback', path: `${basePath}/callback` },
    { key: 'oauth_refresh', path: `${basePath}/refresh` }
  ];

  for (const candidate of candidates) {
    // Use OPTIONS to check if endpoint exists without triggering redirects
    const response = await tryOptions(client, candidate.path);
    if (response && response.status < 400) {
      endpoints[candidate.key] = candidate.path;
    }
  }

  return endpoints;
}

async function tryOptions(client: AxiosInstance, path: string): Promise<AxiosResponse | null> {
  try {
    return await client.options(path);
  } catch {
    return null;
  }
}

export function conditionalDescribe(condition: boolean, name: string, fn: () => void) {
  if (condition) {
    describe(name, fn);
  } else {
    describe.skip(`${name} (skipped - condition not met)`, fn);
  }
}

export function isLocalEnvironment(environment: TestEnvironment): boolean {
  return environment.name === 'express' ||
         environment.name === 'express:ci' ||
         environment.name === 'stdio' ||
         environment.name === 'vercel:local' ||
         environment.name === 'docker';
}

export function isProductionEnvironment(environment: TestEnvironment): boolean {
  return environment.name === 'vercel:production';
}

export function isVercelEnvironment(environment: TestEnvironment): boolean {
  return environment.name.startsWith('vercel:');
}

export function isSTDIOEnvironment(environment: TestEnvironment): boolean {
  return environment.name === 'stdio';
}

export function isHTTPEnvironment(environment: TestEnvironment): boolean {
  return !isSTDIOEnvironment(environment);
}

/**
 * Determine if CORS headers are expected based on the test environment.
 * CORS headers are needed when:
 * 1. The request is cross-origin (different ports/domains)
 * 2. An Origin header is present in the request
 *
 * For same-origin requests (same protocol, host, and port), CORS headers are not needed.
 */
export function expectsCorsHeaders(environment: TestEnvironment): boolean {
  // Extract port from baseUrl
  const url = new URL(environment.baseUrl);
  const serverPort = url.port || (url.protocol === 'https:' ? '443' : '80');

  // For CI environment, we simulate cross-origin by adding Origin header from port 3000
  if (environment.name === 'express:ci') {
    // Server is on test port, client simulates origin from 3000 = cross-origin
    const testPort = process.env.HTTP_TEST_PORT || '3001';
    return serverPort === testPort;
  }

  // For production/preview Vercel deployments, expect CORS headers
  if (environment.name === 'vercel:preview' || environment.name === 'vercel:production') {
    return true;
  }

  // For local environments on same port (3000), it's same-origin, no CORS needed
  if (environment.name === 'express' || environment.name === 'vercel:local') {
    return false; // Same origin (localhost:3000 → localhost:3000)
  }

  // For Docker, depends on the actual port configuration
  if (environment.name === 'docker') {
    return false; // Typically same-origin unless configured otherwise
  }

  return false;
}