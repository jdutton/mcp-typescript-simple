/**
 * Summarization tool using Gemini Flash for cost-effective processing
 */

import { z } from 'zod';
import { LLMManager } from '../../llm/manager.js';
import { AnyModel, isValidModelForProvider, LLMProvider, getDefaultModelForProvider } from '../../llm/types.js';

type ToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
};

/**
 * Create dynamic schema based on available providers
 */
export async function createSummarizeToolSchema(llmManager: LLMManager) {
  const schemaInfo = await llmManager.getSchemaInfo();
  const toolDefaults = llmManager.getProviderForTool('summarize');

  // Build provider description with available options
  const providerOptions = schemaInfo.providers.map(p => p.name).join(', ');
  const providerDesc = `LLM provider to use. Available: ${providerOptions} (default: ${toolDefaults.provider})`;

  // Build model description with examples from available providers
  const modelExamples = schemaInfo.providers
    .filter(p => p.models.length > 0)
    .map(p => `${p.name}: ${p.models.slice(0, 2).join(', ')}`)
    .join('; ');
  const modelDesc = `Specific model to use. Must be valid for the selected provider. Examples: ${modelExamples}`;

  return z.object({
    text: z.string().describe('The text to summarize'),
    length: z.enum(['brief', 'medium', 'detailed']).optional()
      .describe('Length of summary. Options: brief, medium, detailed (default: medium)'),
    format: z.enum(['paragraph', 'bullets', 'outline']).optional()
      .describe('Format of the summary. Options: paragraph, bullets, outline (default: paragraph)'),
    focus: z.string().optional().describe('Specific aspect to focus the summary on'),
    provider: z.enum(schemaInfo.providers.map(p => p.name) as [LLMProvider, ...LLMProvider[]]).optional()
      .describe(providerDesc),
    model: z.string().optional().describe(modelDesc)
  });
}

// Static schema for backward compatibility and type inference
export const SummarizeToolSchema = z.object({
  text: z.string().describe('The text to summarize'),
  length: z.enum(['brief', 'medium', 'detailed']).optional()
    .describe('Length of summary. Options: brief, medium, detailed (default: medium)'),
  format: z.enum(['paragraph', 'bullets', 'outline']).optional()
    .describe('Format of the summary. Options: paragraph, bullets, outline (default: paragraph)'),
  focus: z.string().optional().describe('Specific aspect to focus the summary on'),
  provider: z.enum(['claude', 'openai', 'gemini']).optional().describe('LLM provider to use'),
  model: z.string().optional().describe('Specific model to use. Must be valid for the selected provider.')
});

export type SummarizeToolInput = z.infer<typeof SummarizeToolSchema>;

export function parseSummarizeToolInput(raw: unknown): SummarizeToolInput {
  return SummarizeToolSchema.parse(raw);
}

export async function handleSummarizeTool(
  input: SummarizeToolInput,
  llmManager: LLMManager
): Promise<ToolResponse> {
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
    const provider = input.provider || toolDefaults.provider;

    // If user specified provider without model, use that provider's default model
    let model: string | undefined;
    if (input.provider && !input.model) {
      model = getDefaultModelForProvider(input.provider);
    } else {
      model = input.model ?? toolDefaults.model;
    }

    if (model && !isValidModelForProvider(provider, model as AnyModel)) {
      throw new Error(`Model '${model}' is not valid for provider '${provider}'`);
    }

    const response = await llmManager.complete({
      message: `Please summarize the following text:\n\n${input.text}`,
      systemPrompt,
      temperature: 0.3, // Lower temperature for consistent summarization
      provider,
      model: model as AnyModel | undefined
    });

    return {
      content: [
        {
          type: 'text',
          text: response.content
        }
      ]
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Summarization failed: ${errorMessage}\n\nError details:\n- Tool: summarize\n- Code: SUMMARIZE_TOOL_ERROR`
        }
      ]
    };
  }
}
