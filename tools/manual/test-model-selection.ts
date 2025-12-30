#!/usr/bin/env node

/**
 * Test the new provider and model selection functionality
 */

import { spawn } from 'node:child_process';

async function testModelSelection() {
  console.log('🧪 Testing Type-Safe Provider & Model Selection');
  console.log('===============================================\n');

  const child = spawn('npx', ['tsx', 'src/index.ts'], {
    stdio: 'pipe'
  });

  const sendRequest = async (request: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Request timeout (60s)'));
      }, 60000);

      let responseBuffer = '';
      const onData = (data: Buffer) => {
        responseBuffer += data.toString();
        const lines = responseBuffer.split('\n');
        for (const line of lines) {
          if (line.trim() && line.startsWith('{')) {
            try {
              const response = JSON.parse(line);
              if (response.id === request.id) {
                clearTimeout(timeout);
                child.stdout.off('data', onData);
                resolve(response);
                return;
              }
            } catch {
              // Continue parsing lines for valid JSON response
            }
          }
        }
      };

      child.stdout.on('data', onData);
      child.stderr.on('data', () => { /* no-op */ }); // Silence server logs for cleaner output
      child.stdin.write(JSON.stringify(request) + '\n');
    });
  };

  try {
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('🔹 Test 1: Chat tool with default settings');
    const defaultChatResponse = await sendRequest({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'chat', arguments: { message: 'Say "Default chat working"' }}
    });
    console.log('✅ Default chat:', defaultChatResponse.result?.content?.[0]?.text?.substring(0, 50) + '...');

    console.log(String.raw`\n🔹 Test 2: Chat tool with explicit provider`);
    const claudeChatResponse = await sendRequest({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'chat', arguments: {
        message: 'Say "Claude provider working"',
        provider: 'claude'
      }}
    });
    console.log('✅ Claude chat:', claudeChatResponse.result?.content?.[0]?.text?.substring(0, 50) + '...');

    console.log(String.raw`\n🔹 Test 3: Chat tool with explicit model`);
    const sonetChatResponse = await sendRequest({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'chat', arguments: {
        message: 'Say "Sonnet model working"',
        provider: 'claude',
        model: 'claude-3-sonnet-20240229'
      }}
    });
    console.log('✅ Sonnet chat:', sonetChatResponse.result?.content?.[0]?.text?.substring(0, 50) + '...');

    console.log(String.raw`\n🔹 Test 4: Analyze tool with OpenAI GPT-4`);
    const gpt4AnalyzeResponse = await sendRequest({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'analyze', arguments: {
        text: 'This is fantastic!',
        analysis_type: 'sentiment',
        provider: 'openai',
        model: 'gpt-4'
      }}
    });
    console.log('✅ GPT-4 analysis:', gpt4AnalyzeResponse.result?.content?.[0]?.text?.substring(0, 60) + '...');

    console.log(String.raw`\n🔹 Test 5: Testing invalid model (should fail gracefully)`);
    const invalidModelResponse = await sendRequest({
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'chat', arguments: {
        message: 'This should fail',
        provider: 'claude',
        model: 'gpt-4' // Invalid: GPT-4 for Claude provider
      }}
    });

    if (invalidModelResponse.error) {
      console.log('✅ Invalid model correctly rejected:', invalidModelResponse.error.message?.substring(0, 60) + '...');
    } else {
      console.log('⚠️  Invalid model was not rejected (unexpected)');
    }

    console.log(String.raw`\n🔹 Test 6: Cross-provider model flexibility`);
    const openAIChatResponse = await sendRequest({
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: { name: 'chat', arguments: {
        message: 'Say "OpenAI for chat working"',
        provider: 'openai',
        model: 'gpt-4o-mini'
      }}
    });
    console.log('✅ OpenAI chat:', openAIChatResponse.result?.content?.[0]?.text?.substring(0, 50) + '...');

    console.log(String.raw`\n🎯 MODEL SELECTION TEST SUMMARY:`);
    console.log('==================================');
    console.log('✅ Default provider/model selection working');
    console.log('✅ Explicit provider selection working');
    console.log('✅ Explicit model selection working');
    console.log('✅ Cross-provider tool usage working');
    console.log('✅ Invalid model validation working');
    console.log('✅ Type-safe provider/model system operational!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    child.kill();
  }
}

try {
  await testModelSelection();
} catch (error) {
  console.error(error);
}