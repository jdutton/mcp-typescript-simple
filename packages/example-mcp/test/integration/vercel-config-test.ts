#!/usr/bin/env tsx

/**
 * Vercel configuration and serverless function validation tests
 */

import { existsSync, readFileSync } from 'node:fs';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

class VercelConfigTestRunner {
  private results: TestResult[] = [];

  async runAllTests(): Promise<void> {
    console.log('🚀 Running Vercel Configuration Tests');
    console.log('====================================\n');

    await this.testVercelConfigExists();
    await this.testVercelConfigSyntax();
    await this.testVercelConfigStructure();
    await this.testVercelIgnoreExists();
    await this.testApiFilesExist();
    await this.testApiFilesSyntax();
    await this.testApiImportsResolvable();
    await this.testPackageJsonVercelSupport();
    await this.testBuildOutputStructure();
    await this.testEnvironmentVariableDocumentation();

    this.printSummary();

    const failedTests = this.results.filter(r => !r.passed);
    if (failedTests.length > 0) {
      process.exit(1);
    }
  }

  private async runTest(name: string, testFn: () => Promise<void> | void): Promise<void> {
    console.log(`🧪 Testing: ${name}...`);

    try {
      await testFn();
      this.results.push({ name, passed: true });
      console.log(`✅ ${name} - PASSED\n`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.results.push({ name, passed: false, error: errorMsg });
      console.log(`❌ ${name} - FAILED`);
      console.log(`   Error: ${errorMsg}\n`);
    }
  }

  private async testVercelConfigExists(): Promise<void> {
    await this.runTest('Vercel Configuration File Exists', () => {
      if (!existsSync('vercel.json')) {
        throw new Error('vercel.json file not found');
      }
    });
  }

  private async testVercelConfigSyntax(): Promise<void> {
    await this.runTest('Vercel Configuration JSON Syntax', () => {
      try {
        const content = readFileSync('vercel.json', 'utf8');
        JSON.parse(content);
      } catch (error) {
        throw new Error(`Invalid JSON syntax in vercel.json: ${error.message}`);
      }
    });
  }

  private async testVercelConfigStructure(): Promise<void> {
    await this.runTest('Vercel Configuration Structure', () => {
      const content = readFileSync('vercel.json', 'utf8');
      const config = JSON.parse(content);

      // Check required fields
      if (!config.version) {
        throw new Error('Missing version field in vercel.json');
      }

      if (config.version !== 2) {
        throw new Error(`Expected version 2, got ${config.version}`);
      }

      // Modern Vercel uses functions instead of builds
      if (!config.functions || typeof config.functions !== 'object') {
        throw new Error('Missing or invalid functions configuration');
      }

      // Check for modern rewrites or legacy routes
      if (!config.rewrites && !config.routes) {
        throw new Error('Missing routing configuration (rewrites or routes)');
      }

      const routing = config.rewrites || config.routes;
      if (!Array.isArray(routing)) {
        throw new Error('Invalid routing configuration - must be array');
      }

      // Validate functions configuration
      const requiredFunctions = ['api/mcp.ts', 'api/auth.ts'];
      for (const func of requiredFunctions) {
        if (!config.functions[func]) {
          throw new Error(`Missing function configuration for ${func}`);
        }

        // Validate function has maxDuration
        if (typeof config.functions[func].maxDuration !== 'number') {
          throw new Error(`Missing or invalid maxDuration for function ${func}`);
        }
      }

      // Validate routing (rewrites or routes)
      const expectedRoutes = ['/health', '/mcp', '/auth', '/admin'];
      const configuredRoutes = routing.map((route: any) => route.src || route.source);

      for (const expectedRoute of expectedRoutes) {
        const hasRoute = configuredRoutes.some((route: string) =>
          route.includes(expectedRoute)
        );
        if (!hasRoute) {
          throw new Error(`Missing route configuration for ${expectedRoute}`);
        }
      }

      // Ensure no conflicting builds property exists
      if (config.builds) {
        throw new Error('Legacy builds configuration detected. Use functions instead.');
      }
    });
  }

  private async testVercelIgnoreExists(): Promise<void> {
    await this.runTest('Vercel Ignore File Exists', () => {
      if (!existsSync('.vercelignore')) {
        throw new Error('.vercelignore file not found');
      }

      const content = readFileSync('.vercelignore', 'utf8');
      const lines = content.split('\n').map(line => line.trim());

      // Check for important exclusions (src/ should be included for TypeScript compilation)
      const expectedExclusions = ['test/', 'node_modules/', '.git/'];
      for (const exclusion of expectedExclusions) {
        if (!lines.includes(exclusion)) {
          throw new Error(`Missing exclusion in .vercelignore: ${exclusion}`);
        }
      }

      // Ensure src/ is NOT excluded (needed for TypeScript compilation)
      if (lines.includes('src/')) {
        throw new Error('src/ should not be excluded - Vercel needs it for TypeScript compilation');
      }
    });
  }

  private async testApiFilesExist(): Promise<void> {
    await this.runTest('API Files Exist', () => {
      const requiredFiles = [
        'api/mcp.ts',
        'api/health.ts',
        'api/auth.ts',
        'api/admin.ts'
      ];

      for (const file of requiredFiles) {
        if (!existsSync(file)) {
          throw new Error(`Required API file not found: ${file}`);
        }
      }
    });
  }

  private async testApiFilesSyntax(): Promise<void> {
    await this.runTest('API Files TypeScript Syntax', async () => {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);

      try {
        // Check if API files compile without errors
        await execAsync('npx tsc --noEmit api/*.ts --esModuleInterop --allowSyntheticDefaultImports --moduleResolution node --target ES2020');
      } catch (error: any) {
        const stderr = error.stderr || '';
        const stdout = error.stdout || '';
        throw new Error(`API files have TypeScript syntax errors:\n${stderr}\n${stdout}\nError: ${error.message}`);
      }
    });
  }

