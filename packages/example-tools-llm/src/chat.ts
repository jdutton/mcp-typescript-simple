/**
 * Chat tool - Interactive AI assistant
 *
 * Example tool demonstrating:
 * - LLM integration with multiple providers
 * - Runtime provider/model selection
 * - Complex input validation
 * - Error handling with LLM calls
 */

import { defineTool } from '@mcp-typescript-simple/tools';
import { z } from 'zod';
import { LLMManager } from '@mcp-typescript-simple/tools-llm';
import { AnyModel, isValidModelForProvider, getDefaultModelForProvider } from '@mcp-typescript-simple/tools-llm';

const ChatToolZodSchema = z.object({
  message: z.string().describe('The message to send to the AI assistant'),
  system_prompt: z.string().optional().describe('Optional system prompt to guide the AI behavior'),
  temperature: z.number().min(0).max(2).optional().describe('Controls randomness (0-2, default 0.7)'),
  provider: z.enum(['claude', 'openai', 'gemini']).optional().describe('LLM provider to use (default: claude)'),
  model: z.string().optional().describe('Specific model to use. Must be valid for the selected provider.')
});

export type ChatToolInput = z.infer<typeof ChatToolZodSchema>;

/**
 * Create chat tool with injected LLM manager
 */
export function createChatTool(llmManager: LLMManager) {
  return defineTool({
    name: 'chat',
    description: 'Interactive AI assistant with flexible provider and model selection',
    inputSchema: ChatToolZodSchema,
    handler: async (input: ChatToolInput) => {
      try {
        // Get default provider/model for chat tool if not specified
        const toolDefaults = llmManager.getProviderForTool('chat');
        const provider = input.provider ?? toolDefaults.provider;

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
          message: input.message,
          systemPrompt: input.system_prompt,
          temperature: input.temperature,
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
              text: `Chat failed: ${errorMessage}\n\nError details:\n- Tool: chat\n- Code: CHAT_TOOL_ERROR`
            }
          ]
        };
      }
    }
  });
}
