/**
 * Project configuration collected from user prompts
 */
export interface ProjectConfig {
  /** Project name (kebab-case, follows npm naming rules) */
  name: string;

  /** Project description */
  description: string;

  /** Author name */
  author: string;

  /** Display name for MCP server */
  mcpServerName: string;

  /** Base HTTP port (tests will use basePort+1, basePort+2) */
  basePort: number;
}

/**
 * CLI command options
 */
export interface CliOptions {
  /** Skip prompts and use defaults */
  yes?: boolean;
}

/**
 * Template data for Handlebars rendering
 */
export interface TemplateData extends ProjectConfig {
  /** Generated encryption key for .env files */
  tokenEncryptionKey: string;

  /** Current date (for generated files) */
  currentDate: string;

  /** Framework version */
  frameworkVersion: string;

  /** Nginx load balancer port (derived from basePort to avoid conflicts) */
  nginxPort: number;

  /** Redis port (derived from basePort to avoid conflicts) */
  redisPort: number;

  /** Grafana UI port (derived from basePort to avoid conflicts) */
  grafanaPort: number;

  /** Loki log aggregation port (derived from basePort to avoid conflicts) */
  lokiPort: number;

  /** OTLP gRPC port (derived from basePort to avoid conflicts) */
  otlpGrpcPort: number;

  /** OTLP HTTP port (derived from basePort to avoid conflicts) */
  otlpHttpPort: number;

  /** Prometheus metrics port (derived from basePort to avoid conflicts) */
  prometheusPort: number;
}

/**
 * File to copy with optional templating
 */
export interface TemplateFile {
  /** Source path (relative to source directory) */
  source: string;

  /** Destination path (relative to project root) */
  destination: string;

  /** Is this a Handlebars template file? */
  isTemplate: boolean;
}
