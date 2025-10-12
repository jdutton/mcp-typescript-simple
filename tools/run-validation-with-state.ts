#!/usr/bin/env tsx
/**
 * Validation Runner with State Tracking
 *
 * Wrapper around npm run validate that captures output and writes state file.
 * This replaces the postvalidate hook approach since we need to capture output.
 *
 * Usage: npm run validate (calls this script)
 *
 * @extraction-target @agentic-workflow
 *
 * This file is part of the validation system designed for extraction to the
 * @agentic-workflow npm package. Key features for extraction:
 *
 * 1. **Git Tree Hash Caching**: Deterministic content-based hashing
 *    - Skip validation if code unchanged (massive time savings)
 *    - Detect reverts to previously-validated states
 *    - See: getWorkingTreeHash() and docs/architecture/validation-concurrency.md
 *
 * 2. **Concurrent Validation Detection**: Simple detection with user choice
 *    - Warn users of simultaneous runs (avoid duplicate work)
 *    - Best-effort locking (fails safe, no blocking)
 *    - Auto-cleanup stale locks (PID validation)
 *    - See: docs/architecture/validation-concurrency.md for design details
 *
 * 3. **Agent-Friendly Design**: Context-aware behavior
 *    - Human context: Interactive prompts
 *    - Agent context: Auto-proceed after delay
 *    - CI context: Skip unnecessary checks
 *    - Structured output (YAML) for agent consumption
 *
 * 4. **Fail-Safe Philosophy**: Validation always proceeds
 *    - Lock creation failure → proceed without lock
 *    - Corrupted state file → proceed with validation
 *    - Git command failure → use timestamp fallback
 *    - Never block the user
 *
 * Architecture documentation: docs/architecture/validation-concurrency.md
 * Extraction plan: docs/agentic-workflow-extraction.md
 */

import { execSync, spawn } from 'child_process';
import { writeFileSync, appendFileSync, existsSync, readFileSync } from 'fs';
import yaml from 'js-yaml';
import { ValidationStateWriter, ValidationState, PhaseResult } from './write-validation-state.js';
import { VALIDATION_PHASES, ValidationPhase, ValidationStep } from './validation-config.js';

