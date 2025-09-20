/**
 * Summarization tool using Gemini Flash for cost-effective processing
 */

import { z } from 'zod';
import { LLMManager } from '../../llm/manager.js';
import { AnyModel } from '../../llm/types.js';

export const SummarizeToolSchema = z.object({
  text: z.string().describe('The text to summarize'),
  length: z.enum(['brief', 'medium', 'detailed']).optional()
    .describe('Length of summary (default: medium)'),
  format: z.enum(['paragraph', 'bullets', 'outline']).optional()
    .describe('Format of the summary (default: paragraph)'),
  focus: z.string().optional().describe('Specific aspect to focus the summary on'),
  provider: z.enum(['claude', 'openai', 'gemini']).optional().describe('LLM provider to use (default: gemini)'),
  model: z.string().optional().describe('Specific model to use. Must be valid for the selected provider.')
});

export type SummarizeToolInput = z.infer<typeof SummarizeToolSchema>;

export async function handleSummarizeTool(
  input: SummarizeToolInput,
  llmManager: LLMManager
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const length = input.length || 'medium';
    const format = input.format || 'paragraph';

    const lengthInstructions = {
      brief: 'Create a very concise summary in 1-2 sentences.',
      medium: 'Create a balanced summary in 2-4 sentences.',
      detailed: 'Create a comprehensive summary in multiple paragraphs.'
    };

    const formatInstructions = {
      paragraph: 'Format as flowing prose paragraphs.',
      bullets: 'Format as bullet points highlighting key information.',
      outline: 'Format as a structured outline with main points and sub-points.'
    };

    let systemPrompt = `You are an expert summarizer. ${lengthInstructions[length]} ${formatInstructions[format]}`;

    if (input.focus) {
      systemPrompt += ` Focus especially on: ${input.focus}`;
    }

    systemPrompt += ' Ensure accuracy and capture the most important information.';

    // Get default provider/model for summarize tool if not specified
    const toolDefaults = llmManager.getProviderForTool('summarize');

    const response = await llmManager.complete({
      message: `Please summarize the following text:\n\n${input.text}`,
      systemPrompt,
      temperature: 0.3, // Lower temperature for consistent summarization
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
        text: `Summarization failed: ${errorMessage}`
      }]
    };
  }
}