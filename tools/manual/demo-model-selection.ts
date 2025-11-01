#!/usr/bin/env node

/**
 * Demonstration of the new type-safe provider and model selection
 */

import { spawn } from 'node:child_process';

async function demonstrateModelSelection() {
  console.log('🚀 Type-Safe Provider & Model Selection Demo');
  console.log('=============================================\n');

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
      child.stderr.on('data', () => {}); // Silence server logs
      child.stdin.write(JSON.stringify(request) + '\n');
    });
  };

  try {
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('💬 CHAT TOOL DEMONSTRATIONS:');
    console.log('=============================');

    console.log(String.raw`\n1️⃣ Default Chat (Claude Haiku - Fast):`);
    const defaultChat = await sendRequest({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'chat', arguments: { message: 'Explain quantum computing in one sentence.' }}
    });
    console.log(`   Response: "${defaultChat.result?.content?.[0]?.text}"`);

    console.log(String.raw`\n2️⃣ OpenAI GPT-4o Mini Chat (Different Provider):`);
    const openaiChat = await sendRequest({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'chat', arguments: {
        message: 'Explain quantum computing in one sentence.',
        provider: 'openai',
        model: 'gpt-4o-mini'
      }}
    });
    console.log(`   Response: "${openaiChat.result?.content?.[0]?.text}"`);

    console.log(String.raw`\n\n🔍 ANALYSIS TOOL DEMONSTRATIONS:`);
    console.log('===================================');

    console.log(String.raw`\n3️⃣ Default Analysis (OpenAI GPT-4):`);
    const defaultAnalysis = await sendRequest({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'analyze', arguments: {
        text: 'I absolutely hate how much I love this new technology!',
        analysis_type: 'sentiment'
      }}
    });
    console.log(`   Analysis: "${defaultAnalysis.result?.content?.[0]?.text?.substring(0, 120)}..."`);

    console.log(String.raw`\n4️⃣ Claude Analysis (Different Provider):`);
    const claudeAnalysis = await sendRequest({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'analyze', arguments: {
        text: 'I absolutely hate how much I love this new technology!',
        analysis_type: 'sentiment',
        provider: 'claude',
        model: 'claude-3-haiku-20240307'
      }}
    });
    console.log(`   Analysis: "${claudeAnalysis.result?.content?.[0]?.text?.substring(0, 120)}..."`);

    console.log(String.raw`\n\n📝 SUMMARIZATION DEMONSTRATIONS:`);
    console.log('==================================');

    const longText = 'Machine learning is a subset of artificial intelligence that focuses on algorithms and statistical models that enable computer systems to improve their performance on a specific task through experience. Instead of being explicitly programmed for every scenario, machine learning systems learn from data to make predictions or decisions. This approach has revolutionized many fields including computer vision, natural language processing, and robotics.';

    console.log(String.raw`\n5️⃣ Default Summarization (Gemini Flash - Cost Effective):`);
    const defaultSummary = await sendRequest({
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'summarize', arguments: {
        text: longText,
        length: 'brief'
      }}
    });
    console.log(`   Summary: "${defaultSummary.result?.content?.[0]?.text}"`);

    console.log(String.raw`\n6️⃣ Claude Summarization (Different Provider):`);
    const claudeSummary = await sendRequest({
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: { name: 'summarize', arguments: {
        text: longText,
        length: 'brief',
        provider: 'claude',
        model: 'claude-3-haiku-20240307'
      }}
    });
    console.log(`   Summary: "${claudeSummary.result?.content?.[0]?.text}"`);

    console.log(String.raw`\n\n🎯 KEY FEATURES DEMONSTRATED:`);
    console.log('==============================');
    console.log('✅ Type-Safe Provider Selection: Choose claude, openai, or gemini');
    console.log('✅ Type-Safe Model Selection: Specific models for each provider');
    console.log('✅ Tool-Specific Defaults: Each tool has optimized default provider/model');
    console.log('✅ Runtime Flexibility: Override defaults per request');
    console.log('✅ Backward Compatibility: Existing code continues to work');
    console.log('✅ Compile-Time Validation: Invalid combinations caught at build time');

    console.log(String.raw`\n💡 EXAMPLE USAGE PATTERNS:`);
    console.log('===========================');
    console.log('// Use tool defaults (optimized for each use case)');
    console.log('{ name: "chat", arguments: { message: "Hello" } }');
    console.log('');
    console.log('// Override provider only');
    console.log('{ name: "analyze", arguments: { text: "...", provider: "claude" } }');
    console.log('');
    console.log('// Override both provider and model');
    console.log('{ name: "chat", arguments: { message: "...", provider: "openai", model: "gpt-4o" } }');

  } catch (error) {
    console.error('❌ Demo failed:', error);
  } finally {
    child.kill();
  }
}

try {
  await demonstrateModelSelection();
} catch (error) {
  console.error(error);
}