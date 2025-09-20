#!/usr/bin/env tsx

/**
 * Test MCP API with proper Node.js response interface
 */

import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';

async function testMCPWithProperInterface() {
  console.log('🧪 Testing MCP API with proper Node.js interface');
  console.log('================================================\n');

  try {
    const { default: mcpHandler } = await import('./api/mcp.js');

    // Create a minimal socket
    const socket = new Socket();

    // Create proper IncomingMessage
    const req = new IncomingMessage(socket);
    req.method = 'POST';
    req.url = '/api/mcp';
    req.headers = {
      'content-type': 'application/json',
      'user-agent': 'test-client/1.0.0'
    };

    // Add body data
    const mcpRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '1.0.0',
        capabilities: { tools: {} },
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    };

    (req as any).body = mcpRequest;

    // Create proper ServerResponse
    const res = new ServerResponse(req);

    // Capture response data
    let responseData = '';
    let statusCode = 200;
    let headers: Record<string, string> = {};

    // Override write methods to capture output
    const originalWrite = res.write.bind(res);
    const originalWriteHead = res.writeHead.bind(res);
    const originalSetHeader = res.setHeader.bind(res);
    const originalEnd = res.end.bind(res);

    res.write = function(chunk: any) {
      responseData += chunk;
      console.log('📝 Stream chunk:', chunk.toString());
      return true;
    };

    res.writeHead = function(code: number, headers?: any) {
      statusCode = code;
      console.log(`📊 Response headers [${code}]:`, headers);
      return res;
    };

    res.setHeader = function(name: string, value: string | string[]) {
      headers[name] = Array.isArray(value) ? value.join(', ') : value;
      console.log(`📋 Header: ${name} = ${value}`);
      return res;
    };

    res.end = function(data?: any) {
      if (data) responseData += data;
      console.log(`✅ Response ended with status ${statusCode}`);
      console.log(`📄 Final response data:`, responseData);
      return res;
    };

    // Test the handler
    console.log('🚀 Calling MCP handler...');
    await mcpHandler(req as any, res as any);

    return {
      statusCode,
      headers,
      data: responseData
    };

  } catch (error) {
    console.error('❌ MCP test error:', error);
    throw error;
  }
}

async function testMCPOptions() {
  console.log('\n🔧 Testing MCP OPTIONS request');
  console.log('==============================');

  try {
    const { default: mcpHandler } = await import('./api/mcp.js');

    const socket = new Socket();
    const req = new IncomingMessage(socket);
    req.method = 'OPTIONS';
    req.url = '/api/mcp';
    req.headers = {
      'origin': 'http://localhost:3000',
      'access-control-request-method': 'POST'
    };

    const res = new ServerResponse(req);
    let statusCode = 200;

    res.writeHead = function(code: number, headers?: any) {
      statusCode = code;
      console.log(`📊 OPTIONS response [${code}]:`, headers);
      return res;
    };

    res.end = function() {
      console.log(`✅ OPTIONS ended with status ${statusCode}`);
      return res;
    };

    await mcpHandler(req as any, res as any);

    return { statusCode };

  } catch (error) {
    console.error('❌ OPTIONS test error:', error);
    throw error;
  }
}

async function runTests() {
  const results: any[] = [];

  try {
    const optionsResult = await testMCPOptions();
    results.push({ test: 'OPTIONS', success: true, statusCode: optionsResult.statusCode });
  } catch (error) {
    results.push({ test: 'OPTIONS', success: false, error: error.message });
  }

  try {
    const mcpResult = await testMCPWithProperInterface();
    results.push({ test: 'MCP Initialize', success: true, statusCode: mcpResult.statusCode });
  } catch (error) {
    results.push({ test: 'MCP Initialize', success: false, error: error.message });
  }

  console.log('\n📋 Final Test Summary');
  console.log('====================');

  results.forEach(result => {
    if (result.success) {
      console.log(`✅ ${result.test}: SUCCESS (${result.statusCode})`);
    } else {
      console.log(`❌ ${result.test}: FAILED - ${result.error}`);
    }
  });

  const successCount = results.filter(r => r.success).length;
  console.log(`\n🎯 Results: ${successCount}/${results.length} tests working`);
}

runTests().catch(console.error);