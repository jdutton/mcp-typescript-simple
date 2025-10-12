/**
 * Validation Configuration - Single Source of Truth
 *
 * This file defines ALL validation steps for both local and CI validation.
 * - Local: tools/run-validation-with-state.ts uses this for parallel execution
 * - CI: tools/generate-validate-workflow.ts generates .github/workflows/validate.yml
 *
 * @extraction-target @agentic-workflow
 */

export interface ValidationStep {
  name: string;           // Human-readable step name
  command: string;        // npm script or command to run
  ciJob: string;          // GitHub Actions job name (lowercase-with-hyphens)
  requiresSecrets?: boolean;  // True if step needs API keys
}

export interface ValidationPhase {
  name: string;
  parallel: boolean;      // Run steps in parallel?
  dependsOn?: string[];   // Phase names this phase depends on
  steps: ValidationStep[];
}

/**
 * Validation Phases - Executed in Order
 *
 * Phase 1: Fast Pre-Qualification + Build (all parallel)
 * - Quick checks that catch most issues (typecheck, lint, openapi)
 * - Build (needed for integration tests)
 * - Total time: ~60s (longest step determines phase time)
 *
 * Phase 2: Comprehensive Testing (all parallel)
 * - All test suites run simultaneously
 * - Total time: ~300s (longest test suite determines phase time)
 *
 * Total validation time: ~6 minutes (Phase 1 + Phase 2)
 */
export const VALIDATION_PHASES: ValidationPhase[] = [
  {
    name: 'Phase 1: Pre-Qualification + Build',
    parallel: true,
    steps: [
      {
        name: 'TypeScript type checking',
        command: 'npm run typecheck',
        ciJob: 'typecheck'
      },
      {
        name: 'ESLint code checking',
        command: 'npm run lint',
        ciJob: 'lint'
      },
      {
        name: 'OpenAPI validation',
        command: 'npm run test:openapi',
        ciJob: 'openapi'
      },
      {
        name: 'Build',
        command: 'npm run build',
        ciJob: 'build'
      }
    ]
  },
  {
    name: 'Phase 2: Testing',
    parallel: true,
    dependsOn: ['Phase 1: Pre-Qualification + Build'],
    steps: [
      {
        name: 'Unit tests',
        command: 'npm run test:unit',
        ciJob: 'unit-tests',
        requiresSecrets: true
      },
      {
        name: 'Integration tests',
        command: 'npm run test:integration',
        ciJob: 'integration-tests'
      },
      {
        name: 'STDIO system tests',
        command: 'npm run test:system:stdio',
        ciJob: 'stdio-tests'
      },
      {
        name: 'HTTP system tests',
        command: 'npm run test:system:ci',
        ciJob: 'http-tests'
      },
      {
        name: 'Headless browser tests',
        command: 'npm run test:system:headless',
        ciJob: 'headless-tests'
      }
    ]
  }
];

/**
 * Get all validation steps in flat array (for logging/reporting)
 */
export function getAllSteps(): ValidationStep[] {
  return VALIDATION_PHASES.flatMap(phase => phase.steps);
}

/**
 * Get all CI job names (for GitHub Actions workflow generation)
 */
export function getAllCIJobs(): string[] {
  return getAllSteps().map(step => step.ciJob);
}

/**
 * Get phase 1 job names (for GitHub Actions dependencies)
 */
export function getPhase1Jobs(): string[] {
  const phase1 = VALIDATION_PHASES.find(p => p.name.includes('Phase 1'));
  return phase1 ? phase1.steps.map(s => s.ciJob) : [];
}
