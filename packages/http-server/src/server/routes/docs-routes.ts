/**
 * Documentation routes - OpenAPI Swagger UI and Redoc
 */

import { Express, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { readFileSync } from 'fs';
import { join } from 'path';
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

    logger.info('OpenAPI specification loaded', { path: openapiPath });

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
    // Use inline spec for Safari compatibility
    app.get('/api-docs', swaggerUi.setup(openapiSpec, swaggerOptions));
    app.use('/api-docs', swaggerUi.serve);

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
      routes: ['/openapi.yaml', '/openapi.json', '/api-docs', '/docs']
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to setup documentation routes', { error: errorMessage });
    throw error;
  }
}