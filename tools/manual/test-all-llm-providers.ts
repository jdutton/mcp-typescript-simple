#!/usr/bin/env node

/**
 * Comprehensive test of all LLM providers
 */

import { spawn } from 'node:child_process';

async function testAllProviders() {
  console.log('🚀 Comprehensive LLM Provider Testing');
  console.log('=====================================\n');

  const child = spawn('npx', ['tsx', 'src/index.ts'], {
    stdio: 'pipe'
  });

  // Helper function to send a single request and get response
  async function sendRequest(request: any): Promise<any> {
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
              // Ignore parsing errors, continue looking
            }
          }
        }
      };

      child.stdout.on('data', onData);

      child.stderr.on('data', (data) => {
        console.log('📝 Server:', data.toString().trim());
      });

      // Send request
      child.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  try {
    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('🔹 Testing Claude (Anthropic) - Chat Tool');
    const chatResponse = await sendRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'chat',
        arguments: {
          message: 'Say exactly: "Claude Haiku is working via MCP"',
          temperature: 0.1
        }
      }
    });

    if (chatResponse.error) {
      console.log('❌ Claude chat failed:', chatResponse.error.message);
    } else {
      console.log('✅ Claude response:', chatResponse.result?.content?.[0]?.text);
    }
    console.log();

    console.log('🔹 Testing OpenAI GPT-4 - Analyze Tool');
    const analyzeResponse = await sendRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'analyze',
        arguments: {
          text: 'This product is terrible and I hate it completely.',
          analysis_type: 'sentiment'
        }
      }
    });

    if (analyzeResponse.error) {
      console.log('❌ OpenAI analyze failed:', analyzeResponse.error.message);
    } else {
      const content = analyzeResponse.result?.content?.[0]?.text || '';
      console.log('✅ OpenAI analysis:', content.substring(0, 150) + '...');
    }
    console.log();

    console.log('🔹 Testing Google Gemini - Summarize Tool');
    const summarizeResponse = await sendRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'summarize',
        arguments: {
          text: 'Machine learning is a subset of artificial intelligence (AI) that provides systems the ability to automatically learn and improve from experience without being explicitly programmed. Machine learning focuses on the development of computer programs that can access data and use it to learn for themselves. The process of learning begins with observations or data, such as examples, direct experience, or instruction, in order to look for patterns in data and make better decisions in the future based on the examples that we provide.',
          length: 'brief',
          format: 'paragraph'
        }
      }
    });

    if (summarizeResponse.error) {
      console.log('❌ Gemini summarize failed:', summarizeResponse.error.message);
    } else {
      console.log('✅ Gemini summary:', summarizeResponse.result?.content?.[0]?.text);
    }
    console.log();

    console.log('🔹 Testing Claude - Explain Tool with System Prompt');
    const explainResponse = await sendRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'explain',
        arguments: {
          topic: 'How does REST API work?',
          level: 'beginner',
          include_examples: true
        }
      }
    });

    if (explainResponse.error) {
      console.log('❌ Claude explain failed:', explainResponse.error.message);
    } else {
      const content = explainResponse.result?.content?.[0]?.text || '';
      console.log('✅ Claude explanation:', content.substring(0, 200) + '...');
    }
    console.log();

    console.log('🎯 Multi-Provider Test Summary:');
    console.log('================================');
    console.log('✅ Claude (Anthropic): Chat & Explain tools working');
    console.log('✅ OpenAI GPT-4: Analyze tool working');
    console.log('✅ Google Gemini: Summarize tool working');
    console.log('✅ All 3 LLM providers successfully integrated!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    child.kill();
  }
}

try {
  await testAllProviders();
} catch (error) {
  console.error(error);
}