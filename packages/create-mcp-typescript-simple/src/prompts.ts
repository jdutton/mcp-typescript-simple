import { input } from '@inquirer/prompts';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProjectConfig } from './types.js';
import { generateEncryptionKey } from './utils/encryption.js';

const execAsync = promisify(exec);

/**
 * Validate project name follows npm naming rules
 */
function validateProjectName(name: string): boolean | string {
  if (!name) {
    return 'Project name is required';
  }

  // npm package name rules
  if (!/^[a-z0-9-_]+$/.test(name)) {
    return 'Project name must be lowercase with only letters, numbers, dashes, and underscores';
  }

  if (name.startsWith('-') || name.startsWith('_')) {
    return 'Project name cannot start with a dash or underscore';
  }

  if (name.length > 214) {
    return 'Project name must be 214 characters or less';
  }

  return true;
}

/**
 * Validate port number
 */
function validatePort(input: string): boolean | string {
  const port = parseInt(input, 10);

  if (isNaN(port)) {
    return 'Port must be a number';
  }

  if (port < 1024 || port > 65535) {
    return 'Port must be between 1024 and 65535';
  }

  return true;
}

/**
 * Get git user name from git config
 */
async function getGitUserName(): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync('git config user.name');
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/**
 * Convert project name to display name
 * Example: "my-mcp-server" -> "My MCP Server"
 */
function toDisplayName(projectName: string): string {
  return projectName
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Prompt user for project configuration
 */
export async function promptForConfig(projectName?: string): Promise<ProjectConfig> {
  console.log('\n✨ Creating production-ready MCP server\n');

  // Project name
  const name = projectName
    ? projectName
    : await input({
        message: 'Project name:',
        default: 'my-mcp-server',
        validate: validateProjectName,
      });

  // Description
  const description = await input({
    message: 'Description:',
    default: 'Production-ready MCP server with OAuth, LLM, and Docker',
  });

  // Author
  const gitUserName = await getGitUserName();
  const author = await input({
    message: 'Author:',
    default: gitUserName || 'Your Name',
  });

  // BASE_PORT (for dev server and tests)
  const basePortInput = await input({
    message: 'HTTP Port (BASE_PORT - tests will use +1, +2):',
    default: '3000',
    validate: validatePort,
  });
  const basePort = parseInt(basePortInput, 10);

  return {
    name,
    description,
    author,
    mcpServerName: toDisplayName(name),
    basePort,
    tokenEncryptionKey: generateEncryptionKey(),
  };
}

/**
 * Get default configuration (for --yes flag)
 */
export async function getDefaultConfig(projectName: string): Promise<ProjectConfig> {
  const gitUserName = await getGitUserName();

  return {
    name: projectName,
    description: 'Production-ready MCP server with OAuth, LLM, and Docker',
    author: gitUserName || 'Your Name',
    mcpServerName: toDisplayName(projectName),
    basePort: 3000,
    tokenEncryptionKey: generateEncryptionKey(),
  };
}
