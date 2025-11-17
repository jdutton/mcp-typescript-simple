import path from 'node:path';
import chalk from 'chalk';
import type { ProjectConfig, TemplateData, TemplateFile } from './types.js';
import { ensureDir, isDirNonEmpty, processTemplateFiles } from './utils/files.js';
import { getDependencies, getDevDependencies, getScripts, FRAMEWORK_VERSION } from './utils/dependencies.js';
import { generateEncryptionKey } from './utils/encryption.js';
import fs from 'fs-extra';

/**
 * Define which template files to generate based on configuration
 *
 * Full-featured by default: Copies example-mcp structure directly with minimal templating
 */
function getTemplateFiles(_config: ProjectConfig): TemplateFile[] {
  return [
    // Root config files (templates for name/description substitution)
    { source: 'package.json.hbs', destination: 'package.json', isTemplate: true },
    { source: 'tsconfig.json', destination: 'tsconfig.json', isTemplate: false },
    { source: 'gitignore', destination: '.gitignore', isTemplate: false },
    { source: 'eslint.config.js', destination: 'eslint.config.js', isTemplate: false },
    { source: 'README.md.hbs', destination: 'README.md', isTemplate: true },
    { source: 'CLAUDE.md.hbs', destination: 'CLAUDE.md', isTemplate: true },
    { source: 'vibe-validate.config.yaml.hbs', destination: 'vibe-validate.config.yaml', isTemplate: true },

    // Environment files
    // Example files (with placeholder keys - for reference only)
    { source: 'env.example.hbs', destination: '.env.example', isTemplate: true },
    { source: 'env.oauth.example.hbs', destination: '.env.oauth.example', isTemplate: true },
    { source: 'env.local.example', destination: '.env.local.example', isTemplate: false },

    // Actual files (with real encryption keys - ready to use)
    { source: 'env.oauth.hbs', destination: '.env.oauth', isTemplate: true },
    { source: 'env.local.hbs', destination: '.env.local', isTemplate: true },

    // Source files (copy from example-mcp, no templating)
    { source: 'src/index.ts', destination: 'src/index.ts', isTemplate: false },

    // Test files (copy from example-mcp)
    { source: 'test/unit/example.test.ts', destination: 'test/unit/example.test.ts', isTemplate: false },
    { source: 'test/system/mcp.system.test.ts', destination: 'test/system/mcp.system.test.ts', isTemplate: false },
    { source: 'test/system/utils.ts.hbs', destination: 'test/system/utils.ts', isTemplate: true }, // needs basePort
    { source: 'vitest.config.ts', destination: 'vitest.config.ts', isTemplate: false },

    // Docker files (templates for basePort and nginxPort)
    { source: 'Dockerfile', destination: 'Dockerfile', isTemplate: false },
    { source: 'docker-compose.yml.hbs', destination: 'docker-compose.yml', isTemplate: true },
    { source: 'nginx.conf.hbs', destination: 'nginx.conf', isTemplate: true },

    // Observability config files (Grafana, Loki, OpenTelemetry)
    { source: 'grafana/otel-collector-config.yaml', destination: 'grafana/otel-collector-config.yaml', isTemplate: false },
    { source: 'grafana/loki-config.yaml', destination: 'grafana/loki-config.yaml', isTemplate: false },
    { source: 'grafana/dashboards/mcp/mcp-logs.json', destination: 'grafana/dashboards/mcp/mcp-logs.json', isTemplate: false },
    { source: 'grafana/dashboards/ocsf/ocsf-security.json', destination: 'grafana/dashboards/ocsf/ocsf-security.json', isTemplate: false },
    { source: 'grafana/provisioning/dashboards/dashboards.yml', destination: 'grafana/provisioning/dashboards/dashboards.yml', isTemplate: false },
    { source: 'grafana/provisioning/datasources/datasources.yml', destination: 'grafana/provisioning/datasources/datasources.yml', isTemplate: false },
  ];
}

/**
 * Generate template data from project configuration
 *
 * No conditional flags needed - all projects are full-featured
 * Generates a unique encryption key for this project instance
 * Calculates nginxPort to avoid conflicts (basePort + 5180)
 */
function generateTemplateData(config: ProjectConfig): TemplateData {
  // Generate unique encryption key for .env.oauth and .env.local
  const tokenEncryptionKey = generateEncryptionKey();

  // Calculate nginx port from basePort to avoid conflicts
  // Example: basePort=3000 → nginxPort=8180, basePort=3001 → nginxPort=8181
  const nginxPort = config.basePort + 5180;

  return {
    ...config,
    tokenEncryptionKey,
    nginxPort,
    currentDate: new Date().toISOString().split('T')[0]!,
    frameworkVersion: FRAMEWORK_VERSION,
  };
}

/**
 * Generate package.json content
 */
function generatePackageJson(config: ProjectConfig): object {
  return {
    name: config.name,
    version: '0.1.0',
    description: config.description,
    type: 'module',
    main: 'dist/index.js',
    bin: {
      [config.name]: './dist/index.js',
    },
    scripts: getScripts(config),
    keywords: ['mcp', 'typescript', 'server'],
    author: config.author,
    license: 'MIT',
    dependencies: getDependencies(config),
    devDependencies: getDevDependencies(),
  };
}

/**
 * Generate a new MCP TypeScript Simple project
 */
export async function generateProject(config: ProjectConfig, targetDir: string): Promise<void> {
  const projectPath = path.resolve(process.cwd(), targetDir);

  console.log(chalk.cyan('\n📦 Generating project structure...\n'));

  // Check if directory exists and is not empty
  if (await isDirNonEmpty(projectPath)) {
    throw new Error(`Directory ${projectPath} already exists and is not empty`);
  }

  // Ensure project directory exists
  await ensureDir(projectPath);

  // Generate template data
  const templateData = generateTemplateData(config);

  // Get template files to process
  const templateFiles = getTemplateFiles(config);

  // Process all template files
  await processTemplateFiles(templateFiles, projectPath, templateData);

  // Generate package.json (special handling for complex structure)
  const packageJson = generatePackageJson(config);
  await fs.writeJSON(path.join(projectPath, 'package.json'), packageJson, { spaces: 2 });

  console.log(chalk.green('✅ Project structure created\n'));

  // Display generated features (full-featured by default)
  console.log(chalk.bold('Generated features:'));
  console.log(`  ✅ Basic MCP tools (hello, echo, current-time)`);
  console.log(`  ✅ LLM-powered tools (chat, analyze, summarize, explain)`);
  console.log(`  ✅ OAuth authentication (Google, GitHub, Microsoft)`);
  console.log(`  ✅ Docker deployment (nginx + Redis + multi-replica)`);
  console.log(`  ✅ Validation pipeline (vibe-validate)`);
  console.log(chalk.dim(`\n  Note: LLM and OAuth features work without API keys (graceful degradation)\n`));
}
