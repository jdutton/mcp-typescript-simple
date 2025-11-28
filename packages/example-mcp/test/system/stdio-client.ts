/**
 * STDIO Test Client for MCP System Testing
 *
 * Provides a test client that communicates with MCP server via STDIO transport
 * using JSON-RPC messages over stdin/stdout pipes.
 *
 * Features:
 * - Automatic signal handling (CTRL-C cleanup)
 * - Graceful shutdown with SIGTERM → SIGKILL cascade
 */

import { spawn, ChildProcess } from 'node:child_process';
import { registerProcess } from '@mcp-typescript-simple/testing/signal-handler';

export interface MCPRequest {
  jsonrpc: '2.0';
  method: string;
  params?: any;
  id: string | number;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: string | number;
}

export interface STDIOClientOptions {
  timeout?: number;
  startupDelay?: number;
}

export class STDIOTestClient {
  private server: ChildProcess | null = null;
  private requestId = 1;
  private pendingRequests = new Map<number, {
    resolve: (response: MCPResponse) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private readonly options: Required<STDIOClientOptions>;
  private isStarted = false;
  private unregisterSignalHandler?: () => void;

  constructor(options: STDIOClientOptions = {}) {
    this.options = {
      timeout: options.timeout || 10000,
      startupDelay: options.startupDelay || 2000
    };
  }

  /**
   * Start the MCP server process and set up communication
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      throw new Error('STDIO client already started');
    }

    console.log('🚀 Starting MCP server in STDIO mode...');

    // Start the MCP server process
    this.server = spawn('npx', ['tsx', 'packages/example-mcp/src/index.ts'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        MCP_DEV_SKIP_AUTH: 'true'
      }
    });

    if (!this.server.stdout || !this.server.stderr || !this.server.stdin) {
      throw new Error('Failed to start MCP server - stdio pipes not available');
    }

    // Register with signal handler for automatic CTRL-C cleanup
    this.unregisterSignalHandler = registerProcess(this.server);

    // Set up response handling
    this.server.stdout.on('data', (data) => {
      this.handleServerOutput(data);
    });

    // Handle server errors
    this.server.stderr.on('data', (data) => {
      const message = data.toString().trim();

      // Skip normal startup and configuration messages
      const normalMessages = [
        'Starting MCP',
        'Environment:',
        'Configuration:',
        'Secrets Status:',
        'OAuth (google):',
        'LLM Providers:',
        'Missing LLM API key values:',
        'LLM initialization failed',
        'To enable LLM tools, set API keys:',
        'server running on stdio',
        'Transport: Standard Input/Output',
        'Basic tools only (no LLM providers configured)',
        '• Total secrets:',
        '• Configured:',
        '• Missing:',
        'missing credentials',
        'none configured'
      ];

      // Skip expected test behavior messages
      const expectedTestMessages = [
        'Tool execution error for nonexistent-tool',
        'Unknown tool: nonexistent-tool'
      ];

      // Skip JSON configuration dumps
      const isJsonConfig = message.startsWith('{') && message.includes('"MCP_MODE"');

      // Only log if it's not a normal/expected message and not empty
      const isNormalMessage = normalMessages.some(pattern => message.includes(pattern));
      const isExpectedTest = expectedTestMessages.some(pattern => message.includes(pattern));

      if (!isNormalMessage && !isExpectedTest && !isJsonConfig && message) {
        console.error('📢 Server stderr:', message);
      }
    });

    // Handle server exit
    this.server.on('exit', (code, signal) => {
      console.log(`⚠️  MCP server exited (code: ${code}, signal: ${signal})`);
      this.cleanup();
    });

    this.server.on('error', (error) => {
      console.error('❌ MCP server process error:', error);
      this.cleanup();
    });

    // Wait for server to start up
    await new Promise(resolve => {
      const startupTimer = setTimeout(resolve, this.options.startupDelay);
      startupTimer.unref();
    });

    this.isStarted = true;
    console.log('✅ MCP server started in STDIO mode');
  }

  /**
   * Send a JSON-RPC request to the MCP server
   */
  async sendRequest(request: Omit<MCPRequest, 'id'>): Promise<MCPResponse> {
    if (!this.server || !this.server.stdin) {
      throw new Error('MCP server not started or stdin not available');
    }

    const id = this.requestId++;
    const fullRequest: MCPRequest = { ...request, id };

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timed out after ${this.options.timeout}ms`));
      }, this.options.timeout);

      // Store the pending request
      this.pendingRequests.set(id, { resolve, reject, timer });

      // Send the request
      try {
        const requestJson = JSON.stringify(fullRequest) + '\n';
        this.server!.stdin!.write(requestJson);
      } catch (error) {
        this.pendingRequests.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /**
   * List available tools
   */
  async listTools(): Promise<any[]> {
    const response = await this.sendRequest({
      jsonrpc: '2.0',
      method: 'tools/list'
    });

    if (response.error) {
      throw new Error(`Failed to list tools: ${response.error.message}`);
    }

    return response.result?.tools || [];
  }

  /**
   * Call a specific tool
   */
  async callTool(name: string, args: any = {}): Promise<any> {
    const response = await this.sendRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name,
        arguments: args
      }
    });

    if (response.error) {
      throw new Error(`Tool call failed: ${response.error.message}`);
    }

    return response.result;
  }

  /**
   * Stop the MCP server and clean up resources
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    console.log('🛑 Stopping MCP server...');

    this.cleanup();

    // Wait a bit for graceful shutdown
    await new Promise(resolve => {
      const shutdownTimer = setTimeout(resolve, 500);
      shutdownTimer.unref();
    });

    console.log('✅ MCP server stopped');
  }

  /**
   * Check if the client is ready to use
   */
  isReady(): boolean {
    return this.isStarted && this.server !== null && !this.server.killed;
  }

  /**
   * Handle data received from server stdout
   */
  private handleServerOutput(data: Buffer): void {
    const lines = data.toString().split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      try {
        // Try to parse as JSON-RPC response
        const response: MCPResponse = JSON.parse(trimmedLine);

        if (typeof response.id !== 'undefined') {
          const pending = this.pendingRequests.get(Number(response.id));
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(Number(response.id));
            pending.resolve(response);
          }
        }
      } catch {
        // Not JSON or not a valid response - might be server logs
        // Only log if it looks like an actual message and not startup noise
        if (trimmedLine.length > 0 && !trimmedLine.includes('MCP TypeScript Simple')) {
          console.log('📢 Server output:', trimmedLine);
        }
      }
    }
  }

  /**
   * Clean up resources and reject pending requests
   */
  private cleanup(): void {
    this.isStarted = false;

    // Reject all pending requests
    this.pendingRequests.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(new Error('Server connection lost'));
    });
    this.pendingRequests.clear();

    // Unregister from signal handler
    if (this.unregisterSignalHandler) {
      this.unregisterSignalHandler();
      this.unregisterSignalHandler = undefined;
    }

    // Kill server process if still running
    if (this.server && !this.server.killed) {
      this.server.kill('SIGTERM');

      // Force kill after a timeout
      const forceKillTimer = setTimeout(() => {
        if (this.server && !this.server.killed) {
          this.server.kill('SIGKILL');
        }
      }, 2000);

      // Unref the timer so it doesn't keep the process alive
      forceKillTimer.unref();
    }

    this.server = null;
  }
}