  private async testApiImportsResolvable(): Promise<void> {
    await this.runTest('API File Imports Resolvable', () => {
      const apiFiles = ['api/mcp.ts', 'api/health.ts', 'api/auth.ts', 'api/admin.ts'];

      for (const file of apiFiles) {
        const content = readFileSync(file, 'utf8');

        // Check for imports from build directory
        const imports = content.match(/from ['"]([^'"]+)['"]/g) || [];

        for (const importStatement of imports) {
          const importPath = importStatement.match(/from ['"]([^'"]+)['"]/)?.[1];
          if (importPath?.startsWith('../build/')) {
            // Verify the build file exists
            const buildPath = importPath.replace('../build/', 'build/') + (importPath.endsWith('.js') ? '' : '.js');
            if (!existsSync(buildPath)) {
              throw new Error(`Import path not found: ${buildPath} (imported in ${file})`);
            }
          }
        }
      }
    });
  }

  private async testPackageJsonVercelSupport(): Promise<void> {
    await this.runTest('Package.json Vercel Support', () => {
      const content = readFileSync('package.json', 'utf8');
      const pkg = JSON.parse(content);

      // Check Node.js version compatibility
      if (!pkg.engines?.node) {
        throw new Error('Missing Node.js engine specification');
      }

      const nodeVersion = pkg.engines.node;
      if (!nodeVersion.includes('22') && !nodeVersion.includes('>=22')) {
        throw new Error(`Node.js version should be >=22 for Vercel, got: ${nodeVersion}`);
      }

      // Check for Vercel dependencies
      const devDeps = pkg.devDependencies || {};
      if (!devDeps['@vercel/node']) {
        throw new Error('Missing @vercel/node dependency');
      }

      if (!devDeps.vercel) {
        throw new Error('Missing vercel CLI dependency');
      }

      // Check for Vercel scripts
      const scripts = pkg.scripts || {};
      if (!scripts['dev:vercel']) {
        throw new Error('Missing dev:vercel script');
      }

      if (!scripts['deploy:vercel']) {
        throw new Error('Missing deploy:vercel script');
      }
    });
  }

  private async testBuildOutputStructure(): Promise<void> {
    await this.runTest('Build Output Structure', () => {
      if (!existsSync('build')) {
        throw new Error('Build directory not found. Run npm run build first.');
      }

      // Check for critical build outputs needed by API functions
      const requiredBuildFiles = [
        'packages/auth/dist/factory.js',  // Auth package (used by api/)
        'packages/example-mcp/dist/index.js',  // Main entry point
        'packages/server/dist/index.js'  // Server package (used by api/)
      ];

      for (const file of requiredBuildFiles) {
        if (!existsSync(file)) {
          throw new Error(`Required build output not found: ${file}`);
        }
      }
    });
  }

  private async testEnvironmentVariableDocumentation(): Promise<void> {
    await this.runTest('Environment Variable Documentation', () => {
      // Check deployment docs mention environment variables
      if (!existsSync('docs/vercel-deployment.md')) {
        throw new Error('Vercel deployment documentation not found');
      }

      const deploymentDoc = readFileSync('docs/vercel-deployment.md', 'utf8');

      // Check for LLM provider keys
      const llmProviderVars = [
        'ANTHROPIC_API_KEY',
        'OPENAI_API_KEY',
        'GOOGLE_API_KEY'
      ];

      // Check for multi-provider OAuth support (at least one provider should be documented)
      const oauthProviderVars = [
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'GITHUB_CLIENT_ID',
        'GITHUB_CLIENT_SECRET',
        'MICROSOFT_CLIENT_ID',
        'MICROSOFT_CLIENT_SECRET'
      ];

      const requiredEnvVars = [...llmProviderVars, ...oauthProviderVars];

      for (const envVar of requiredEnvVars) {
        if (!deploymentDoc.includes(envVar)) {
          throw new Error(`Environment variable ${envVar} not documented in deployment guide`);
        }
      }

      // Check quick start guide exists
      if (!existsSync('docs/vercel-quickstart.md')) {
        throw new Error('Vercel quick start guide not found');
      }
    });
  }

  private printSummary(): void {
    console.log('\n📊 Vercel Configuration Test Summary');
    console.log('===================================');

    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;

    console.log(`Total: ${this.results.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);

    if (failed > 0) {
      console.log('\nFailed tests:');
      this.results.filter(r => !r.passed).forEach(r => {
        console.log(`❌ ${r.name}: ${r.error}`);
      });
    } else {
      console.log('\n✅ All Vercel configuration tests passed!');
    }
  }
}

// Run tests
const runner = new VercelConfigTestRunner();
runner.runAllTests().catch((error) => {
  console.error('❌ Vercel config test runner failed:', error);
  process.exit(1);
});