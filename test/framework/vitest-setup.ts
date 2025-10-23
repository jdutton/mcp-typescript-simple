/**
 * Vitest Setup - Jest Compatibility
 *
 * Provides Jest API compatibility for Vitest.
 * Maps `jest` global to Vitest's `vi` for seamless migration.
 */

import { vi } from 'vitest';

// Map jest global to vi for Jest API compatibility
globalThis.jest = vi;
