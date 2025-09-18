#!/usr/bin/env npx tsx

console.log('🔍 Environment Test');
console.log('==================');
console.log('Node.js version:', process.version);
console.log('Platform:', process.platform);
console.log('Architecture:', process.arch);
console.log('Current working directory:', process.cwd());

// Test npm command availability
import { execSync } from 'child_process';

try {
  const npmVersion = execSync('npm --version', { encoding: 'utf8' });
  console.log('npm version:', npmVersion.trim());
} catch (error) {
  console.error('npm not available:', error);
}

// Test npx command availability
try {
  const npxVersion = execSync('npx --version', { encoding: 'utf8' });
  console.log('npx version:', npxVersion.trim());
} catch (error) {
  console.error('npx not available:', error);
}

// Test docker availability
try {
  const dockerVersion = execSync('docker --version', { encoding: 'utf8' });
  console.log('Docker version:', dockerVersion.trim());
} catch {
  console.log('Docker not available (expected in some environments)');
}

console.log('✅ Environment test completed');