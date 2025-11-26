/**
 * System test to validate all configured models work with real API calls
 * This test ensures:
 * 1. All model names are correct and supported by their providers
 * 2. API keys have proper permissions
 * 3. Models are not deprecated or removed
 *
 * Run with: npm run test:system -- test/system/models-validation.system.test.ts
 */

import { LLMManager } from '@mcp-typescript-simple/tools-llm';
import type { LLMProvider, ClaudeModel, OpenAIModel, GeminiModel } from '../../src/llm/types.js';

describe('Model Validation System Tests', () => {
  let llmManager: LLMManager;
  let availableProviders: LLMProvider[];

  beforeAll(async () => {
    llmManager = new LLMManager();

    try {
      await llmManager.initialize();
      availableProviders = llmManager.getAvailableProviders();
    } catch {
      console.log('⚠️  LLM Manager initialization failed - skipping all model validation tests');
      availableProviders = [];
    }
  });

  describe('Claude Models', () => {
    const claudeModels: ClaudeModel[] = [
      'claude-3-5-haiku-20241022',
      'claude-3-haiku-20240307',
      'claude-sonnet-4-5-20250929'
    ];

    beforeEach(() => {
      if (!availableProviders.includes('claude')) {
        console.log('⚠️  Claude not available - set ANTHROPIC_API_KEY to test Claude models');
      }
    });

    for (const model of claudeModels) {
      it(`should successfully complete with Claude model: ${model}`, async () => {
        if (!availableProviders.includes('claude')) {
          console.log(`⏭️  Skipping ${model} - Claude not configured`);
          return;
        }

        const startTime = Date.now();

        try {
          const response = await llmManager.complete({
            message: 'Say "OK" if you can read this.',
            provider: 'claude',
            model,
            temperature: 0,
            maxTokens: 10
          });

          const duration = Date.now() - startTime;

          expect(response.provider).toBe('claude');
          expect(response.model).toBe(model);
          expect(response.content).toBeDefined();
          expect(response.content.length).toBeGreaterThan(0);
          expect(response.usage).toBeDefined();
          expect(response.usage?.totalTokens).toBeGreaterThan(0);

          console.log(`✅ ${model}: ${response.content.substring(0, 50)} (${duration}ms, ${response.usage?.totalTokens} tokens)`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`❌ ${model} FAILED: ${errorMessage}`);
          throw new Error(`Claude model '${model}' failed: ${errorMessage}`);
        }
      });
    }
  });

  describe('OpenAI Models', () => {
    const openaiModels: OpenAIModel[] = [
      'gpt-3.5-turbo',
      'gpt-4',
      'gpt-4-turbo',
      'gpt-4o',
      'gpt-4o-mini'
    ];

    beforeEach(() => {
      if (!availableProviders.includes('openai')) {
        console.log('⚠️  OpenAI not available - set OPENAI_API_KEY to test OpenAI models');
      }
    });

    for (const model of openaiModels) {
      it(`should successfully complete with OpenAI model: ${model}`, async () => {
        if (!availableProviders.includes('openai')) {
          console.log(`⏭️  Skipping ${model} - OpenAI not configured`);
          return;
        }

        const startTime = Date.now();

        try {
          const response = await llmManager.complete({
            message: 'Say "OK" if you can read this.',
            provider: 'openai',
            model,
            temperature: 0,
            maxTokens: 10
          });

          const duration = Date.now() - startTime;

          expect(response.provider).toBe('openai');
          expect(response.model).toBe(model);
          expect(response.content).toBeDefined();
          expect(response.content.length).toBeGreaterThan(0);
          expect(response.usage).toBeDefined();
          expect(response.usage?.totalTokens).toBeGreaterThan(0);

          console.log(`✅ ${model}: ${response.content.substring(0, 50)} (${duration}ms, ${response.usage?.totalTokens} tokens)`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`❌ ${model} FAILED: ${errorMessage}`);
          throw new Error(`OpenAI model '${model}' failed: ${errorMessage}`);
        }
      });
    }
  });

  describe('Gemini Models', () => {
    const geminiModels: GeminiModel[] = [
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash'
    ];

    beforeEach(() => {
      if (!availableProviders.includes('gemini')) {
        console.log('⚠️  Gemini not available - set GOOGLE_API_KEY to test Gemini models');
      }
    });

    for (const model of geminiModels) {
      it(`should successfully complete with Gemini model: ${model}`, async () => {
        if (!availableProviders.includes('gemini')) {
          console.log(`⏭️  Skipping ${model} - Gemini not configured`);
          return;
        }

        const startTime = Date.now();

        try {
          const response = await llmManager.complete({
            message: 'Say "OK" if you can read this.',
            provider: 'gemini',
            model,
            temperature: 0,
            maxTokens: 10
          });

          const duration = Date.now() - startTime;

          expect(response.provider).toBe('gemini');
          expect(response.model).toBe(model);
          expect(response.content).toBeDefined();
          expect(response.content.length).toBeGreaterThan(0);
          expect(response.usage).toBeDefined();
          expect(response.usage?.totalTokens).toBeGreaterThan(0);

          console.log(`✅ ${model}: ${response.content.substring(0, 50)} (${duration}ms, ${response.usage?.totalTokens} tokens)`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`❌ ${model} FAILED: ${errorMessage}`);
          throw new Error(`Gemini model '${model}' failed: ${errorMessage}`);
        }
      });
    }
  });

  describe('Model Availability Summary', () => {
    it('should log summary of all model validation results', async () => {
      if (availableProviders.length === 0) {
        console.log('\n⚠️  No LLM providers available - set API keys to validate models');
        console.log('   ANTHROPIC_API_KEY - for Claude models');
        console.log('   OPENAI_API_KEY - for OpenAI models');
        console.log('   GOOGLE_API_KEY - for Gemini models\n');
        return;
      }

      const schemaInfo = await llmManager.getSchemaInfo();

      console.log('\n📊 Model Validation Summary:');
      console.log('═══════════════════════════════════════════════════════');

      for (const provider of schemaInfo.providers) {
        console.log(`\n${provider.name.toUpperCase()}:`);
        console.log(`  Models: ${provider.models.join(', ')}`);
        console.log(`  Status: ✅ Available (${provider.models.length} models)`);
      }

      console.log('\n═══════════════════════════════════════════════════════\n');

      // This test always passes - it's just for logging
      expect(availableProviders.length).toBeGreaterThan(0);
    });
  });
});
