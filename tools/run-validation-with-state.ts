#!/usr/bin/env tsx
/**
 * Validation Runner with State Tracking
 *
 * Wrapper around npm run validate that captures output and writes state file.
 * This replaces the postvalidate hook approach since we need to capture output.
 *
 * Usage: npm run validate (calls this script)
 */

import { execSync } from 'child_process';
import { writeFileSync, appendFileSync, existsSync, readFileSync } from 'fs';
import yaml from 'js-yaml';
import { ValidationStateWriter, ValidationState } from './write-validation-state.js';

// Validation steps to run in sequence
const VALIDATION_STEPS = [
  { name: 'TypeScript type checking', command: 'npm run typecheck' },
  { name: 'ESLint code checking', command: 'npm run lint' },
  { name: 'Unit tests', command: 'npm run test:unit' },
  { name: 'Build', command: 'npm run build' },
  { name: 'OpenAPI validation', command: 'npm run test:openapi' },
  { name: 'Integration tests', command: 'npm run test:integration' },
  { name: 'STDIO system tests', command: 'npm run test:system:stdio' },
  { name: 'HTTP system tests', command: 'npm run test:system:ci' }
];

/**
 * Get working tree hash (includes all changes - staged, unstaged, untracked)
 */
function getWorkingTreeHash(): string {
  try {
    // Use git stash create to include ALL working tree changes
    const stashHash = execSync('git stash create', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();

    // If no changes, fall back to HEAD tree
    if (!stashHash) {
      return execSync('git rev-parse HEAD^{tree}', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
    }

    // Extract tree hash from stash commit
    return execSync(`git rev-parse ${stashHash}^{tree}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
  } catch (error) {
    return `nogit-${Date.now()}`;
  }
}

/**
 * Check if validation has already passed for current working tree state
 */
function checkExistingValidation(currentTreeHash: string): { alreadyPassed: boolean; state?: ValidationState } {
  const stateFile = '.validation-state.yaml';

  if (!existsSync(stateFile)) {
    return { alreadyPassed: false };
  }

  try {
    const content = readFileSync(stateFile, 'utf8');
    const state = yaml.load(content) as ValidationState;

    // Check if validation passed and tree hash matches
    if (state.passed && state.treeHash === currentTreeHash) {
      return { alreadyPassed: true, state };
    }

    return { alreadyPassed: false, state };
  } catch (error) {
    return { alreadyPassed: false };
  }
}

/**
 * Parse test output to extract specific failures
 */
function parseFailures(output: string, stepName: string): string[] {
  const failures: string[] = [];

  // Jest test failures - extract test names
  const jestFailures = output.match(/● .+/g);
  if (jestFailures) {
    failures.push(...jestFailures.slice(0, 10)); // Limit to first 10
  }

  // TypeScript errors - extract file:line
  const tsErrors = output.match(/[^(]+\(\d+,\d+\): error TS\d+:.+/g);
  if (tsErrors) {
    failures.push(...tsErrors.slice(0, 10).map(e => e.trim()));
  }

  // ESLint errors - extract file:line
  const eslintErrors = output.match(/\S+\.ts\(\d+,\d+\): .+/g);
  if (eslintErrors) {
    failures.push(...eslintErrors.slice(0, 10).map(e => e.trim()));
  }

  return failures;
}

async function main(): Promise<void> {
  // Check for --force flag
  const args = process.argv.slice(2);
  const forceValidation = args.includes('--force') || args.includes('-f');

  // Get current working tree hash (includes all changes)
  const currentTreeHash = getWorkingTreeHash();

  // Check if validation already passed for this exact code state
  if (!forceValidation) {
    const { alreadyPassed, state } = checkExistingValidation(currentTreeHash);

    if (alreadyPassed && state) {
      console.log('✅ Validation already passed for current working tree state');
      console.log(`   Tree hash: ${currentTreeHash.substring(0, 12)}...`);
      console.log(`   Last validated: ${state.timestamp}`);
      console.log('');
      console.log('💡 All validation steps passed previously for this exact code state.');
      console.log('   No need to re-run validation.');
      console.log('');
      console.log('   To force re-validation: npm run validate -- --force');
      console.log('='.repeat(60));
      process.exit(0);
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = `/tmp/mcp-validation-${timestamp}.log`;

  console.log('🚀 Validation with State Tracking');
  console.log('='.repeat(60));
  console.log('\nThis will run the following validation steps:');
  console.log('');

  // Find the longest step name for alignment
  const maxNameLength = Math.max(...VALIDATION_STEPS.map(s => s.name.length));

  // Calculate number width (for "1." "2." etc)
  const maxNumWidth = VALIDATION_STEPS.length.toString().length + 2; // "8. " = 3 chars

  VALIDATION_STEPS.forEach((step, i) => {
    const numPrefix = `${i + 1}.`.padEnd(maxNumWidth);
    const paddedName = step.name.padEnd(maxNameLength);
    console.log(`  ${numPrefix}${paddedName}  →  ${step.command}`);
  });

  console.log('');
  console.log('📝 Writing state to: .validation-state.yaml');
  console.log(`📋 Writing output to: ${logPath}`);
  console.log(`💡 Monitor progress: tail -f ${logPath}`);
  console.log('='.repeat(60));
  console.log('');

  // Initialize log file
  writeFileSync(logPath, `Validation started at ${new Date().toISOString()}\n\n`);

  let validationPassed = true;
  let fullOutput = '';
  let failedStep: string | null = null;

  // Run each validation step
  for (const step of VALIDATION_STEPS) {
    console.log(`🔍 Running: ${step.name}...`);

    try {
      const output = execSync(step.command, {
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, FORCE_COLOR: '0' }
      });

      // Append to log file
      appendFileSync(logPath, `\n${'='.repeat(60)}\n`);
      appendFileSync(logPath, `${step.name}\n`);
      appendFileSync(logPath, `${'='.repeat(60)}\n`);
      appendFileSync(logPath, output);

      fullOutput += output;
      console.log(`   ✅ ${step.name} - PASSED`);

    } catch (error: any) {
      // Step failed
      const failedStepOutput = (error.stdout || '') + (error.stderr || '');

      // Append to log file
      appendFileSync(logPath, `\n${'='.repeat(60)}\n`);
      appendFileSync(logPath, `${step.name} - FAILED\n`);
      appendFileSync(logPath, `${'='.repeat(60)}\n`);
      appendFileSync(logPath, failedStepOutput);

      fullOutput += failedStepOutput;
      validationPassed = false;
      failedStep = step.name;

      console.log(`   ❌ ${step.name} - FAILED`);
      console.log('');
      console.log('='.repeat(60));
      console.log(`❌ Validation failed at: ${step.name}`);
      console.log('='.repeat(60));
      console.log('');

      // Parse and show specific failures
      const failures = parseFailures(failedStepOutput, step.name);
      if (failures.length > 0) {
        console.log('Failed tests:');
        failures.forEach(failure => console.log(`   • ${failure}`));
        console.log('');
      }

      console.log(`📋 Full output: cat ${logPath}`);
      console.log(`🔍 Run just this step: ${step.command}`);
      console.log('');

      // Write validation state with failure (quiet mode - no duplicate output)
      // Pass failed step output directly - no need to read log file!
      const writer = new ValidationStateWriter();
      await writer.writeStateWithResults(
        validationPassed,
        logPath,
        fullOutput,
        true,  // quiet mode
        step.name,  // failedStep
        step.command,  // rerunCommand
        failedStepOutput  // failedStepOutput - embedded in YAML!
      );

      process.exit(1);
    }
  }

  // All steps passed!
  console.log('');
  console.log('='.repeat(60));
  console.log('✅ All validation steps PASSED!');
  console.log('='.repeat(60));

  // Write validation state with success (quiet mode - no extra output)
  const writer = new ValidationStateWriter();
  await writer.writeStateWithResults(validationPassed, null, fullOutput, true);
}

main().catch((error) => {
  console.error('❌ Validation runner failed:', error);
  process.exit(1);
});
