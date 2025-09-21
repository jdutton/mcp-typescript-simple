#!/usr/bin/env tsx

/**
 * Direct test of Vercel API functions
 */

// Mock VercelRequest and VercelResponse
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
    console.log(`📊 Response [${this.statusCode}]:`, JSON.stringify(data, null, 2));
    return this;
  }

  end() {
    this.ended = true;
    console.log(`✅ Response ended with status ${this.statusCode}`);
    return this;
  }

  getResponse() {
    return {
      statusCode: this.statusCode,
      headers: this.headers,
      data: this.responseData,
    };
  }
}

async function testHealthEndpoint() {
  console.log('🏥 Testing Health Endpoint');
  console.log('========================');

  try {
    const { default: healthHandler } = await import('../api/health.js');

    const req = new MockVercelRequest('GET', '/api/health');
    const res = new MockVercelResponse();

    await healthHandler(req as any, res as any);

    return res.getResponse();
  } catch (error) {
    console.error('❌ Health endpoint error:', error);
    throw error;
  }
}

async function testAdminEndpoint() {
  console.log('\n🔧 Testing Admin Endpoint');
  console.log('========================');

  try {
    const { default: adminHandler } = await import('../api/admin.js');

    const req = new MockVercelRequest('GET', '/api/admin/info');
    const res = new MockVercelResponse();

    await adminHandler(req as any, res as any);

    return res.getResponse();
  } catch (error) {
    console.error('❌ Admin endpoint error:', error);
    throw error;
  }
}

async function testAdminMetrics() {
  console.log('\n📊 Testing Admin Metrics Endpoint');
  console.log('===============================');

  try {
    const { default: adminHandler } = await import('../api/admin.js');

    const req = new MockVercelRequest('GET', '/api/admin/metrics');
    const res = new MockVercelResponse();

    await adminHandler(req as any, res as any);

    return res.getResponse();
  } catch (error) {
    console.error('❌ Admin metrics error:', error);
    throw error;
  }
}

async function runTests() {
  console.log('🧪 Testing Vercel API Functions');
  console.log('================================\n');

  const results: any[] = [];

  try {
    // Test health endpoint
    const healthResult = await testHealthEndpoint();
    results.push({ endpoint: 'health', success: true, response: healthResult });
  } catch (error) {
    results.push({ endpoint: 'health', success: false, error: error.message });
  }

  try {
    // Test admin info
    const adminResult = await testAdminEndpoint();
    results.push({ endpoint: 'admin/info', success: true, response: adminResult });
  } catch (error) {
    results.push({ endpoint: 'admin/info', success: false, error: error.message });
  }

  try {
    // Test admin metrics
    const metricsResult = await testAdminMetrics();
    results.push({ endpoint: 'admin/metrics', success: true, response: metricsResult });
  } catch (error) {
    results.push({ endpoint: 'admin/metrics', success: false, error: error.message });
  }

  // Summary
  console.log('\n📋 Test Summary');
  console.log('===============');

  results.forEach(result => {
    if (result.success) {
      console.log(`✅ ${result.endpoint}: SUCCESS (${result.response.statusCode})`);
    } else {
      console.log(`❌ ${result.endpoint}: FAILED - ${result.error}`);
    }
  });

  const successCount = results.filter(r => r.success).length;
  console.log(`\n🎯 Results: ${successCount}/${results.length} endpoints working`);
}

runTests().catch(console.error);