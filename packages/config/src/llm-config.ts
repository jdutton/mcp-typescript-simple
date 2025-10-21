/**
 * LLM provider configuration schema
 * API keys and settings for AI model providers
 */

import { z } from 'zod';

/**
 * LLM secrets schema (API keys)
 */
export const LLMSecretsSchema = z.object({
  // LLM Provider API keys
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),

  // LLM configuration
  LLM_DEFAULT_PROVIDER: z.enum(['claude', 'openai', 'gemini']).optional(),
});

export type LLMSecrets = z.infer<typeof LLMSecretsSchema>;
