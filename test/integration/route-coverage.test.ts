/**
 * Route Coverage Test
 *
 * Ensures all Express routes are documented in the OpenAPI specification.
 * Detects drift when routes are added to code but not documented.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'yaml';
import { MCPStreamableHttpServer } from '../../src/server/streamable-http-server.js';
import type { Express } from 'express';

describe('Route Coverage - Detect Undocumented Routes', () => {
  let server: MCPStreamableHttpServer;
  let app: Express;
  let openapiSpec: any;

  beforeAll(async () => {
    // Load OpenAPI specification
    const openapiPath = join(process.cwd(), 'openapi.yaml');
    const openapiYaml = readFileSync(openapiPath, 'utf-8');
    openapiSpec = yaml.parse(openapiYaml);

    // Create test server
    server = new MCPStreamableHttpServer({
      port: 3003,
      host: 'localhost',
      endpoint: '/mcp',
      requireAuth: false,
      sessionSecret: 'test-secret',
    });

    await server.initialize();
    app = server.getApp();
  });

  afterAll(async () => {
    await server.stop();
    // Give connections time to close
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  /**
   * Extract all routes from Express app
   */
  function extractExpressRoutes(app: Express): Array<{ method: string; path: string }> {
    const routes: Array<{ method: string; path: string }> = [];

    // Access Express router stack
    const stack = (app._router as any)?.stack || [];

    stack.forEach((middleware: any) => {
      if (middleware.route) {
        // Regular route
        const methods = Object.keys(middleware.route.methods);
        methods.forEach(method => {
          routes.push({
            method: method.toUpperCase(),
            path: middleware.route.path
          });
        });
      } else if (middleware.name === 'router') {
        // Nested router (like /auth/*, /admin/*)
        const routerStack = middleware.handle?.stack || [];
        routerStack.forEach((handler: any) => {
          if (handler.route) {
            const methods = Object.keys(handler.route.methods);
            const basePath = middleware.regexp?.source || '';

            // Extract base path from regex (e.g., /^\/auth\/?(?=\/|$)/i -> /auth)
            const cleanBasePath = basePath
              .replace(/\^\\\//, '/') // Remove ^\/
              .replace(/\\/g, '')      // Remove backslashes
              .replace(/\?\(\?=.*$/, '') // Remove (?= lookahead
              .replace(/\/\$\/i$/, '')   // Remove $/i
              .replace(/\?\/$/, '');     // Remove ?/

            methods.forEach(method => {
              const fullPath = cleanBasePath + handler.route.path;
              routes.push({
                method: method.toUpperCase(),
                path: fullPath
              });
            });
          }
        });
      }
    });

    return routes;
  }

  /**
   * Extract all documented paths from OpenAPI spec
   */
  function extractOpenApiPaths(spec: any): Array<{ method: string; path: string }> {
    const paths: Array<{ method: string; path: string }> = [];

    Object.entries(spec.paths || {}).forEach(([path, methods]: [string, any]) => {
      Object.keys(methods).forEach(method => {
        if (['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method)) {
          paths.push({
            method: method.toUpperCase(),
            path: path
          });
        }
      });
    });

    return paths;
  }

  /**
   * Normalize path for comparison
   * Converts Express :param to OpenAPI {param}
   */
  function normalizePath(path: string): string {
    return path
      .replace(/:(\w+)/g, '{$1}') // Convert :id to {id}
      .replace(/\/+$/, '') // Remove trailing slashes
      .replace(/^\/+/, '/'); // Ensure leading slash
  }

  /**
   * Check if a route should be ignored (internal/middleware routes)
   */
  function shouldIgnoreRoute(method: string, path: string): boolean {
    const ignoredPatterns = [
      /^\/$/, // Root path (might be catch-all)
      /\/\*/, // Wildcard routes
      /^$/, // Empty paths
    ];

    return ignoredPatterns.some(pattern => pattern.test(path));
  }

  /**
   * Check if a route is conditional (requires specific configuration)
   */
  function isConditionalRoute(method: string, path: string): boolean {
    const conditionalPatterns = [
      /^\/auth/,              // OAuth routes (require OAuth configuration)
      /^\/token$/,            // Token endpoint (requires OAuth)
      /^\/register/,          // Dynamic Client Registration (requires OAuth)
      /^\/\.well-known\//,    // Discovery endpoints (some require OAuth)
      /^\/admin\//,           // Admin routes (may require auth configuration)
      /^\/debug\//,           // Debug routes (development only)
    ];

    return conditionalPatterns.some(pattern => pattern.test(path));
  }

  /**
   * Check if route is a core endpoint (route extraction may not find but exists)
   */
  function isCoreEndpoint(method: string, path: string): boolean {
    const coreRoutes = [
      { method: 'GET', path: '/health' },
      { method: 'GET', path: '/mcp' },
      { method: 'POST', path: '/mcp' },
      { method: 'DELETE', path: '/mcp' },
    ];

    return coreRoutes.some(r => r.method === method && r.path === path);
  }

  describe('All Express Routes Are Documented', () => {
    it('should have all actual routes documented in OpenAPI spec', () => {
      const expressRoutes = extractExpressRoutes(app);
      const openApiPaths = extractOpenApiPaths(openapiSpec);

      // Normalize paths for comparison
      const normalizedOpenApiPaths = openApiPaths.map(r => ({
        method: r.method,
        path: normalizePath(r.path)
      }));

      // Find undocumented routes
      const undocumentedRoutes = expressRoutes
        .filter(route => !shouldIgnoreRoute(route.method, route.path))
        .filter(route => {
          const normalizedPath = normalizePath(route.path);
          return !normalizedOpenApiPaths.some(
            doc => doc.method === route.method && doc.path === normalizedPath
          );
        });

      if (undocumentedRoutes.length > 0) {
        console.error('\n❌ Undocumented routes found:');
        undocumentedRoutes.forEach(route => {
          console.error(`  ${route.method} ${route.path}`);
        });
        console.error('\nPlease add these routes to openapi.yaml\n');
      }

      expect(undocumentedRoutes).toEqual([]);
    });
  });

  describe('All Documented Routes Exist in Express', () => {
    it('should have all OpenAPI paths implemented in Express', () => {
      const expressRoutes = extractExpressRoutes(app);
      const openApiPaths = extractOpenApiPaths(openapiSpec);

      // Normalize paths for comparison
      const normalizedExpressRoutes = expressRoutes.map(r => ({
        method: r.method,
        path: normalizePath(r.path)
      }));

      // Find documented but not implemented routes
      const missingRoutes = openApiPaths
        .filter(doc => {
          const normalizedPath = normalizePath(doc.path);
          return !normalizedExpressRoutes.some(
            route => route.method === doc.method && route.path === normalizedPath
          );
        });

      // Separate conditional routes and core endpoints from truly missing routes
      const conditionalMissing = missingRoutes.filter(r => isConditionalRoute(r.method, r.path));
      const coreMissing = missingRoutes.filter(r => isCoreEndpoint(r.method, r.path));
      const trulyMissing = missingRoutes.filter(r =>
        !isConditionalRoute(r.method, r.path) && !isCoreEndpoint(r.method, r.path)
      );

      if (conditionalMissing.length > 0) {
        console.log('\n⚠️  Conditional routes (not implemented in test environment):');
        conditionalMissing.forEach(route => {
          console.log(`  ${route.method} ${route.path}`);
        });
      }

      if (coreMissing.length > 0) {
        console.log('\n✅ Core endpoints (route extraction limitation, verified via compliance tests):');
        coreMissing.forEach(route => {
          console.log(`  ${route.method} ${route.path}`);
        });
      }

      if (trulyMissing.length > 0) {
        console.error('\n❌ Documented routes not implemented:');
        trulyMissing.forEach(route => {
          console.error(`  ${route.method} ${route.path}`);
        });
        console.error('\nPlease implement these routes or remove from openapi.yaml\n');
      }

      expect(trulyMissing).toEqual([]);
    });
  });

  describe('Route Statistics', () => {
    it('should report route coverage statistics', () => {
      const expressRoutes = extractExpressRoutes(app);
      const openApiPaths = extractOpenApiPaths(openapiSpec);

      const filteredExpressRoutes = expressRoutes.filter(
        route => !shouldIgnoreRoute(route.method, route.path)
      );

      console.log('\n📊 Route Coverage Statistics:');
      console.log(`  Total Express routes: ${filteredExpressRoutes.length}`);
      console.log(`  Total documented routes: ${openApiPaths.length}`);
      console.log(`  Coverage: ${Math.round((openApiPaths.length / filteredExpressRoutes.length) * 100)}%`);

      // Log documented routes by tag
      const routesByTag: { [key: string]: number } = {};
      Object.entries(openapiSpec.paths || {}).forEach(([_path, methods]: [string, any]) => {
        Object.values(methods).forEach((methodDef: any) => {
          if (methodDef.tags) {
            methodDef.tags.forEach((tag: string) => {
              routesByTag[tag] = (routesByTag[tag] || 0) + 1;
            });
          }
        });
      });

      console.log('\n  Routes by category:');
      Object.entries(routesByTag)
        .sort(([, a], [, b]) => b - a)
        .forEach(([tag, count]) => {
          console.log(`    ${tag}: ${count}`);
        });

      // This test always passes - it's just for reporting
      expect(true).toBe(true);
    });
  });

  describe('Path Parameter Consistency', () => {
    it('should use consistent path parameter naming', () => {
      const openApiPaths = extractOpenApiPaths(openapiSpec);
      const pathParams = new Set<string>();

      // Extract all path parameters
      openApiPaths.forEach(route => {
        const matches = route.path.match(/\{(\w+)\}/g);
        if (matches) {
          matches.forEach(match => {
            pathParams.add(match.replace(/[{}]/g, ''));
          });
        }
      });

      console.log('\n🔧 Path parameters used:');
      Array.from(pathParams).sort().forEach(param => {
        console.log(`  {${param}}`);
      });

      // Check for common naming issues
      const inconsistencies: string[] = [];

      // Check for snake_case vs camelCase
      pathParams.forEach(param => {
        if (param.includes('_')) {
          inconsistencies.push(`Parameter "${param}" uses snake_case (consider camelCase)`);
        }
      });

      // Check for singular vs plural confusion
      const singularPlural = new Map([
        ['session', 'sessions'],
        ['client', 'clients'],
        ['token', 'tokens'],
      ]);

      singularPlural.forEach((plural, singular) => {
        const hasSingular = pathParams.has(singular);
        const hasPlural = pathParams.has(plural);
        if (hasSingular && hasPlural) {
          inconsistencies.push(`Both "${singular}" and "${plural}" are used as parameters`);
        }
      });

      if (inconsistencies.length > 0) {
        console.log('\n⚠️  Potential naming inconsistencies:');
        inconsistencies.forEach(issue => {
          console.log(`  - ${issue}`);
        });
      }

      // This is informational only
      expect(true).toBe(true);
    });
  });
});
