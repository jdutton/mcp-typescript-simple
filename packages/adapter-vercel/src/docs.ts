/**
 * Documentation endpoints for Vercel deployment
 * Serves OpenAPI spec, Swagger UI, and Redoc
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'yaml';
import { logger } from '@mcp-typescript-simple/observability/logger';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    // Only allow GET requests
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Parse the URL path to determine the docs endpoint
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const pathname = url.pathname;

    logger.debug("Docs request received", { method: req.method, path: pathname });

    // Load OpenAPI specification
    const openapiPath = join(process.cwd(), 'openapi.yaml');
    const openapiYaml = readFileSync(openapiPath, 'utf-8');
    const openapiSpec = yaml.parse(openapiYaml);

    // Homepage at / (root)
    if (pathname === '/' || pathname === '') {
      const acceptHeader = req.headers.accept || '';

      // Load homepage content
      let homepageMd: string | null = null;
      let homepageHtml: string | null = null;

      try {
        const homepageMdPath = join(process.cwd(), 'docs', 'homepage.md');
        homepageMd = readFileSync(homepageMdPath, 'utf-8');
      } catch {
        logger.warn('Homepage markdown not found');
      }

      try {
        const homepageHtmlPath = join(process.cwd(), 'public', 'index.html');
        homepageHtml = readFileSync(homepageHtmlPath, 'utf-8');
      } catch {
        logger.warn('Homepage HTML not found');
      }

      // Content negotiation
      if (acceptHeader.includes('text/markdown') || acceptHeader.includes('text/plain')) {
        if (homepageMd) {
          res.setHeader('Content-Type', 'text/markdown');
          res.status(200).send(homepageMd);
          return;
        }
        // Fallback to plain text
        res.setHeader('Content-Type', 'text/plain');
        res.status(200).send('MCP TypeScript Simple Server\n\nAPI Documentation: /docs\nSwagger UI: /api-docs\nOpenAPI Spec: /openapi.yaml\n');
        return;
      }

      // Default to HTML
      if (homepageHtml) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(200).send(homepageHtml);
        return;
      }

      // Fallback HTML
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(`
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
      return;
    }

    // OpenAPI spec in YAML format
    if (pathname === '/openapi.yaml') {
      res.setHeader('Content-Type', 'text/yaml');
      res.status(200).send(openapiYaml);
      return;
    }

    // OpenAPI spec in JSON format
    if (pathname === '/openapi.json') {
      res.status(200).json(openapiSpec);
      return;
    }

    // Redoc documentation at /docs
    if (pathname === '/docs') {
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

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(redocHtml);
      return;
    }

    // Swagger UI at /api-docs
    if (pathname === '/api-docs' || pathname === '/api-docs/') {
      const specJson = JSON.stringify(openapiSpec);
      const swaggerHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MCP TypeScript Simple API Documentation</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    html {
      box-sizing: border-box;
      overflow: -moz-scrollbars-vertical;
      overflow-y: scroll;
    }
    *,
    *:before,
    *:after {
      box-sizing: inherit;
    }
    body {
      margin: 0;
      padding: 0;
    }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      const spec = ${specJson};

      window.ui = SwaggerUIBundle({
        spec: spec,
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true,
        syntaxHighlight: {
          activated: true,
          theme: "agate"
        }
      });
    };
  </script>
</body>
</html>
      `.trim();

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(swaggerHtml);
      return;
    }

    // If no matching endpoint found, return 404
    res.status(404).json({
      error: 'Not found',
      message: `Documentation endpoint not found: ${pathname}`,
      available_endpoints: ['/', '/docs', '/api-docs', '/openapi.yaml', '/openapi.json']
    });

  } catch (error) {
    logger.error("Documentation endpoint error", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Documentation endpoint failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}
