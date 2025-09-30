/**
 * Analysis tool using GPT-4 for deep reasoning
 */

import { z } from 'zod';
import { LLMManager } from '../../llm/manager.js';
import { AnyModel, isValidModelForProvider } from '../../llm/types.js';

type ToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
};

export const AnalyzeToolSchema = z.object({
  text: z.string().describe('The text to analyze'),
  analysis_type: z.enum(['sentiment', 'themes', 'structure', 'comprehensive', 'summary']).optional()
    .describe('Type of analysis to perform (default: comprehensive)'),
  focus: z.string().optional().describe('Specific aspect to focus the analysis on'),
  provider: z.enum(['claude', 'openai', 'gemini']).optional().describe('LLM provider to use (default: openai)'),
  model: z.string().optional().describe('Specific model to use. Must be valid for the selected provider.')
});

export type AnalyzeToolInput = z.infer<typeof AnalyzeToolSchema>;

export function parseAnalyzeToolInput(raw: unknown): AnalyzeToolInput {
  return AnalyzeToolSchema.parse(raw);
}

export async function handleAnalyzeTool(
  input: AnalyzeToolInput,
  llmManager: LLMManager
): Promise<ToolResponse> {
  try {
    const analysisType = input.analysis_type || 'comprehensive';

    const systemPrompts = {
      sentiment: 'You are an expert sentiment analyzer. Analyze the emotional tone, sentiment, and underlying feelings in the text. Provide specific examples and confidence levels.',
      themes: 'You are an expert thematic analyzer. Identify the main themes, topics, and recurring patterns in the text. Organize your findings clearly.',
      structure: 'You are an expert structural analyzer. Analyze the organization, flow, and structural elements of the text. Comment on effectiveness and clarity.',
      comprehensive: 'You are an expert text analyst. Provide a comprehensive analysis covering sentiment, themes, structure, key insights, and actionable recommendations.',
      summary: 'You are an expert summarizer. Create a concise but thorough summary highlighting the most important points and key takeaways.'
    };

    let systemPrompt = systemPrompts[analysisType];
    if (input.focus) {
      systemPrompt += ` Pay special attention to: ${input.focus}`;
    }

    // Get default provider/model for analyze tool if not specified
    const toolDefaults = llmManager.getProviderForTool('analyze');
    const provider = input.provider || toolDefaults.provider;
    const model = input.model ?? toolDefaults.model;

    if (model && !isValidModelForProvider(provider, model as AnyModel)) {
      throw new Error(`Model '${model}' is not valid for provider '${provider}'`);
    }

    const response = await llmManager.complete({
      message: `Please analyze the following text:\n\n${input.text}`,
      systemPrompt,
      temperature: 0.3, // Lower temperature for more analytical consistency
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
          text: `Analysis failed: ${errorMessage}\n\nError details:\n- Tool: analyze\n- Code: ANALYZE_TOOL_ERROR`
        }
      ]
    };
  }
}
