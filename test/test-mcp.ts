#!/usr/bin/env npx tsx

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

class MCPTester {
  private requestId = 1;

  async testMCPServer(): Promise<void> {
    console.log('🧪 Testing MCP TypeScript Simple Server\n');

    // Test 1: List available tools
    console.log('📋 Test 1: Listing available tools...');
    const toolsResponse = await this.sendRequest({
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/list'
    });

    if (toolsResponse.error) {
      console.error('❌ Failed to list tools:', toolsResponse.error);
      return;
    }

    const tools = toolsResponse.result?.tools || [];
    console.log('✅ Available tools:', tools.map((t: any) => t.name).join(', '));
    console.log();

    // Test 2: Hello tool
    console.log('👋 Test 2: Testing hello tool...');
    const helloResponse = await this.sendRequest({
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'hello',
        arguments: { name: 'TypeScript Developer' }
      }
    });

    if (helloResponse.error) {
      console.error('❌ Hello tool failed:', helloResponse.error);
    } else {
      console.log('✅ Hello response:', helloResponse.result?.content?.[0]?.text);
    }
    console.log();

    // Test 3: Echo tool
    console.log('🔄 Test 3: Testing echo tool...');
    const echoResponse = await this.sendRequest({
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'echo',
        arguments: { message: 'MCP server is working perfectly!' }
      }
    });

    if (echoResponse.error) {
      console.error('❌ Echo tool failed:', echoResponse.error);
    } else {
      console.log('✅ Echo response:', echoResponse.result?.content?.[0]?.text);
    }
    console.log();

    // Test 4: Current time tool
    console.log('⏰ Test 4: Testing current-time tool...');
    const timeResponse = await this.sendRequest({
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'current-time',
        arguments: {}
      }
    });

    if (timeResponse.error) {
      console.error('❌ Current-time tool failed:', timeResponse.error);
    } else {
      console.log('✅ Time response:', timeResponse.result?.content?.[0]?.text);
    }
    console.log();

    // Test 5: Error handling - invalid tool
    console.log('⚠️  Test 5: Testing error handling with invalid tool...');
    const errorResponse = await this.sendRequest({
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'nonexistent-tool',
        arguments: {}
      }
    });

    if (errorResponse.error) {
      console.log('✅ Error handling works:', errorResponse.error.message);
    } else {
      console.error('❌ Expected error but got result:', errorResponse.result);
    }
    console.log();

    console.log('🎉 All tests completed!');
  }

  private async sendRequest(request: MCPRequest): Promise<MCPResponse> {
    return new Promise((resolve, reject) => {
      // Use relative path from project root
      const child = spawn('npx', ['tsx', 'src/index.ts'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd()
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        // Filter out server startup messages
        if (stderr && !stderr.includes('MCP TypeScript Simple server running')) {
          console.error('Server stderr:', stderr);
        }

        try {
          // Parse the JSON response from stdout
          const lines = stdout.trim().split('\n');
          for (const line of lines) {
            if (line.trim() && line.startsWith('{')) {
              const response = JSON.parse(line);
              if (response.id === request.id) {
                resolve(response);
                return;
              }
            }
          }
          reject(new Error(`No valid response found for request ${request.id}`));
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error}\nStdout: ${stdout}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });

      // Send the request
      child.stdin.write(JSON.stringify(request) + '\n');
      child.stdin.end();
    });
  }
}

// Run tests
const tester = new MCPTester();
tester.testMCPServer().catch(console.error);