#!/usr/bin/env tsx

/**
 * Test the MCP API endpoint specifically
 */

// Mock VercelRequest and VercelResponse for MCP testing
class MockVercelRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: any;

  constructor(method: string, url: string, headers: Record<string, string> = {}, body?: any) {
    this.method = method;
    this.url = url;
    this.headers = headers;
    this.body = body;
  }
}

class MockVercelResponse {
  private statusCode: number = 200;
  private headers: Record<string, string> = {};
  private responseData: any;
  private ended: boolean = false;
  private chunks: string[] = [];

  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  status(code: number) {
    this.statusCode = code;
    return {
      json: (data: any) => this.json(data),
      end: () => this.end(),
    };
  }

  json(data: any) {
    this.responseData = data;
    this.ended = true;
    console.log(`📊 JSON Response [${this.statusCode}]:`, JSON.stringify(data, null, 2));
    return this;
  }

  write(chunk: string) {
    this.chunks.push(chunk);
    console.log(`📝 Stream chunk:`, chunk);
  }

  end(data?: string) {
    if (data) this.chunks.push(data);
    this.ended = true;
    console.log(`✅ Stream ended with status ${this.statusCode}`);
    return this;
  }

  getResponse() {
    return {
      statusCode: this.statusCode,
      headers: this.headers,
      data: this.responseData,
      chunks: this.chunks,
    };
  }
}

async function testMCPOptions() {
  console.log('🔧 Testing MCP OPTIONS (CORS preflight)');
  console.log('======================================');

  try {
    const { default: mcpHandler } = await import('./api/mcp.js');

    const req = new MockVercelRequest('OPTIONS', '/api/mcp', {
      'Origin': 'http://localhost:3000',
      'Access-Control-Request-Method': 'POST',
    });
    const res = new MockVercelResponse();

    await mcpHandler(req as any, res as any);

    return res.getResponse();
  } catch (error) {
    console.error('❌ MCP OPTIONS error:', error);
    throw error;
  }
}

async function testMCPInitialize() {
  console.log('\n🚀 Testing MCP Initialize Request');
  console.log('===============================');

  try {
    const { default: mcpHandler } = await import('./api/mcp.js');

    const mcpInitRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '1.0.0',
        capabilities: {
          tools: {}
        },
        clientInfo: {
          name: 'test-client',
          version: '1.0.0'
        }
      }
    };

    const req = new MockVercelRequest('POST', '/api/mcp', {
      'Content-Type': 'application/json',
      'User-Agent': 'test-client/1.0.0'
    }, mcpInitRequest);
    const res = new MockVercelResponse();

    await mcpHandler(req as any, res as any);

    return res.getResponse();
  } catch (error) {
    console.error('❌ MCP Initialize error:', error);
    throw error;
  }
}

async function runMCPTests() {
  console.log('🧪 Testing MCP API Endpoint');
  console.log('===========================\n');

  const results: any[] = [];

  try {
    // Test OPTIONS request
    const optionsResult = await testMCPOptions();
    results.push({ test: 'OPTIONS (CORS)', success: true, response: optionsResult });
  } catch (error) {
    results.push({ test: 'OPTIONS (CORS)', success: false, error: error.message });
  }

  try {
    // Test MCP Initialize
    const initResult = await testMCPInitialize();
    results.push({ test: 'MCP Initialize', success: true, response: initResult });
  } catch (error) {
    results.push({ test: 'MCP Initialize', success: false, error: error.message });
  }

  // Summary
  console.log('\n📋 MCP Test Summary');
  console.log('==================');

  results.forEach(result => {
    if (result.success) {
      console.log(`✅ ${result.test}: SUCCESS (${result.response.statusCode})`);
    } else {
      console.log(`❌ ${result.test}: FAILED - ${result.error}`);
    }
  });

  const successCount = results.filter(r => r.success).length;
  console.log(`\n🎯 MCP Results: ${successCount}/${results.length} tests passing`);

  return results;
}

runMCPTests().catch(console.error);