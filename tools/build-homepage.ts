#!/usr/bin/env node
/**
 * Simple markdown-to-HTML converter for homepage
 * Converts docs/homepage.md → public/index.html
 *
 * Features:
 * - Minimal dependencies (uses Node.js built-ins only)
 * - Simple markdown parsing (headings, lists, links, code blocks)
 * - Clean, readable HTML output
 * - GitHub-flavored styling
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Simple markdown to HTML converter
function convertMarkdown(md: string): string {
  let html = md;

  // Code blocks (fenced with ```)
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    const language = lang || 'plaintext';
    return `<pre><code class="language-${language}">${escapeHtml(code.trim())}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Lists (simple unordered lists)
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');

  // Paragraphs (lines not already in tags)
  html = html.split('\n\n').map(block => {
    if (!block.match(/^<(h[1-6]|ul|pre|hr|li)/)) {
      return `<p>${block.trim()}</p>`;
    }
    return block;
  }).join('\n');

  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateHTML(markdownContent: string): string {
  const htmlBody = convertMarkdown(markdownContent);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="MCP TypeScript Simple Server - Production-ready Model Context Protocol server">
  <title>MCP TypeScript Simple Server</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
      line-height: 1.6;
      color: #24292e;
      background: #ffffff;
      max-width: 900px;
      margin: 0 auto;
      padding: 2rem 1rem;
    }

    h1 {
      font-size: 2.5rem;
      margin-bottom: 0.5rem;
      color: #1a1a1a;
      border-bottom: 3px solid #0366d6;
      padding-bottom: 0.5rem;
    }

    h2 {
      font-size: 1.8rem;
      margin-top: 2rem;
      margin-bottom: 1rem;
      color: #1a1a1a;
      border-bottom: 1px solid #e1e4e8;
      padding-bottom: 0.3rem;
    }

    h3 {
      font-size: 1.4rem;
      margin-top: 1.5rem;
      margin-bottom: 0.75rem;
      color: #1a1a1a;
    }

    p {
      margin-bottom: 1rem;
      line-height: 1.7;
    }

    a {
      color: #0366d6;
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    code {
      background: #f6f8fa;
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
      font-size: 0.9em;
    }

    pre {
      background: #f6f8fa;
      border-radius: 6px;
      padding: 1rem;
      overflow-x: auto;
      margin: 1rem 0;
      border: 1px solid #e1e4e8;
    }

    pre code {
      background: none;
      padding: 0;
      font-size: 0.85em;
    }

    ul {
      margin: 1rem 0;
      padding-left: 2rem;
    }

    li {
      margin-bottom: 0.5rem;
    }

    hr {
      border: none;
      border-top: 1px solid #e1e4e8;
      margin: 2rem 0;
    }

    strong {
      font-weight: 600;
      color: #1a1a1a;
    }

    @media (max-width: 768px) {
      body {
        padding: 1rem;
      }

      h1 {
        font-size: 2rem;
      }

      h2 {
        font-size: 1.5rem;
      }

      h3 {
        font-size: 1.2rem;
      }
    }
  </style>
</head>
<body>
  ${htmlBody}
</body>
</html>`;
}

// Main execution
try {
  console.log('Building homepage from docs/homepage.md...');

  const inputFile = join(rootDir, 'docs', 'homepage.md');
  const outputDir = join(rootDir, 'public');
  const outputFile = join(outputDir, 'index.html');

  // Read markdown
  const markdown = readFileSync(inputFile, 'utf-8');

  // Convert to HTML
  const html = generateHTML(markdown);

  // Ensure output directory exists
  mkdirSync(outputDir, { recursive: true });

  // Write HTML
  writeFileSync(outputFile, html, 'utf-8');

  console.log(`✓ Homepage built successfully: ${outputFile}`);
  console.log(`✓ Preview: file://${outputFile}`);
} catch (error) {
  console.error('Error building homepage:', error);
  process.exit(1);
}
