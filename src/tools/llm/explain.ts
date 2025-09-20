/**
 * Explanation tool using Claude for clear, educational responses
 */

import { z } from 'zod';
import { LLMManager } from '../../llm/manager.js';
import { AnyModel } from '../../llm/types.js';

export const ExplainToolSchema = z.object({
  topic: z.string().describe('The topic, concept, or code to explain'),
  level: z.enum(['beginner', 'intermediate', 'advanced']).optional()
    .describe('Target audience level (default: intermediate)'),
  context: z.string().optional().describe('Additional context or specific domain'),
  include_examples: z.boolean().optional().describe('Whether to include examples (default: true)'),
  provider: z.enum(['claude', 'openai', 'gemini']).optional().describe('LLM provider to use (default: claude)'),
  model: z.string().optional().describe('Specific model to use. Must be valid for the selected provider.')
});

export type ExplainToolInput = z.infer<typeof ExplainToolSchema>;

export async function handleExplainTool(
  input: ExplainToolInput,
  llmManager: LLMManager
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const level = input.level || 'intermediate';
    const includeExamples = input.include_examples !== false;

    const levelInstructions = {
      beginner: 'Explain in simple terms, avoid jargon, and provide step-by-step breakdowns. Assume minimal prior knowledge.',
      intermediate: 'Provide a balanced explanation with moderate technical detail. Assume some foundational knowledge.',
      advanced: 'Use technical precision and dive into nuanced details. Assume strong foundational knowledge.'
    };

    let systemPrompt = `You are an expert educator and technical communicator. ${levelInstructions[level]}`;

    if (includeExamples) {
      systemPrompt += ' Include relevant examples, analogies, or code samples to illustrate key points.';
    }

    if (input.context) {
      systemPrompt += ` Consider this context: ${input.context}`;
    }

    systemPrompt += ' Make your explanation clear, accurate, and engaging.';

    // Get default provider/model for explain tool if not specified
    const toolDefaults = llmManager.getProviderForTool('explain');

    const response = await llmManager.complete({
      message: `Please explain: ${input.topic}`,
      systemPrompt,
      temperature: 0.4, // Balanced creativity and consistency
      provider: input.provider || toolDefaults.provider,
      model: (input.model as AnyModel) || toolDefaults.model
    });

    return {
      content: [{
        type: 'text',
        text: response.content
      }]
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: 'text',
        text: `Explanation failed: ${errorMessage}`
      }]
    };
  }
}