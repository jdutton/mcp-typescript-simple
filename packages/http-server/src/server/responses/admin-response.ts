/**
 * Shared admin response builders for Express and Vercel deployments
 *
 * Provides consistent admin endpoint response structure across all deployment modes.
 */

import { getConfiguredOAuthProviders, getConfiguredLLMProviders } from './provider-utils.js';

export interface SessionStats {
  totalSessions: number;
  activeSessions: number;
  expiredSessions: number;
}

export interface SessionInfo {
  sessionId: string;
  createdAt: string;
  expiresAt: string;
  hasAuth: boolean;
  metadata?: Record<string, unknown>;
}

export interface DeploymentInfo {
  platform: string;
  mode: string;
  version: string;
  node_version: string;
  region?: string;
  deployment_id?: string;
  deployment_url?: string;
  git_commit?: string;
  git_branch?: string;
  uptime?: number;
  memory_usage?: {
    heapUsed: number;
    heapTotal: number;
  };
}

export interface SessionsResponseOptions {
  deployment: 'local' | 'vercel';
  sessions: SessionInfo[];
  sessionStats: SessionStats;
  region?: string;
  deploymentId?: string;
  note?: string;
}

export interface SessionsResponse {
  sessions: SessionInfo[];
  stats: SessionStats;
  deployment: DeploymentInfo;
  environment?: {
    oauth_providers: string[];
    oauth_configured: boolean;
    llm_providers: string[];
  };
  note?: string;
}

export interface InfoResponseOptions {
  deployment: 'local' | 'vercel';
  region?: string;
  deploymentId?: string;
  deploymentUrl?: string;
  gitCommit?: string;
  gitBranch?: string;
  uptime?: number;
  memoryUsage?: NodeJS.MemoryUsage;
  cpuUsage?: NodeJS.CpuUsage;
}

export interface InfoResponse {
  platform: string;
  mode: string;
  version: string;
  node_version: string;
  oauth_providers: string[];
  oauth_configured: boolean;
  llm_providers: string[];
  region?: string;
  deployment_id?: string;
  deployment_url?: string;
  git_commit?: string;
  git_branch?: string;
  environment?: string;
  uptime?: number;
  memory_usage?: NodeJS.MemoryUsage;
  cpu_usage?: NodeJS.CpuUsage;
}

export interface MetricsResponseOptions {
  deployment: 'local' | 'vercel';
  sessionStats?: SessionStats;
  region?: string;
  deploymentId?: string;
  gitCommit?: string;
  gitBranch?: string;
}

export interface MetricsResponse {
  timestamp: string;
  platform: string;
  performance: {
    uptime_seconds: number;
    memory_usage: NodeJS.MemoryUsage;
    cpu_usage: NodeJS.CpuUsage;
  };
  deployment: {
    region: string;
    version: string;
    node_version: string;
    environment: string;
    deployment_id?: string;
    git_commit?: string;
    git_branch?: string;
  };
  configuration: {
    oauth_providers: string[];
    oauth_configured: boolean;
    llm_providers: string[];
    transport_mode: string;
  };
  sessions?: SessionStats;
  endpoints: {
    health: string;
    mcp: string;
    auth: string;
    admin: string;
  };
}

/**
 * Build sessions endpoint response
 */
export function buildSessionsResponse(options: SessionsResponseOptions): SessionsResponse {
  const oauthProviders = getConfiguredOAuthProviders();
  const llmProviders = getConfiguredLLMProviders();

  const deployment: DeploymentInfo = {
    platform: options.deployment === 'vercel' ? 'vercel' : 'vercel',
    mode: 'serverless',
    version: process.env.npm_package_version || '1.0.0',
    node_version: options.deployment === 'vercel'
      ? process.version.split('.')[0] // Major version only for Vercel
      : process.version,
  };

  if (options.deployment === 'vercel' && options.region) {
    deployment.region = options.region;
  }

  if (options.deployment === 'vercel' && options.deploymentId) {
    deployment.deployment_id = options.deploymentId;
    deployment.uptime = Math.floor(process.uptime());
    deployment.memory_usage = {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024), // MB
    };
  }

  const response: SessionsResponse = {
    sessions: options.sessions,
    stats: options.sessionStats,
    deployment,
    environment: {
      oauth_providers: oauthProviders,
      oauth_configured: oauthProviders.length > 0,
      llm_providers: llmProviders,
    },
  };

  if (options.note) {
    response.note = options.note;
  }

  return response;
}

/**
 * Build info endpoint response
 */
export function buildInfoResponse(options: InfoResponseOptions): InfoResponse {
  const oauthProviders = getConfiguredOAuthProviders();
  const llmProviders = getConfiguredLLMProviders();

  const response: InfoResponse = {
    platform: options.deployment === 'vercel' ? 'vercel' : 'vercel',
    mode: 'serverless',
    version: process.env.npm_package_version || '1.0.0',
    node_version: options.deployment === 'vercel'
      ? process.version.split('.')[0] // Major version only for Vercel
      : process.version,
    oauth_providers: oauthProviders,
    oauth_configured: oauthProviders.length > 0,
    llm_providers: llmProviders,
  };

  // Add Vercel-specific fields
  if (options.deployment === 'vercel') {
    if (options.region) response.region = options.region;
    if (options.deploymentId) response.deployment_id = options.deploymentId;
    if (options.deploymentUrl) response.deployment_url = options.deploymentUrl;
    if (options.gitCommit) response.git_commit = options.gitCommit;
    if (options.gitBranch) response.git_branch = options.gitBranch;
    if (options.uptime !== undefined) response.uptime = options.uptime;
    if (options.memoryUsage) response.memory_usage = options.memoryUsage;
    if (options.cpuUsage) response.cpu_usage = options.cpuUsage;
    response.environment = process.env.NODE_ENV || 'development';
  }

  return response;
}

/**
 * Build metrics endpoint response
 */
export function buildMetricsResponse(options: MetricsResponseOptions): MetricsResponse {
  const oauthProviders = getConfiguredOAuthProviders();
  const llmProviders = getConfiguredLLMProviders();

  const response: MetricsResponse = {
    timestamp: new Date().toISOString(),
    platform: options.deployment === 'vercel' ? 'vercel-serverless' : 'vercel-serverless',
    performance: {
      uptime_seconds: process.uptime(),
      memory_usage: process.memoryUsage(),
      cpu_usage: process.cpuUsage(),
    },
    deployment: {
      region: options.region || (options.deployment === 'local' ? 'local' : 'unknown'),
      version: process.env.npm_package_version || '1.0.0',
      node_version: process.version,
      environment: process.env.NODE_ENV || 'development',
    },
    configuration: {
      oauth_providers: oauthProviders,
      oauth_configured: oauthProviders.length > 0,
      llm_providers: llmProviders,
      transport_mode: 'streamable_http',
    },
    endpoints: {
      health: '/health',
      mcp: '/mcp',
      auth: '/auth',
      admin: '/admin',
    },
  };

  // Add Vercel-specific deployment fields
  if (options.deployment === 'vercel') {
    if (options.deploymentId) {
      response.deployment.deployment_id = options.deploymentId;
    }
    if (options.gitCommit) {
      response.deployment.git_commit = options.gitCommit;
    }
    if (options.gitBranch) {
      response.deployment.git_branch = options.gitBranch;
    }
  }

  // Add session stats if provided
  if (options.sessionStats) {
    response.sessions = options.sessionStats;
  }

  return response;
}
