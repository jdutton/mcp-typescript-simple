/**
 * Chat tool using Claude Haiku for fast responses
 */

import { z } from 'zod';
import { LLMManager } from '../../llm/manager.js';
import { AnyModel } from '../../llm/types.js';

export const ChatToolSchema = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description: "The message to send to the AI assistant"
    },
    system_prompt: {
      type: "string",
      description: "Optional system prompt to guide the AI behavior"
    },
    temperature: {
      type: "number",
      minimum: 0,
      maximum: 2,
      description: "Controls randomness (0-2). If omitted, the configured default temperature is used."
    },
    provider: {
      type: "string",
      enum: ["claude", "openai", "gemini"],
      description: "LLM provider to use (default: claude)"
    },
    model: {
      type: "string",
      description: "Specific model to use. Must be valid for the selected provider. Examples: claude-3-haiku-20240307, claude-3-sonnet-20240229, gpt-4, gpt-4o, gemini-1.5-flash"
    }
  },
  required: ["message"]
} as const;

const ChatToolZodSchema = z.object({
  message: z.string().describe('The message to send to the AI assistant'),
  system_prompt: z.string().optional().describe('Optional system prompt to guide the AI behavior'),
  temperature: z.number().min(0).max(2).optional().describe('Controls randomness (0-2, default 0.7)'),
  provider: z.enum(['claude', 'openai', 'gemini']).optional().describe('LLM provider to use (default: claude)'),
  model: z.string().optional().describe('Specific model to use. Must be valid for the selected provider.')
});

export type ChatToolInput = z.infer<typeof ChatToolZodSchema>;

export async function handleChatTool(
  input: ChatToolInput,
  llmManager: LLMManager
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    // Get default provider/model for chat tool if not specified
    const toolDefaults = llmManager.getProviderForTool('chat');

    const response = await llmManager.complete({
      message: input.message,
      systemPrompt: input.system_prompt,
      temperature: input.temperature,
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
        text: `Error: ${errorMessage}`
      }]
    };
  }
}