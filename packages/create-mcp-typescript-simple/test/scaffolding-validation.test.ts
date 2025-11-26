/**
 * Scaffolding Validation Regression Test
 *
 * This test verifies that freshly scaffolded projects:
 * 1. Generate successfully with all required files
 * 2. Install dependencies without errors
 * 3. Pass all validation checks (vibe-validate) out of the box
 * 4. Include comprehensive test coverage (unit + system tests)
 *
 * This is a critical regression test ensuring published npm packages
 * produce production-ready MCP servers without manual modification.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Scaffolding Validation Regression', () => {
  let tempDir: string;
  let projectDir: string;
  const projectName = 'test-scaffold-validation';

  beforeAll(() => {
    // Create temporary directory
    tempDir = mkdtempSync(join(tmpdir(), 'scaffold-test-'));
    projectDir = join(tempDir, projectName);

    console.log(`\n📦 Creating scaffolded project in: ${projectDir}`);

    // Scaffold new project using published package
    try {
      execSync(`npm create mcp-typescript-simple@next ${projectName} -- --yes`, {
        cwd: tempDir,
        stdio: 'pipe',
        encoding: 'utf-8',
      });
    } catch (error: any) {
      console.error('❌ Scaffolding failed:', error.message);
      throw error;
    }

    console.log('✅ Scaffolding completed');
  });

  afterAll(() => {
    // Cleanup temporary directory
    if (tempDir && existsSync(tempDir)) {
      console.log(`\n🧹 Cleaning up: ${tempDir}`);
      rmSync(tempDir, { recursive: true, force: true });
      console.log('✅ Cleanup completed');
    }
  });

  describe('Project Structure', () => {
    it('should create project directory', () => {
      expect(existsSync(projectDir)).toBe(true);
    });

    it('should include package.json', () => {
      expect(existsSync(join(projectDir, 'package.json'))).toBe(true);
    });

    it('should include tsconfig.json', () => {
      expect(existsSync(join(projectDir, 'tsconfig.json'))).toBe(true);
    });

    it('should include vibe-validate config', () => {
      expect(existsSync(join(projectDir, 'vibe-validate.config.yaml'))).toBe(true);
    });

    it('should include source code', () => {
      expect(existsSync(join(projectDir, 'src', 'index.ts'))).toBe(true);
    });

    it('should include .env.example', () => {
      expect(existsSync(join(projectDir, '.env.example'))).toBe(true);
    });

    it('should include README.md', () => {
      expect(existsSync(join(projectDir, 'README.md'))).toBe(true);
    });

    it('should include CLAUDE.md', () => {
      expect(existsSync(join(projectDir, 'CLAUDE.md'))).toBe(true);
    });
  });

  describe('Docker Configuration', () => {
    it('should include docker-compose.yml', () => {
      expect(existsSync(join(projectDir, 'docker-compose.yml'))).toBe(true);
    });

    it('should include Dockerfile', () => {
      expect(existsSync(join(projectDir, 'Dockerfile'))).toBe(true);
    });

    it('should include nginx.conf', () => {
      expect(existsSync(join(projectDir, 'nginx.conf'))).toBe(true);
    });

    it('should include grafana observability configs', () => {
      const grafanaDir = join(projectDir, 'grafana');
      expect(existsSync(grafanaDir)).toBe(true);
      expect(existsSync(join(grafanaDir, 'otel-collector-config.yaml'))).toBe(true);
      expect(existsSync(join(grafanaDir, 'loki-config.yaml'))).toBe(true);
      expect(existsSync(join(grafanaDir, 'dashboards'))).toBe(true);
      expect(existsSync(join(grafanaDir, 'provisioning'))).toBe(true);
    });
  });

  describe('Test Coverage', () => {
    it('should include test directory', () => {
      expect(existsSync(join(projectDir, 'test'))).toBe(true);
    });

    it('should include unit tests', () => {
      const unitTestDir = join(projectDir, 'test', 'unit');
      expect(existsSync(unitTestDir)).toBe(true);

      const unitTests = readdirSync(unitTestDir).filter(f => f.endsWith('.test.ts'));
      expect(unitTests.length).toBeGreaterThan(0);
    });

    it('should include system tests', () => {
      const systemTestDir = join(projectDir, 'test', 'system');
      expect(existsSync(systemTestDir)).toBe(true);

      const systemTests = readdirSync(systemTestDir).filter(f => f.endsWith('.test.ts'));
      expect(systemTests.length).toBeGreaterThan(0);
    });

    it('should include test utilities', () => {
      expect(existsSync(join(projectDir, 'test', 'system', 'utils.ts'))).toBe(true);
    });
  });

  describe('Dependencies', () => {
    it('should install dependencies', () => {
      expect(existsSync(join(projectDir, 'node_modules'))).toBe(true);
    });

    it('should include @mcp-typescript-simple packages', () => {
      const nodeModules = join(projectDir, 'node_modules', '@mcp-typescript-simple');
      expect(existsSync(nodeModules)).toBe(true);

      // Verify key framework packages are installed
      expect(existsSync(join(nodeModules, 'config'))).toBe(true);
      expect(existsSync(join(nodeModules, 'server'))).toBe(true);
      expect(existsSync(join(nodeModules, 'tools'))).toBe(true);
      expect(existsSync(join(nodeModules, 'http-server'))).toBe(true);
      expect(existsSync(join(nodeModules, 'auth'))).toBe(true);
    });
  });

  describe('Validation (Critical)', () => {
    it('should pass TypeScript type checking', () => {
      console.log('\n🔍 Running typecheck...');
      try {
        execSync('npm run typecheck', {
          cwd: projectDir,
          stdio: 'pipe',
          encoding: 'utf-8',
        });
        console.log('✅ Typecheck passed');
      } catch (error: any) {
        console.error('❌ Typecheck failed:', error.stdout || error.message);
        throw error;
      }
    });

    it('should pass ESLint checking', () => {
      console.log('\n🔍 Running lint...');
      try {
        execSync('npm run lint', {
          cwd: projectDir,
          stdio: 'pipe',
          encoding: 'utf-8',
        });
        console.log('✅ Lint passed');
      } catch (error: any) {
        console.error('❌ Lint failed:', error.stdout || error.message);
        throw error;
      }
    });

    it('should build successfully', () => {
      console.log('\n🔍 Running build...');
      try {
        execSync('npm run build', {
          cwd: projectDir,
          stdio: 'pipe',
          encoding: 'utf-8',
        });
        console.log('✅ Build passed');
      } catch (error: any) {
        console.error('❌ Build failed:', error.stdout || error.message);
        throw error;
      }
    });

    it('should pass unit tests', () => {
      console.log('\n🔍 Running unit tests...');
      try {
        execSync('npm run test:unit', {
          cwd: projectDir,
          stdio: 'pipe',
          encoding: 'utf-8',
        });
        console.log('✅ Unit tests passed');
      } catch (error: any) {
        console.error('❌ Unit tests failed:', error.stdout || error.message);
        throw error;
      }
    });

    it('should pass system tests (STDIO)', () => {
      console.log('\n🔍 Running system tests (STDIO)...');
      try {
        execSync('npm run test:system:stdio', {
          cwd: projectDir,
          stdio: 'pipe',
          encoding: 'utf-8',
        });
        console.log('✅ System tests (STDIO) passed');
      } catch (error: any) {
        console.error('❌ System tests (STDIO) failed:', error.stdout || error.message);
        throw error;
      }
    });

    it('should pass system tests (HTTP)', () => {
      console.log('\n🔍 Running system tests (HTTP)...');
      try {
        execSync('npm run test:system:http', {
          cwd: projectDir,
          stdio: 'pipe',
          encoding: 'utf-8',
        });
        console.log('✅ System tests (HTTP) passed');
      } catch (error: any) {
        console.error('❌ System tests (HTTP) failed:', error.stdout || error.message);
        throw error;
      }
    });

    it('should pass complete validation (vibe-validate)', () => {
      console.log('\n🔍 Running full validation (vibe-validate)...');
      try {
        const output = execSync('npx vibe-validate validate', {
          cwd: projectDir,
          stdio: 'pipe',
          encoding: 'utf-8',
        });

        console.log(output);
        console.log('✅ Full validation passed');

        // Verify validation output contains success indicators
        expect(output).toContain('passed');
      } catch (error: any) {
        console.error('❌ Full validation failed:', error.stdout || error.message);
        throw error;
      }
    }, 300000); // 5 minute timeout for full validation
  });

  describe('Production Readiness', () => {
    it('should include all npm scripts for development', () => {
      const packageJson = JSON.parse(
        require('node:fs').readFileSync(join(projectDir, 'package.json'), 'utf-8')
      );

      const expectedScripts = [
        'build',
        'dev:stdio',
        'dev:http',
        'dev:oauth',
        'test',
        'test:unit',
        'test:system',
        'test:system:stdio',
        'test:system:http',
        'validate',
        'pre-commit',
        'typecheck',
        'lint',
      ];

      for (const script of expectedScripts) {
        expect(packageJson.scripts[script]).toBeDefined();
      }
    });

    it('should include proper npm metadata', () => {
      const packageJson = JSON.parse(
        require('node:fs').readFileSync(join(projectDir, 'package.json'), 'utf-8')
      );

      expect(packageJson.name).toBeDefined();
      expect(packageJson.version).toBeDefined();
      expect(packageJson.description).toBeDefined();
      expect(packageJson.license).toBeDefined();
    });

    it('should include git repository', () => {
      expect(existsSync(join(projectDir, '.git'))).toBe(true);
    });

    it('should include .gitignore', () => {
      expect(existsSync(join(projectDir, '.gitignore'))).toBe(true);
    });
  });
});