// Check if GitHub workflow is in sync
async function checkWorkflowSync(): Promise<{ inSync: boolean; error?: string }> {
  try {
    const result = execSync('npm run validate:check-workflow-sync', {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    return { inSync: true };
  } catch (error: any) {
    return {
      inSync: false,
      error: error.stdout || error.message
    };
  }
}

/**
 * Get working tree hash (includes all changes - staged, unstaged, untracked)
 *
 * IMPORTANT: This implementation uses `git stash create` which includes timestamps
 * in the commit object. This means identical code produces DIFFERENT hashes on
 * different runs, breaking revert-to-previous-state detection.
 *
 * TODO: Replace with deterministic git write-tree approach:
 *   git add --intent-to-add .  # Mark untracked files (no staging)
 *   git write-tree              # Get content-based hash (no timestamps)
 *   git reset                   # Restore original index state
 *
 * See docs/architecture/validation-concurrency.md for full explanation and design rationale.
 *
 * @returns SHA-1 hash representing working tree state (currently non-deterministic)
 *
 * @extraction-note For @agentic-workflow package:
 *   - Make this deterministic (use git write-tree)
 *   - Add unit tests for hash determinism
 *   - Document cross-platform compatibility
 *   - Add fallback for non-git repos
 */
function getWorkingTreeHash(): string {
  try {
    // Use git stash create to include ALL working tree changes
    // WARNING: This creates commit objects with timestamps (non-deterministic)
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
    // Fallback for non-git repos or git command failures
    return `nogit-${Date.now()}`;
  }
}

/**
 * Check if validation has already passed for current working tree state
 */
function checkExistingValidation(currentTreeHash: string): { alreadyPassed: boolean; state?: ValidationState } {
  const stateFile = '.validate-state.yaml';

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

/**
 * Run validation steps in parallel
 */
async function runStepsInParallel(
  steps: ValidationStep[],
  phaseName: string,
  logPath: string
): Promise<{
  success: boolean;
  failedStep?: ValidationStep;
  outputs: Map<string, string>;
  stepResults: { name: string; passed: boolean; duration: number }[];
}> {
  console.log(`\n🔍 Running ${phaseName} (${steps.length} steps in parallel)...`);

  // Find longest step name for alignment
  const maxNameLength = Math.max(...steps.map(s => s.name.length));

  const outputs = new Map<string, string>();
  const stepResults: { name: string; passed: boolean; duration: number }[] = [];

  const results = await Promise.allSettled(
    steps.map(step =>
      new Promise<{ step: ValidationStep; output: string; duration: number }>((resolve, reject) => {
        const paddedName = step.name.padEnd(maxNameLength);
        console.log(`   ⏳ ${paddedName}  →  ${step.command}`);

        const startTime = Date.now();
        const proc = spawn('sh', ['-c', step.command], {
          stdio: 'pipe',
          env: { ...process.env, FORCE_COLOR: '0' }
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', data => { stdout += data.toString(); });
        proc.stderr.on('data', data => { stderr += data.toString(); });

        proc.on('close', code => {
          const duration = Date.now() - startTime;
          const output = stdout + stderr;
          outputs.set(step.name, output);

          const durationSec = (duration / 1000).toFixed(1);
          const status = code === 0 ? '✅' : '❌';
          const result = code === 0 ? 'PASSED' : 'FAILED';
          console.log(`      ${status} ${step.name.padEnd(maxNameLength)} - ${result} (${durationSec}s)`);

          stepResults.push({ name: step.name, passed: code === 0, duration });

          if (code === 0) {
            resolve({ step, output, duration });
          } else {
            reject({ step, output, duration });
          }
        });
      })
    )
  );

  // Check for failures
  for (const result of results) {
    if (result.status === 'rejected') {
      const { step, output } = result.reason;
      return { success: false, failedStep: step, outputs, stepResults };
    }
  }

  return { success: true, outputs, stepResults };
}

async function main(): Promise<void> {
  // Check for --force flag
  const args = process.argv.slice(2);
  const forceValidation = args.includes('--force') || args.includes('-f');

  // Step 0: Check if GitHub workflow is in sync
  console.log('🔍 Checking GitHub workflow sync...');
  const syncCheck = await checkWorkflowSync();
  if (!syncCheck.inSync) {
    console.log('');
    console.log('❌ GitHub workflow out of sync with validation config!');
    console.log('');
    console.log(syncCheck.error || 'Run: npm run validate:generate-workflow');
    console.log('');
    process.exit(1);
  }
  console.log('   ✅ GitHub workflow is in sync');

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

  console.log('🚀 Parallel Validation Pipeline');
  console.log('='.repeat(60));
  console.log('\nValidation Phases:');

  VALIDATION_PHASES.forEach((phase, i) => {
    console.log(`\n${phase.name}:`);
    phase.steps.forEach(step => {
      console.log(`  • ${step.name}`);
    });
  });

  console.log('');
  console.log('📝 Writing state to: .validate-state.yaml');
  console.log(`📋 Writing output to: ${logPath}`);
  console.log(`💡 Monitor progress: tail -f ${logPath}`);
  console.log('='.repeat(60));

  // Initialize log file
  writeFileSync(logPath, `Validation started at ${new Date().toISOString()}\n\n`);

  let validationPassed = true;
  let fullOutput = '';
  let failedStep: ValidationStep | null = null;
  const phaseResults: PhaseResult[] = [];

  // Run each phase
  for (const phase of VALIDATION_PHASES) {
    const phaseStartTime = Date.now();
    const result = await runStepsInParallel(phase.steps, phase.name, logPath);
    const phaseDuration = Date.now() - phaseStartTime;

    // Append all outputs to log file
    for (const [stepName, output] of result.outputs) {
      appendFileSync(logPath, `\n${'='.repeat(60)}\n`);
      appendFileSync(logPath, `${stepName}${result.failedStep?.name === stepName ? ' - FAILED' : ''}\n`);
      appendFileSync(logPath, `${'='.repeat(60)}\n`);
      appendFileSync(logPath, output);
      fullOutput += output;
    }

    // Record phase result
    const phaseResult: PhaseResult = {
      name: phase.name,
      duration: phaseDuration,
      passed: result.success,
      steps: result.stepResults
    };

    // If phase failed, include output
    if (!result.success && result.failedStep) {
      phaseResult.output = result.outputs.get(result.failedStep.name);
    }

    phaseResults.push(phaseResult);

    // If phase failed, stop here
    if (!result.success && result.failedStep) {
      validationPassed = false;
      failedStep = result.failedStep;

      console.log('');
      console.log('='.repeat(60));
      console.log(`❌ Validation failed at: ${failedStep.name}`);
      console.log('='.repeat(60));
      console.log('');

      const failedOutput = result.outputs.get(failedStep.name) || '';
      const failures = parseFailures(failedOutput, failedStep.name);
      if (failures.length > 0) {
        console.log('Failed tests:');
        failures.forEach(failure => console.log(`   • ${failure}`));
        console.log('');
      }

      console.log(`📋 Full output: cat ${logPath}`);
      console.log(`🔍 Run just this step: ${failedStep.command}`);
      console.log('');

      // Write validation state with failure
      const writer = new ValidationStateWriter();
      await writer.writeStateWithResults(
        validationPassed,
        logPath,
        fullOutput,
        true,  // quiet mode
        failedStep.name,
        failedStep.command,
        failedOutput,
        phaseResults
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
  await writer.writeStateWithResults(
    validationPassed,
    logPath,  // Include log file even on success
    fullOutput,
    true,  // quiet mode
    undefined,
    undefined,
    undefined,
    phaseResults  // Include phase timing
  );
}

main().catch((error) => {
  console.error('❌ Validation runner failed:', error);
  process.exit(1);
});
