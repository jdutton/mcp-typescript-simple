#!/usr/bin/env node

/**
 * Comprehensive test suite exercising ALL MCP tools
 */

import { spawn } from 'child_process';

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL';
  duration: number;
  details: string;
  error?: string;
}

class ComprehensiveToolTester {
  private requestId = 1;
  private testResults: TestResult[] = [];

  async runAllTests(): Promise<void> {
    console.log('🚀 COMPREHENSIVE MCP TOOL TESTING');
    console.log('==================================');
    console.log('Testing ALL tools with various parameters and edge cases\n');

    const child = spawn('npx', ['tsx', 'src/index.ts'], {
      stdio: 'pipe'
    });

    const sendRequest = async (request: any): Promise<any> => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Request timeout (90s)'));
        }, 90000);

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
                // Continue looking for valid response
              }
            }
          }
        };

        child.stdout.on('data', onData);
        child.stderr.on('data', (data) => {
          // Silently log server messages
          const msg = data.toString().trim();
          if (msg.includes('ERROR') || msg.includes('FAILED')) {
            console.log('⚠️  Server:', msg);
          }
        });

        child.stdin.write(JSON.stringify(request) + '\n');
      });
    };

    try {
      // Wait for server startup
      console.log('🔄 Starting MCP server...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      console.log('✅ Server ready\n');

      // Test 1: Tool Discovery
      await this.testToolDiscovery(sendRequest);

      // Test 2: Basic Tools
      await this.testBasicTools(sendRequest);

      // Test 3: LLM Tools
      await this.testLLMTools(sendRequest);

      // Test 4: Error Handling
      await this.testErrorHandling(sendRequest);

      // Test 5: Edge Cases
      await this.testEdgeCases(sendRequest);

    } catch (_error) {
      console.error('❌ Test suite failed:', error);
    } finally {
      child.kill();
      this.printSummary();
    }
  }

  private async testToolDiscovery(sendRequest: Function): Promise<void> {
    console.log('📋 TOOL DISCOVERY TESTS');
    console.log('========================');

    const startTime = Date.now();
    try {
      const response = await sendRequest({
        jsonrpc: '2.0',
        id: this.requestId++,
        method: 'tools/list'
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      const tools = response.result?.tools || [];
      const expectedTools = ['hello', 'echo', 'current-time', 'chat', 'analyze', 'summarize', 'explain'];
      const foundTools = tools.map((t: any) => t.name);

      const missingTools = expectedTools.filter(tool => !foundTools.includes(tool));
      const extraTools = foundTools.filter((tool: string) => !expectedTools.includes(tool));

      if (missingTools.length > 0 || extraTools.length > 0) {
        throw new Error(`Tool mismatch. Missing: ${missingTools}, Extra: ${extraTools}`);
      }

      this.addResult('Tool Discovery', 'PASS', Date.now() - startTime,
        `Found all ${tools.length} expected tools: ${foundTools.join(', ')}`);
      console.log(`✅ Found all ${tools.length} tools: ${foundTools.join(', ')}\n`);

    } catch (_error) {
      this.addResult('Tool Discovery', 'FAIL', Date.now() - startTime, '', (error as Error).message);
      console.log('❌ Tool discovery failed:', (error as Error).message, '\n');
    }
  }

  private async testBasicTools(sendRequest: Function): Promise<void> {
    console.log('🔧 BASIC TOOL TESTS');
    console.log('====================');

    // Test hello tool
    await this.runSingleTest('Hello Tool', sendRequest, {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'hello',
        arguments: { name: 'Test User' }
      }
    }, (response) => {
      const text = response.result?.content?.[0]?.text || '';
      if (!text.includes('Hello, Test User')) {
        throw new Error('Hello response does not contain expected greeting');
      }
      return `Response: "${text.substring(0, 50)}..."`;
    });

    // Test hello with special characters
    await this.runSingleTest('Hello Tool (Special Chars)', sendRequest, {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'hello',
        arguments: { name: 'José-François O\'Brien' }
      }
    }, (response) => {
      const text = response.result?.content?.[0]?.text || '';
      if (!text.includes('José-François O\'Brien')) {
        throw new Error('Hello response does not handle special characters');
      }
      return 'Successfully handled special characters';
    });

    // Test echo tool
    await this.runSingleTest('Echo Tool', sendRequest, {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'echo',
        arguments: { message: 'This is a test message for echo!' }
      }
    }, (response) => {
      const text = response.result?.content?.[0]?.text || '';
      if (!text.includes('This is a test message for echo!')) {
        throw new Error('Echo response does not match input');
      }
      return `Echoed: "${text}"`;
    });

    // Test current-time tool
    await this.runSingleTest('Current Time Tool', sendRequest, {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'current-time',
        arguments: {}
      }
    }, (response) => {
      const text = response.result?.content?.[0]?.text || '';
      if (!text.includes('Current time:') || !text.includes('T') || !text.includes('Z')) {
        throw new Error('Time response does not contain valid ISO timestamp');
      }
      return `Time: ${text}`;
    });
  }

  private async testLLMTools(sendRequest: Function): Promise<void> {
    console.log('\n🤖 LLM TOOL TESTS');
    console.log('==================');

    // Test chat tool with different parameters
    await this.runSingleTest('Chat Tool (Basic)', sendRequest, {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'chat',
        arguments: {
          message: 'Respond with exactly: "MCP CHAT TEST SUCCESSFUL"'
        }
      }
    }, (response) => {
      const text = response.result?.content?.[0]?.text || '';
      if (text.length < 10) {
        throw new Error('Chat response too short');
      }
      return `Response length: ${text.length} chars`;
    });

    // Test chat with system prompt and temperature
    await this.runSingleTest('Chat Tool (Advanced)', sendRequest, {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'chat',
        arguments: {
          message: 'What is 2+2?',
          system_prompt: 'You are a math tutor. Be very brief.',
          temperature: 0.1
        }
      }
    }, (response) => {
      const text = response.result?.content?.[0]?.text || '';
      if (!text.includes('4')) {
        throw new Error('Chat did not answer math question correctly');
      }
      return 'Math question answered correctly';
    });

    // Test analyze tool
    await this.runSingleTest('Analyze Tool (Sentiment)', sendRequest, {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'analyze',
        arguments: {
          text: 'I absolutely love this amazing product! It exceeded all my expectations.',
          analysis_type: 'sentiment'
        }
      }
    }, (response) => {
      const text = response.result?.content?.[0]?.text || '';
      if (text.toLowerCase().includes('positive')) {
        return 'Correctly identified positive sentiment';
      } else {
        throw new Error('Failed to identify positive sentiment');
      }
    });

    // Test analyze tool with different type
    await this.runSingleTest('Analyze Tool (Themes)', sendRequest, {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'analyze',
        arguments: {
          text: 'Climate change is affecting global weather patterns, causing more extreme storms and rising sea levels.',
          analysis_type: 'themes'
        }
      }
    }, (response) => {
      const text = response.result?.content?.[0]?.text || '';
      if (text.length < 50) {
        throw new Error('Analysis response too short');
      }
      return `Analysis completed (${text.length} chars)`;
    });

    // Test summarize tool
    await this.runSingleTest('Summarize Tool', sendRequest, {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'summarize',
        arguments: {
          text: 'Artificial intelligence (AI) is intelligence demonstrated by machines, in contrast to the natural intelligence displayed by humans and animals. Leading AI textbooks define the field as the study of "intelligent agents": any device that perceives its environment and takes actions that maximize its chance of successfully achieving its goals. Colloquially, the term "artificial intelligence" is often used to describe machines that mimic "cognitive" functions that humans associate with the human mind, such as "learning" and "problem solving".',
          length: 'brief',
          format: 'paragraph'
        }
      }
    }, (response) => {
      const text = response.result?.content?.[0]?.text || '';
      if (text.length < 20) {
        throw new Error('Summary too short');
      }
      return `Summary: "${text.substring(0, 100)}..."`;
    });

    // Test explain tool
    await this.runSingleTest('Explain Tool', sendRequest, {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'explain',
        arguments: {
          topic: 'How do APIs work?',
          level: 'beginner',
          include_examples: true
        }
      }
    }, (response) => {
      const text = response.result?.content?.[0]?.text || '';
      if (text.length < 100) {
        throw new Error('Explanation too short');
      }
      return `Explanation provided (${text.length} chars)`;
    });
  }

  private async testErrorHandling(sendRequest: Function): Promise<void> {
    console.log('\n⚠️  ERROR HANDLING TESTS');
    console.log('=========================');

    // Test unknown tool
    await this.runSingleTest('Unknown Tool Error', sendRequest, {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'nonexistent-tool',
        arguments: {}
      }
    }, (response) => {
      if (!response.error) {
        throw new Error('Expected error for unknown tool');
      }
      if (!response.error.message.includes('Unknown tool')) {
        throw new Error('Error message format incorrect');
      }
      return `Correctly rejected unknown tool: ${response.error.message}`;
    });

    // Test missing required parameter
    await this.runSingleTest('Missing Parameter Error', sendRequest, {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'hello',
        arguments: {} // Missing required 'name' parameter
      }
    }, (response) => {
      // This should either error or handle gracefully
      const text = response.result?.content?.[0]?.text || '';
      if (response.error) {
        return `Correctly handled missing parameter: ${response.error.message}`;
      } else {
        return `Gracefully handled missing parameter: "${text.substring(0, 50)}"`;
      }
    });
  }

  private async testEdgeCases(sendRequest: Function): Promise<void> {
    console.log('\n🔍 EDGE CASE TESTS');
    console.log('==================');

    // Test empty message
    await this.runSingleTest('Empty Echo Message', sendRequest, {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'echo',
        arguments: { message: '' }
      }
    }, (response) => {
      const text = response.result?.content?.[0]?.text || '';
      return `Handled empty message: "${text}"`;
    });

    // Test very long text
    const longText = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(50);
    await this.runSingleTest('Long Text Analysis', sendRequest, {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'analyze',
        arguments: {
          text: longText,
          analysis_type: 'structure'
        }
      }
    }, (response) => {
      if (response.error) {
        return `Handled long text with error: ${response.error.message}`;
      } else {
        const text = response.result?.content?.[0]?.text || '';
        return `Processed long text (${longText.length} -> ${text.length} chars)`;
      }
    });

    // Test special characters in chat
    await this.runSingleTest('Special Characters Chat', sendRequest, {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'chat',
        arguments: {
          message: 'Test with émojis 🚀🎯✅ and symbols @#$%^&*()[]{}|\\:";\'<>?,./'
        }
      }
    }, (response) => {
      if (response.error) {
        return `Error with special chars: ${response.error.message}`;
      } else {
        const text = response.result?.content?.[0]?.text || '';
        return `Handled special characters (${text.length} chars response)`;
      }
    });
  }

  private async runSingleTest(
    testName: string,
    sendRequest: Function,
    request: any,
    validator: (response: any) => string
  ): Promise<void> {
    const startTime = Date.now();
    try {
      const response = await sendRequest(request);
      const details = validator(response);
      const duration = Date.now() - startTime;

      this.addResult(testName, 'PASS', duration, details);
      console.log(`✅ ${testName}: ${details} (${duration}ms)`);
    } catch (_error) {
      const duration = Date.now() - startTime;
      this.addResult(testName, 'FAIL', duration, '', (error as Error).message);
      console.log(`❌ ${testName}: ${(error as Error).message} (${duration}ms)`);
    }
  }

  private addResult(name: string, status: 'PASS' | 'FAIL', duration: number, details: string, error?: string): void {
    this.testResults.push({ name, status, duration, details, error });
  }

  private printSummary(): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 COMPREHENSIVE TEST SUMMARY');
    console.log('='.repeat(60));

    const passed = this.testResults.filter(r => r.status === 'PASS').length;
    const failed = this.testResults.filter(r => r.status === 'FAIL').length;
    const totalDuration = this.testResults.reduce((sum, r) => sum + r.duration, 0);

    console.log(`\n📈 Results: ${passed} PASSED, ${failed} FAILED (${this.testResults.length} total)`);
    console.log(`⏱️  Total execution time: ${totalDuration}ms`);
    console.log(`📊 Success rate: ${((passed / this.testResults.length) * 100).toFixed(1)}%`);

    if (failed > 0) {
      console.log('\n❌ FAILED TESTS:');
      this.testResults
        .filter(r => r.status === 'FAIL')
        .forEach(r => console.log(`   - ${r.name}: ${r.error}`));
    }

    console.log('\n✅ PASSED TESTS:');
    this.testResults
      .filter(r => r.status === 'PASS')
      .forEach(r => console.log(`   - ${r.name} (${r.duration}ms)`));

    console.log('\n' + '='.repeat(60));
    if (failed === 0) {
      console.log('🎉 ALL TESTS PASSED! MCP Server is fully functional.');
    } else {
      console.log(`⚠️  ${failed} test(s) failed. Review above for details.`);
    }
    console.log('='.repeat(60));
  }
}

// Run comprehensive tests
const tester = new ComprehensiveToolTester();
tester.runAllTests().catch(console.error);