#!/usr/bin/env node

/**
 * Test specifically what happens with Gemini when API key is missing
 */

import { spawn } from 'child_process';

async function testGeminiSpecifically() {
  console.log('🔍 Testing Gemini API Key Configuration');
  console.log('=======================================\n');

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
            } catch (_e) {
              // Continue looking
            }
          }
        }
      };

      child.stdout.on('data', onData);

      // Capture ALL server messages to see what's happening
      child.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        console.log('🔍 Server Log:', msg);
      });

      child.stdin.write(JSON.stringify(request) + '\n');
    });
  };

  try {
    // Wait for server startup
    console.log('🚀 Starting server and monitoring initialization...');
    await new Promise(resolve => setTimeout(resolve, 4000));
    console.log('\n📋 Testing summarize tool (configured for Gemini)...');

    const response = await sendRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'summarize',
        arguments: {
          text: 'This is a test text to see what happens when we try to summarize using Gemini, but the API key is not configured.',
          length: 'brief'
        }
      }
    });

    if (response.error) {
      console.log('\n❌ Summarize tool failed with error:', response.error.message);
    } else {
      const content = response.result?.content?.[0]?.text || '';
      console.log('\n✅ Summarize tool succeeded with response:');
      console.log(`"${content}"`);
      console.log('\n🤔 This suggests either:');
      console.log('1. Gemini API key is actually available');
      console.log('2. Fallback mechanism is working (tool fell back to another provider)');
      console.log('3. Tool is not actually using Gemini as intended');
    }

  } catch (_error) {
    console.error('\n❌ Test failed:', error);
  } finally {
    child.kill();
  }
}

testGeminiSpecifically().catch(console.error);