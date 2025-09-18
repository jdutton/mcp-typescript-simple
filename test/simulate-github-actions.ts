#!/usr/bin/env npx tsx

/**
 * Simulates the exact GitHub Actions workflow steps
 * to identify potential failures
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class GitHubActionsSimulator {

  async simulateWorkflow(): Promise<void> {
    console.log('🔄 Simulating GitHub Actions Workflow');
    console.log('=====================================\n');

    try {
      // Step 1: Checkout (simulated - we're already in the repo)
      console.log('✅ Step 1: Checkout code (simulated)');

      // Step 2: Setup Node.js (check current version)
      console.log('🔄 Step 2: Setup Node.js...');
      const nodeVersion = await execAsync('node --version');
      console.log(`✅ Node.js version: ${nodeVersion.stdout.trim()}`);

      // Step 3: Install dependencies
      console.log('🔄 Step 3: Install dependencies with npm ci...');
      const { stdout: _npmCiOutput, stderr: npmCiError } = await execAsync('npm ci');
      if (npmCiError && !npmCiError.includes('warn')) {
        throw new Error(`npm ci failed: ${npmCiError}`);
      }
      console.log('✅ Dependencies installed successfully');

      // Step 4: Run regression tests
      console.log('🔄 Step 4: Run regression tests...');
      const { stdout: _testOutput, stderr: testError } = await execAsync('npm run test:ci');
      if (testError && !testError.includes('✅')) {
        throw new Error(`Tests failed: ${testError}`);
      }
      console.log('✅ Regression tests passed');

      console.log('\n🎉 All GitHub Actions steps simulated successfully!');
      console.log('The workflow should pass in the actual GitHub environment.');

    } catch (error) {
      console.error('❌ GitHub Actions simulation failed:');
      console.error(error);
      process.exit(1);
    }
  }

  async simulateDockerBuild(): Promise<void> {
    console.log('\n🐳 Simulating Docker Build Step');
    console.log('=================================\n');

    try {
      // Check if Docker is available
      await execAsync('docker --version');
      console.log('✅ Docker is available');

      // Build Docker image
      console.log('🔄 Building Docker image...');
      const { stdout: _stdout, stderr: _stderr } = await execAsync('docker build -t mcp-typescript-simple-test .', {
        timeout: 120000 // 2 minutes timeout
      });

      console.log('✅ Docker build completed successfully');

      // Clean up test image
      try {
        await execAsync('docker rmi mcp-typescript-simple-test');
        console.log('✅ Test image cleaned up');
      } catch (_cleanupError) {
        console.log('⚠️  Cleanup warning (not critical):', _cleanupError);
      }

    } catch (error: unknown) {
      const execError = error as { message?: string };
      if (execError.message?.includes('docker: command not found') ||
          execError.message?.includes('Cannot connect to the Docker daemon')) {
        console.log('⚠️  Docker not available - this is expected in some CI environments');
        console.log('✅ Docker step would be skipped in GitHub Actions');
      } else {
        console.error('❌ Docker build failed:', error);
        throw error;
      }
    }
  }

  async checkPackageJsonScripts(): Promise<void> {
    console.log('\n📋 Checking package.json scripts');
    console.log('==================================\n');

    const scripts = [
      'build',
      'test:ci',
      'lint',
      'typecheck'
    ];

    for (const script of scripts) {
      try {
        console.log(`🔄 Testing: npm run ${script}`);
        const { stdout: _stdout, stderr: _stderr } = await execAsync(`npm run ${script}`);
        console.log(`✅ Script '${script}' executed successfully`);
      } catch (error) {
        console.error(`❌ Script '${script}' failed:`, error);
        throw error;
      }
    }
  }
}

async function main() {
  const simulator = new GitHubActionsSimulator();

  await simulator.simulateWorkflow();
  await simulator.simulateDockerBuild();
  await simulator.checkPackageJsonScripts();

  console.log('\n🎉 Complete GitHub Actions simulation passed!');
  console.log('If this passes locally but fails in GitHub, the issue is environment-specific.');
}

main().catch((error) => {
  console.error('❌ Simulation failed:', error);
  process.exit(1);
});