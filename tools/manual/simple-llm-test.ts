#!/usr/bin/env node

/**
 * Simple LLM tool test using MCP Inspector approach
 */

import { spawn } from 'child_process';

async function testLLMTools() {
  console.log('🧪 Testing LLM Tools with Real API Keys');
  console.log('==========================================\n');

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
            } catch (_e) {
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

    // Test 1: List tools
    console.log('📋 Test 1: Listing available tools...');
    const listResponse = await sendRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list'
    });

    if (listResponse.error) {
      console.log('❌ Failed to list tools:', listResponse.error.message);
      return;
    }

    const tools = listResponse.result?.tools || [];
    const llmTools = tools.filter((t: any) => ['chat', 'analyze', 'summarize', 'explain'].includes(t.name));
    console.log(`✅ Found ${tools.length} total tools, ${llmTools.length} LLM tools`);
    console.log('LLM Tools:', llmTools.map((t: any) => t.name).join(', '));
    console.log();

    // Test 2: Chat tool (Claude)
    console.log('💬 Test 2: Testing chat tool (Claude)...');
    const chatResponse = await sendRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'chat',
        arguments: {
          message: 'Hello! Please respond with exactly: "Claude is working correctly via MCP"'
        }
      }
    });

    if (chatResponse.error) {
      console.log('❌ Chat tool failed:', chatResponse.error.message);
    } else {
      const content = chatResponse.result?.content?.[0]?.text || 'No response';
      console.log('✅ Chat response:', content);
    }
    console.log();

    // Test 3: Analyze tool (OpenAI)
    console.log('🔍 Test 3: Testing analyze tool (OpenAI GPT-4)...');
    const analyzeResponse = await sendRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'analyze',
        arguments: {
          text: 'I absolutely love this new software! It makes my work so much easier.',
          analysis_type: 'sentiment'
        }
      }
    });

    if (analyzeResponse.error) {
      console.log('❌ Analyze tool failed:', analyzeResponse.error.message);
    } else {
      const content = analyzeResponse.result?.content?.[0]?.text || 'No response';
      console.log('✅ Analysis response:', content.substring(0, 200) + '...');
    }
    console.log();

    // Test 4: Explain tool (Claude)
    console.log('📚 Test 4: Testing explain tool (Claude)...');
    const explainResponse = await sendRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'explain',
        arguments: {
          topic: 'What is TypeScript?',
          level: 'beginner'
        }
      }
    });

    if (explainResponse.error) {
      console.log('❌ Explain tool failed:', explainResponse.error.message);
    } else {
      const content = explainResponse.result?.content?.[0]?.text || 'No response';
      console.log('✅ Explanation response:', content.substring(0, 200) + '...');
    }
    console.log();

    console.log('🎉 LLM tool testing completed successfully!');

  } catch (_error) {
    console.error('❌ Test failed:', error);
  } finally {
    child.kill();
  }
}

testLLMTools().catch(console.error);