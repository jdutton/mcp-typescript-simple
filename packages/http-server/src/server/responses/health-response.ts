/**
 * Shared health response builder for Express and Vercel deployments
 *
 * Provides consistent health check response structure across all deployment modes.
 */

import { getConfiguredOAuthProviders, getConfiguredLLMProviders } from './provider-utils.js';

export interface SessionStats {
  totalSessions: number;
  activeSessions: number;
  expiredSessions: number;
}

export interface HealthResponseOptions {
  deployment: 'local' | 'vercel';
  mode: string;
  sessionStats?: SessionStats;
  enableResumability?: boolean;
  enableJsonResponse?: boolean;
  region?: string;
  deploymentId?: string;
  deploymentUrl?: string;
  gitCommit?: string;
  gitBranch?: string;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  deployment: string;
  mode: string;
  auth: string;
  oauth_providers: string[];
  llm_providers: string[];
  version: string;
  node_version: string;
  environment: string;
  performance: {
    uptime_seconds: number;
    memory_usage: NodeJS.MemoryUsage;
    cpu_usage?: NodeJS.CpuUsage;
  };
  sessions?: SessionStats;
  features?: {
    resumability: boolean;
    jsonResponse: boolean;
  };
  region?: string;
  vercel_deployment_id?: string;
  vercel_deployment_url?: string | null;
  git_commit?: string;
  git_branch?: string;
  observability?: {
    logs_enabled: boolean;
    metrics_endpoint: string;
    health_endpoint: string;
    admin_endpoint: string;
  };
}

/**
 * Build a consistent health check response
 *
 * @param options - Health response configuration
 * @returns Standardized health response object
 */
export function buildHealthResponse(options: HealthResponseOptions): HealthResponse {
  const oauthProviders = getConfiguredOAuthProviders();
  const llmProviders = getConfiguredLLMProviders();

  const response: HealthResponse = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    deployment: options.deployment,
    mode: options.mode,
    auth: oauthProviders.length > 0 ? 'enabled' : 'disabled',
    oauth_providers: oauthProviders,
    llm_providers: llmProviders,
    version: process.env.npm_package_version || '1.0.0',
    node_version: process.version,
    environment: process.env.NODE_ENV || 'development',
    performance: {
      uptime_seconds: process.uptime(),
      memory_usage: process.memoryUsage(),
    },
  };

  // Add session stats if provided (Express deployment)
  if (options.sessionStats) {
    response.sessions = options.sessionStats;
  }

  // Add feature flags if provided (Express deployment)
  if (options.enableResumability !== undefined || options.enableJsonResponse !== undefined) {
    response.features = {
      resumability: options.enableResumability || false,
      jsonResponse: options.enableJsonResponse || false,
    };
  }

  // Add Vercel-specific fields if deployment is Vercel
  if (options.deployment === 'vercel') {
    response.performance.cpu_usage = process.cpuUsage();

    if (options.region) {
      response.region = options.region;
    }

    if (options.deploymentId) {
      response.vercel_deployment_id = options.deploymentId;
    }

    if (options.deploymentUrl !== undefined) {
      response.vercel_deployment_url = options.deploymentUrl;
    }

    if (options.gitCommit) {
      response.git_commit = options.gitCommit;
    }

    if (options.gitBranch) {
      response.git_branch = options.gitBranch;
    }

    response.observability = {
      logs_enabled: true,
      metrics_endpoint: '/admin/metrics',
      health_endpoint: '/health',
      admin_endpoint: '/admin',
    };
  }

  return response;
}
