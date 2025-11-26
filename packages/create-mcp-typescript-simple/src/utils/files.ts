import fs from 'fs-extra';
import path from 'node:path';
import Handlebars from 'handlebars';
import type { TemplateData, TemplateFile } from '../types.js';

// Register Handlebars helpers
Handlebars.registerHelper('add', (a: number, b: number) => a + b);

/**
 * Copy a file from source to destination
 */
export async function copyFile(source: string, destination: string): Promise<void> {
  await fs.copy(source, destination);
}

/**
 * Render a Handlebars template file
 */
export async function renderTemplate(
  templatePath: string,
  destination: string,
  data: TemplateData
): Promise<void> {
  // Read template file
  const templateContent = await fs.readFile(templatePath, 'utf-8');

  // Compile and render template
  const template = Handlebars.compile(templateContent);
  const rendered = template(data);

  // Write rendered content
  await fs.writeFile(destination, rendered, 'utf-8');
}

/**
 * Ensure directory exists
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.ensureDir(dirPath);
}

/**
 * Check if directory exists and is not empty
 */
export async function isDirNonEmpty(dirPath: string): Promise<boolean> {
  try {
    const files = await fs.readdir(dirPath);
    return files.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get absolute path to templates directory
 */
export function getTemplatesDir(): string {
  // templates/ is at the same level as dist/ in the published package
  // __dirname in ESM points to dist/utils/
  return path.resolve(import.meta.url.replace('file://', ''), '../../../templates');
}

/**
 * Process all template files for a project
 */
export async function processTemplateFiles(
  files: TemplateFile[],
  projectPath: string,
  data: TemplateData
): Promise<void> {
  const templatesDir = getTemplatesDir();

  for (const file of files) {
    const sourcePath = path.join(templatesDir, file.source);
    const destPath = path.join(projectPath, file.destination);

    // Ensure destination directory exists
    await ensureDir(path.dirname(destPath));

    // Render template or copy file
    if (file.isTemplate) {
      await renderTemplate(sourcePath, destPath, data);
    } else {
      await copyFile(sourcePath, destPath);
    }
  }
}

/**
 * Make file executable (for CLI bin files)
 */
export async function makeExecutable(filePath: string): Promise<void> {
  // eslint-disable-next-line sonarjs/file-permissions -- 0o755 is correct for CLI executables (rwxr-xr-x)
  await fs.chmod(filePath, 0o755);
}
