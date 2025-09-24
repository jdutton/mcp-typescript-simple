/**
 * System test utilities and helpers
 */

import axios, { AxiosInstance, AxiosResponse } from 'axios';

export interface TestEnvironment {
  name: string;
  baseUrl: string;
  description: string;
}

export const TEST_ENVIRONMENTS: Record<string, TestEnvironment> = {
  local: {
    name: 'local',
    baseUrl: 'http://localhost:3000',
    description: 'Local production server (npm start)'
  },
  docker: {
    name: 'docker',
    baseUrl: 'http://localhost:3000',
    description: 'Docker container (docker run with exposed port)'
  },
  preview: {
    name: 'preview',
    baseUrl: process.env.VERCEL_PREVIEW_URL || 'https://mcp-typescript-simple-preview.vercel.app',
    description: 'Vercel preview deployment'
  },
  production: {
    name: 'production',
    baseUrl: process.env.VERCEL_PRODUCTION_URL || 'https://mcp-typescript-simple.vercel.app',
    description: 'Vercel production deployment'
  }
};

export function getCurrentEnvironment(): TestEnvironment {
  const envName = process.env.TEST_ENV || 'local';
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

  const client = axios.create({
    baseURL: environment.baseUrl,
    timeout: 10000,
    headers: {
      'Content-Type': 'application/json',
    },
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
    const emoji = status >= 200 && status < 300 ? '✅' : status >= 400 ? '❌' : '⚠️';
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
    } catch (error) {
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
  expect(response.headers['content-type']).toMatch(/application\/json/);
  expect(response.data.error).toBeDefined();
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