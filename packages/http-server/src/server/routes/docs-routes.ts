/**
 * Documentation routes - OpenAPI Swagger UI and Redoc
 */

import { Express, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'yaml';
import { logger } from '@mcp-typescript-simple/observability';

/**
 * Setup documentation routes for OpenAPI spec, Swagger UI, and Redoc
 */
export function setupDocsRoutes(app: Express): void {
  try {
    // Load OpenAPI specification from project root
    const openapiPath = join(process.cwd(), 'openapi.yaml');
    const openapiYaml = readFileSync(openapiPath, 'utf-8');
    const openapiSpec = yaml.parse(openapiYaml);

    // Load homepage content
    const homepageMdPath = join(process.cwd(), 'docs', 'homepage.md');
    const homepageHtmlPath = join(process.cwd(), 'public', 'index.html');
    let homepageMd: string | null = null;
    let homepageHtml: string | null = null;

    try {
      homepageMd = readFileSync(homepageMdPath, 'utf-8');
    } catch {
      logger.warn('Homepage markdown not found', { path: homepageMdPath });
    }

    try {
      homepageHtml = readFileSync(homepageHtmlPath, 'utf-8');
    } catch {
      logger.warn('Homepage HTML not found', { path: homepageHtmlPath });
    }

    logger.info('OpenAPI specification loaded', { path: openapiPath });

    // Serve homepage at / with content negotiation
    app.get('/', (req: Request, res: Response) => {
      const acceptHeader = req.get('accept') || '';

      // If client explicitly requests markdown, send markdown
      if (acceptHeader.includes('text/markdown') || acceptHeader.includes('text/plain')) {
        if (homepageMd) {
          res.type('text/markdown');
          res.send(homepageMd);
          return;
        }
        // Fallback to simple text response if markdown not available
        res.type('text/plain');
        res.send('MCP TypeScript Simple Server\n\nAPI Documentation: /docs\nSwagger UI: /api-docs\nOpenAPI Spec: /openapi.yaml\n');
        return;
      }

      // Default to HTML for browsers
      if (homepageHtml) {
        res.type('text/html');
        res.send(homepageHtml);
        return;
      }

      // Fallback to simple HTML if homepage not built
      res.type('text/html');
      res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MCP TypeScript Simple Server</title>
</head>
<body>
  <h1>MCP TypeScript Simple Server</h1>
  <p>API is running. Documentation available at:</p>
  <ul>
    <li><a href="/docs">API Reference (Redoc)</a></li>
    <li><a href="/api-docs">Try it out (Swagger UI)</a></li>
    <li><a href="/openapi.yaml">OpenAPI Specification (YAML)</a></li>
  </ul>
</body>
</html>
      `.trim());
    });

    // Serve OpenAPI spec in YAML format
    app.get('/openapi.yaml', (_req: Request, res: Response) => {
      res.type('text/yaml');
      res.send(openapiYaml);
    });

    // Serve OpenAPI spec in JSON format
    app.get('/openapi.json', (_req: Request, res: Response) => {
      res.json(openapiSpec);
    });

    // Swagger UI options
    const swaggerOptions: swaggerUi.SwaggerUiOptions = {
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'MCP TypeScript Simple API Documentation',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true,
        // Safari compatibility
        syntaxHighlight: {
          activated: true,
          theme: 'agate'
        },
      },
      customCssUrl: undefined, // Ensure no external CSS that Safari might block
    };

    // Serve Swagger UI at /api-docs
    // IMPORTANT: serve middleware must come BEFORE setup to prevent default redirects
    app.use('/api-docs', swaggerUi.serve);
    app.get('/api-docs', swaggerUi.setup(openapiSpec, swaggerOptions));

    // Serve Redoc at /docs
    app.get('/docs', (_req: Request, res: Response) => {
      // Inline the spec to avoid Safari fetch issues
      const specJson = JSON.stringify(openapiSpec);

      const redocHtml = `
<!DOCTYPE html>
<html>
  <head>
    <title>MCP TypeScript Simple API Reference</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
    <style>
      body {
        margin: 0;
        padding: 0;
      }
      .api-docs-link {
        position: fixed;
        top: 10px;
        right: 10px;
        padding: 10px 20px;
        background: #4990e2;
        color: white;
        text-decoration: none;
        border-radius: 4px;
        font-family: 'Roboto', sans-serif;
        font-size: 14px;
        font-weight: 500;
        z-index: 1000;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        transition: background 0.2s;
      }
      .api-docs-link:hover {
        background: #357abd;
      }
    </style>
  </head>
  <body>
    <a href="/api-docs/" class="api-docs-link">Try it out (Swagger UI) →</a>
    <div id="redoc-container"></div>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
    <script>
      // Initialize Redoc with inline spec and disable workers for Safari compatibility
      Redoc.init(${specJson}, {
        disableSearch: false,
        hideDownloadButton: false,
        noAutoAuth: false,
        scrollYOffset: 0,
        suppressWarnings: true,
        // Disable workers for Safari compatibility on localhost
        disableWorker: true
      }, document.getElementById('redoc-container'));
    </script>
  </body>
</html>
      `.trim();

      // Set explicit content type for better browser compatibility
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(redocHtml);
    });

    logger.info('Documentation routes registered', {
      routes: ['/', '/openapi.yaml', '/openapi.json', '/api-docs', '/docs']
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to setup documentation routes', { error: errorMessage });
    throw error;
  }
}