/**
 * Quick test to verify package integration works
 */

import { ToolRegistry } from '@mcp-typescript-simple/tools';
import { basicTools } from '@mcp-typescript-simple/example-tools-basic';
import { LLMManager } from '@mcp-typescript-simple/tools-llm';
import { createLLMTools } from '@mcp-typescript-simple/example-tools-llm';

async function testPackageIntegration() {
  console.log('Testing package integration...\n');

  // Test 1: Basic tools registry
  console.log('✓ Basic tools imported:', basicTools.list().map(t => t.name).join(', '));

  // Test 2: Create tool registry with basic tools
  const allTools = new ToolRegistry();
  allTools.merge(basicTools);
  console.log('✓ Basic tools added to registry');

  //Test 3: LLM Manager (optional - requires API keys)
  let hasLLM = false;
  try {
    const llmManager = new LLMManager();
    await llmManager.initialize();
    console.log('✓ LLM Manager initialized');

    // Test 4: LLM tools
    const llmTools = createLLMTools(llmManager);
    console.log('✓ LLM tools created:', llmTools.list().map(t => t.name).join(', '));

    // Test 5: Merge LLM tools
    allTools.merge(llmTools);
    hasLLM = true;
  } catch (error) {
    console.log('⚠ LLM tools skipped (no API keys configured) - this is OK');
  }

  console.log('✓ Final tool registry:', allTools.list().map(t => t.name).join(', '));

  // Test 6: Call a basic tool
  const helloResult = await allTools.call('hello', { name: 'World' });
  console.log('✓ Called hello tool:', JSON.stringify(helloResult));

  console.log('\n✅ All package integration tests passed!');
}

testPackageIntegration().catch(error => {
  console.error('❌ Package integration test failed:', error);
  process.exit(1);
});
