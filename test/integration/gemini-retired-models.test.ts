/**
 * Integration test to reproduce the Gemini 1.5 model bug
 *
 * This test MUST FAIL initially to prove we can reproduce the user's bug.
 * The bug: gemini-2.5-flash returns 404 because Gemini 1.5 models are RETIRED.
 *
 * Run with: npx jest test/integration/gemini-retired-models.test.ts
 */

import { LLMManager } from '../../src/llm/manager.js';

describe('Gemini Retired Models Bug Reproduction', () => {
  let llmManager: LLMManager;

  beforeAll(async () => {
    llmManager = new LLMManager();

    // Only run this test if GOOGLE_API_KEY is set
    if (!process.env.GOOGLE_API_KEY) {
      console.log('⚠️  GOOGLE_API_KEY not set - skipping Gemini bug reproduction test');
      return;
    }

    try {
      await llmManager.initialize();
    } catch {
      console.log('LLM Manager initialization failed');
    }
  });

  it('should FAIL with gemini-1.5-flash-latest (RETIRED MODEL) - reproducing user bug', async () => {
    if (!process.env.GOOGLE_API_KEY) {
      console.log('⏭️  Skipping - GOOGLE_API_KEY not configured');
      return;
    }

    if (!llmManager.getAvailableProviders().includes('gemini')) {
      console.log('⏭️  Skipping - Gemini not available');
      return;
    }

    console.log('\n🔍 Attempting to use RETIRED Gemini 1.5 model...');
    console.log('   This test should FAIL with a 404 error');
    console.log('   Error: models/gemini-1.5-flash-latest is not found\n');

    // This should fail because gemini-1.5-flash-latest is RETIRED
    await expect(async () => {
      await llmManager.complete({
        message: 'Say OK',
        provider: 'gemini',
        model: 'gemini-1.5-flash-latest' as any, // Force the retired model
        temperature: 0,
        maxTokens: 10
      });
    }).rejects.toThrow(/404.*Not Found|not found|is not found/i);

    console.log('✅ Test PASSED - Successfully reproduced the 404 error with retired model');
  });

  it('should SUCCEED with gemini-2.5-flash (CURRENT MODEL)', async () => {
    if (!process.env.GOOGLE_API_KEY) {
      console.log('⏭️  Skipping - GOOGLE_API_KEY not configured');
      return;
    }

    if (!llmManager.getAvailableProviders().includes('gemini')) {
      console.log('⏭️  Skipping - Gemini not available');
      return;
    }

    console.log('\n🔍 Testing with CURRENT Gemini 2.5 model...');

    // This should work because gemini-2.5-flash is the current model
    const response = await llmManager.complete({
      message: 'Say OK',
      provider: 'gemini',
      model: 'gemini-2.5-flash' as any, // Current model
      temperature: 0,
      maxTokens: 10
    });

    expect(response.content).toBeDefined();
    expect(response.provider).toBe('gemini');
    expect(response.model).toBe('gemini-2.5-flash');

    console.log(`✅ gemini-2.5-flash works! Response: ${response.content}`);
  });
});
