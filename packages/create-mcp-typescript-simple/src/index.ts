#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promptForConfig, getDefaultConfig } from './prompts.js';
import { generateProject } from './generator.js';
import type { CliOptions, ProjectConfig } from './types.js';

const execAsync = promisify(exec);

// Get package version dynamically
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const VERSION = packageJson.version;

const program = new Command();

/**
 * Initialize git repository
 */
async function initGit(projectPath: string): Promise<void> {
  console.log(chalk.cyan('🔧 Initializing git repository...'));
  try {
    await execAsync('git init', { cwd: projectPath });
    await execAsync('git add .', { cwd: projectPath });
    await execAsync('git commit -m "chore: Initial commit from create-mcp-typescript-simple"', { cwd: projectPath });
    console.log(chalk.green('✅ Git repository initialized\n'));
  } catch (error) {
    console.log(chalk.yellow('⚠️  Failed to initialize git repository'));
    console.log(chalk.gray(`  ${error instanceof Error ? error.message : String(error)}\n`));
  }
}

/**
 * Install npm dependencies
 */
async function installDependencies(projectPath: string): Promise<void> {
  console.log(chalk.cyan('📦 Installing dependencies (this may take a few minutes)...\n'));
  try {
    await execAsync('npm install', { cwd: projectPath });
    console.log(chalk.green('✅ Dependencies installed\n'));
  } catch (error) {
    console.log(chalk.yellow('⚠️  Failed to install dependencies'));
    console.log(chalk.gray(`  ${error instanceof Error ? error.message : String(error)}`));
    console.log(chalk.yellow('  Run `npm install` manually in the project directory\n'));
  }
}

/**
 * Display next steps for the user
 */
function displayNextSteps(config: ProjectConfig, projectPath: string): void {
  const projectName = path.basename(projectPath);

  console.log(chalk.bold.green('🎉 Project created successfully!\n'));

  console.log(chalk.bold('Next steps:'));
  console.log(chalk.cyan(`  cd ${projectName}`));
  console.log();

  console.log(chalk.bold('  1. Configure environment (CRITICAL):'));
  console.log(chalk.cyan('     cp .env.example .env'));
  console.log(chalk.gray('     # Edit .env and add your API keys\n'));

  console.log(chalk.bold('  2. Start development:'));
  console.log(chalk.cyan('     npm run dev:stdio        # STDIO mode (MCP Inspector)'));
  console.log(chalk.cyan('     npm run dev:http         # HTTP mode (skip auth - dev only)'));
  console.log(chalk.cyan('     npm run dev:oauth        # HTTP mode with OAuth\n'));

  console.log(chalk.bold('  3. Test deployment:'));
  console.log(chalk.cyan('     docker-compose up        # Docker deployment\n'));

  console.log(chalk.bold('📚 Documentation:'));
  console.log(chalk.cyan('   ./CLAUDE.md              # Claude Code integration guide'));
  console.log(chalk.cyan('   ./README.md              # Project documentation'));
  console.log();

  console.log(chalk.bold.yellow('🔐 Security:'));
  console.log(chalk.yellow(`   Unique encryption key generated in .env.example`));
  console.log(chalk.yellow(`   KEEP IT SECRET - never commit .env files to git!\n`));
}

/**
 * Main CLI logic
 */
async function main() {
  program
    .name('create-mcp-typescript-simple')
    .description('Scaffolding tool for creating production-ready MCP TypeScript Simple servers')
    .version(VERSION)
    .argument('[project-name]', 'Name of the project to create')
    .option('-y, --yes', 'Skip prompts and use defaults')
    .action(async (projectName: string | undefined, options: CliOptions) => {
      try {
        // Validate project name if provided
        if (projectName && !/^[a-z0-9-_]+$/.test(projectName)) {
          console.error(chalk.red('\n❌ Invalid project name'));
          console.error(chalk.yellow('   Project name must be lowercase with only letters, numbers, dashes, and underscores\n'));
          process.exit(1);
        }

        let config: ProjectConfig;

        // Get configuration
        if (options.yes) {
          if (!projectName) {
            console.error(chalk.red('\n❌ Project name is required with --yes flag\n'));
            process.exit(1);
          }

          config = await getDefaultConfig(projectName);
          console.log(chalk.cyan(`\n✨ Creating ${projectName} with default configuration\n`));
        } else {
          // Interactive prompts
          config = await promptForConfig(projectName);
        }

        // Generate project
        await generateProject(config, config.name);

        // Always initialize git
        await initGit(path.resolve(process.cwd(), config.name));

        // Always install dependencies
        await installDependencies(path.resolve(process.cwd(), config.name));

        // Display next steps
        displayNextSteps(config, config.name);
      } catch (error) {
        console.error(chalk.red('\n❌ Error creating project:'));
        console.error(chalk.gray(`  ${error instanceof Error ? error.message : String(error)}\n`));
        process.exit(1);
      }
    });

  program.parse();
}

main();
