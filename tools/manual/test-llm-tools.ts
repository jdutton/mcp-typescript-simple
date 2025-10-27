#!/usr/bin/env node

/**
 * Test script for LLM-powered MCP tools
 */

import { spawn } from 'child_process';

interface MCPRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: string;
  id: number;
  result?: any;
  error?: any;
}

class LLMToolTester {
  private server: any;
  private requestId = 1;

  async start(): Promise<void> {
    console.log('🧪 Testing LLM-Powered MCP Tools');
    console.log('==================================\n');

    try {
      await this.startServer();
      await this.runTests();
    } catch (_error) {
      console.error('❌ Test failed:', error);
      process.exit(1);
    } finally {
      this.cleanup();
    }
  }

  private async startServer(): Promise<void> {
    console.log('🚀 Starting MCP server...');

    this.server = spawn('npx', ['tsx', 'src/index.ts'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Wait for server to initialize
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server startup timeout'));
      }, 10000);

      this.server.stderr.on('data', (data: Buffer) => {
        const output = data.toString();
        console.log('📝 Server:', output.trim());

        if (output.includes('MCP TypeScript Simple server running')) {
          clearTimeout(timeout);
          resolve(undefined);
        }
      });

      this.server.on('error', (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    console.log('✅ Server started\n');
  }

  private async sendRequest(request: MCPRequest): Promise<MCPResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, 30000); // 30 second timeout for LLM calls

      this.server.stdout.once('data', (data: Buffer) => {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(data.toString());
          resolve(response);
        } catch (_error) {
          reject(new Error(`Invalid JSON response: ${data.toString()}`));
        }
      });

      this.server.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  private async runTests(): Promise<void> {
    // Test 1: List tools to verify LLM tools are available
    console.log('🔍 Test 1: Listing available tools...');
    const listResponse = await this.sendRequest({
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/list'
    });

    if (listResponse.error) {
      throw new Error(`Failed to list tools: ${listResponse.error.message}`);
    }

    const tools = listResponse.result?.tools || [];
    const llmTools = tools.filter((tool: any) =>
      ['chat', 'analyze', 'summarize', 'explain'].includes(tool.name)
    );

    console.log(`✅ Found ${tools.length} total tools, ${llmTools.length} LLM tools\n`);

    // Test 2: Chat tool (Claude)
    console.log('💬 Test 2: Testing chat tool (Claude)...');
    const chatResponse = await this.sendRequest({
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'chat',
        arguments: {
          message: 'Say hello and tell me you are working correctly. Be brief.'
        }
      }
    });

    if (chatResponse.error) {
      console.log('❌ Chat tool failed:', chatResponse.error.message);
    } else {
      const content = chatResponse.result?.content?.[0]?.text || 'No response';
      console.log('✅ Chat response:', content.substring(0, 100) + '...\n');
    }

    // Test 3: Analyze tool (OpenAI)
    console.log('🔍 Test 3: Testing analyze tool (OpenAI)...');
    const analyzeResponse = await this.sendRequest({
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'analyze',
        arguments: {
          text: 'I love this product! It works perfectly and exceeded my expectations.',
          analysis_type: 'sentiment'
        }
      }
    });

    if (analyzeResponse.error) {
      console.log('❌ Analyze tool failed:', analyzeResponse.error.message);
    } else {
      const content = analyzeResponse.result?.content?.[0]?.text || 'No response';
      console.log('✅ Analysis response:', content.substring(0, 100) + '...\n');
    }

    // Test 4: Explain tool (Claude)
    console.log('📚 Test 4: Testing explain tool (Claude)...');
    const explainResponse = await this.sendRequest({
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'explain',
        arguments: {
          topic: 'recursion in programming',
          level: 'beginner'
        }
      }
    });

    if (explainResponse.error) {
      console.log('❌ Explain tool failed:', explainResponse.error.message);
    } else {
      const content = explainResponse.result?.content?.[0]?.text || 'No response';
      console.log('✅ Explanation response:', content.substring(0, 100) + '...\n');
    }

    // Test 5: Summarize tool (Gemini - if available)
    console.log('📝 Test 5: Testing summarize tool (Gemini)...');
    const summarizeResponse = await this.sendRequest({
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'summarize',
        arguments: {
          text: 'Machine learning is a subset of artificial intelligence that focuses on algorithms and statistical models that enable computer systems to improve their performance on a specific task through experience. It involves training algorithms on data to make predictions or decisions without being explicitly programmed for every scenario.',
          length: 'brief'
        }
      }
    });

    if (summarizeResponse.error) {
      console.log('❌ Summarize tool failed:', summarizeResponse.error.message);
    } else {
      const content = summarizeResponse.result?.content?.[0]?.text || 'No response';
      console.log('✅ Summary response:', content.substring(0, 100) + '...\n');
    }

    console.log('🎉 LLM tool testing completed!');
  }

  private cleanup(): void {
    if (this.server) {
      this.server.kill();
    }
  }
}

// Run the tests
const tester = new LLMToolTester();
tester.start().catch((error) => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});