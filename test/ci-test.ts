#!/usr/bin/env npx tsx

/**
 * Comprehensive CI/CD test suite for MCP TypeScript Simple
 * This script runs all validation checks suitable for automated environments
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

class CITestRunner {
  private results: TestResult[] = [];

  async runAllTests(): Promise<void> {
    console.log('🚀 Running CI/CD Test Suite for MCP TypeScript Simple\n');
    console.log('========================================================\n');

    const tests = [
      { name: 'TypeScript Compilation', fn: () => this.testTypeScriptBuild() },
      { name: 'Type Checking', fn: () => this.testTypeCheck() },
      { name: 'Code Linting', fn: () => this.testLinting() },
      { name: 'Vercel Configuration', fn: () => this.testVercelConfiguration() },
      { name: 'Transport Layer', fn: () => this.testTransportLayer() },
      { name: 'MCP Server Startup', fn: () => this.testServerStartup() },
      { name: 'MCP Protocol Compliance', fn: () => this.testMCPProtocol() },
      { name: 'Tool Functionality', fn: () => this.testToolFunctionality() },
      { name: 'Error Handling', fn: () => this.testErrorHandling() },
      { name: 'Docker Build', fn: () => this.testDockerBuild() }
    ];

    for (const test of tests) {
      await this.runTest(test.name, test.fn);
    }

    this.printSummary();

    const failedTests = this.results.filter(r => !r.passed);
    if (failedTests.length > 0) {
      console.log('\n❌ Some tests failed. Exiting with code 1.');
      process.exit(1);
    } else {
      console.log('\n✅ All tests passed! Ready for deployment.');
      process.exit(0);
    }
  }

  private async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
    const start = Date.now();
    console.log(`🧪 Running: ${name}...`);

    try {
      await testFn();
      const duration = Date.now() - start;
      this.results.push({ name, passed: true, duration });
      console.log(`✅ ${name} - PASSED (${duration}ms)\n`);
    } catch (error) {
      const duration = Date.now() - start;
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.results.push({ name, passed: false, error: errorMsg, duration });
      console.log(`❌ ${name} - FAILED (${duration}ms)`);
      console.log(`   Error: ${errorMsg}\n`);
    }
  }

  private async testTypeScriptBuild(): Promise<void> {
    const { stdout: _stdout, stderr } = await execAsync('npm run build');
    if (stderr && !stderr.includes('warning')) {
      throw new Error(`Build failed: ${stderr}`);
    }
  }

  private async testTypeCheck(): Promise<void> {
    const { stdout: _stdout, stderr } = await execAsync('npm run typecheck');
    if (stderr) {
      throw new Error(`Type check failed: ${stderr}`);
    }
  }

  private async testLinting(): Promise<void> {
    try {
      const { stdout: _stdout, stderr: _stderr } = await execAsync('npm run lint');
    } catch (error: unknown) {
      const execError = error as { code?: number; stdout?: string; stderr?: string };
      if (execError.code === 1) {
        throw new Error(`Linting failed: ${execError.stdout || execError.stderr}`);
      }
      throw error;
    }
  }

  private async testServerStartup(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('npx', ['tsx', 'src/index.ts'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let _stderr = '';

      child.stderr.on('data', (data) => {
        _stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Server startup timeout'));
      }, 5000);

      child.stderr.on('data', (data) => {
        if (data.toString().includes('MCP TypeScript Simple server running')) {
          clearTimeout(timeout);
          child.kill();
          resolve();
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      child.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== null && code !== 0) {
          reject(new Error(`Server exited with code ${code}: ${_stderr}`));
        }
      });
    });
  }

  private async testMCPProtocol(): Promise<void> {
    const response = await this.sendMCPRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list'
    });

    if (response.error) {
      throw new Error(`Protocol error: ${response.error.message}`);
    }

    if (!response.result?.tools || !Array.isArray(response.result.tools)) {
      throw new Error('Invalid tools/list response structure');
    }

    const expectedTools = ['hello', 'echo', 'current-time'];
    const actualTools = response.result.tools.map((t: { name: string }) => t.name);

    for (const tool of expectedTools) {
      if (!actualTools.includes(tool)) {
        throw new Error(`Missing expected tool: ${tool}`);
      }
    }
  }

  private async testToolFunctionality(): Promise<void> {
    // Test hello tool
    const helloResponse = await this.sendMCPRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'hello', arguments: { name: 'CI Test' } }
    });

    if (helloResponse.error) {
      throw new Error(`Hello tool error: ${helloResponse.error.message}`);
    }

    const helloText = helloResponse.result?.content?.[0]?.text;
    if (!helloText || !helloText.includes('Hello, CI Test')) {
      throw new Error('Hello tool returned unexpected response');
    }

    // Test echo tool
    const echoResponse = await this.sendMCPRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'echo', arguments: { message: 'test message' } }
    });

    if (echoResponse.error) {
      throw new Error(`Echo tool error: ${echoResponse.error.message}`);
    }

    const echoText = echoResponse.result?.content?.[0]?.text;
    if (!echoText || !echoText.includes('test message')) {
      throw new Error('Echo tool returned unexpected response');
    }

    // Test current-time tool
    const timeResponse = await this.sendMCPRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'current-time', arguments: {} }
    });

    if (timeResponse.error) {
      throw new Error(`Time tool error: ${timeResponse.error.message}`);
    }

    const timeText = timeResponse.result?.content?.[0]?.text;
    if (!timeText || !timeText.includes('Current time:')) {
      throw new Error('Time tool returned unexpected response');
    }
  }

  private async testErrorHandling(): Promise<void> {
    const errorResponse = await this.sendMCPRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'nonexistent-tool', arguments: {} }
    });

    if (!errorResponse.error) {
      throw new Error('Expected error for nonexistent tool, but got success');
    }

    if (!errorResponse.error.message.includes('Unknown tool')) {
      throw new Error('Error message does not match expected format');
    }
  }

  private async testVercelConfiguration(): Promise<void> {
    try {
      // Run Vercel configuration tests
      const { stdout: _stdout, stderr } = await execAsync('npx tsx test/vercel-config-test.ts');
      if (stderr && stderr.includes('Failed tests:')) {
        throw new Error(`Vercel configuration validation failed: ${stderr}`);
      }
    } catch (error: unknown) {
      const execError = error as { code?: number; stdout?: string; stderr?: string };
      if (execError.code !== 0) {
        throw new Error(`Vercel configuration tests failed: ${execError.stdout || execError.stderr}`);
      }
      throw error;
    }
  }

  private async testTransportLayer(): Promise<void> {
    try {
      // Run transport layer tests
      const { stdout: _stdout, stderr } = await execAsync('npx tsx test/transport-test.ts');
      if (stderr && stderr.includes('Failed tests:')) {
        throw new Error(`Transport layer validation failed: ${stderr}`);
      }
    } catch (error: unknown) {
      const execError = error as { code?: number; stdout?: string; stderr?: string };
      if (execError.code !== 0) {
        throw new Error(`Transport layer tests failed: ${execError.stdout || execError.stderr}`);
      }
      throw error;
    }
  }

  private async testDockerBuild(): Promise<void> {
    try {
      // Check if Docker is available
      await execAsync('docker --version');

      // Build the Docker image
      const { stdout: _stdout, stderr: _stderr } = await execAsync('docker build -t mcp-typescript-simple-test .', {
        timeout: 120000 // 2 minutes timeout
      });

      // Clean up test image
      await execAsync('docker rmi mcp-typescript-simple-test').catch(() => {
        // Ignore cleanup errors
      });

    } catch (error: unknown) {
      const execError = error as { message?: string };
      if (execError.message?.includes('docker: command not found') ||
          execError.message?.includes('Cannot connect to the Docker daemon')) {
        console.log('   ⚠️  Docker not available, skipping Docker build test');
        return;
      }
      throw error;
    }
  }

  private async sendMCPRequest(request: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = spawn('npx', ['tsx', 'src/index.ts'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let _stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        _stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('MCP request timeout'));
      }, 10000);

      child.on('close', () => {
        clearTimeout(timeout);
        try {
          const lines = stdout.trim().split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{')) {
              const response = JSON.parse(line);
              if (response.id === request.id) {
                resolve(response);
                return;
              }
            }
          }
          reject(new Error('No valid MCP response found'));
        } catch (error) {
          reject(new Error(`Failed to parse MCP response: ${error}`));
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      child.stdin.write(JSON.stringify(request) + '\n');
      child.stdin.end();
    });
  }

  private printSummary(): void {
    console.log('\n📊 Test Summary');
    console.log('===============');

    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;

    console.log(`Total: ${total}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);

    const totalTime = this.results.reduce((sum, r) => sum + r.duration, 0);
    console.log(`Total time: ${totalTime}ms`);

    if (failed > 0) {
      console.log('\nFailed tests:');
      this.results.filter(r => !r.passed).forEach(r => {
        console.log(`❌ ${r.name}: ${r.error}`);
      });
    }
  }
}

// Run tests if this file is executed directly
const runner = new CITestRunner();
runner.runAllTests().catch((error) => {
  console.error('❌ Test runner failed:', error);
  process.exit(1);
});