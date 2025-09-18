#!/usr/bin/env npx tsx

import { spawn, ChildProcess } from 'child_process';
import { createInterface } from 'readline';

interface MCPRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params?: unknown;
}

interface MCPResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: unknown;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

class InteractiveMCPClient {
  private server: ChildProcess | null = null;
  private requestId = 1;
  private pendingRequests = new Map<number, (response: MCPResponse) => void>();
  private rl: unknown;
  private availableTools: MCPTool[] = [];

  async start(): Promise<void> {
    console.log('🚀 Starting Interactive MCP Client');
    console.log('=====================================\n');

    // Start the MCP server
    await this.startServer();

    // Load available tools dynamically
    await this.loadAvailableTools();

    // Set up readline for user input
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'mcp> '
    });

    // Show available commands
    await this.showHelp();

    // Start interactive loop
    this.rl.on('line', (input: string) => {
      this.handleUserInput(input.trim());
    });

    this.rl.on('close', () => {
      console.log('\n👋 Goodbye!');
      this.cleanup();
    });

    this.rl.prompt();
  }

  private async startServer(): Promise<void> {
    this.server = spawn('npx', ['tsx', 'src/index.ts'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
    });

    if (!this.server.stdout || !this.server.stderr || !this.server.stdin) {
      throw new Error('Failed to start server');
    }

    // Handle server responses
    this.server.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim() && line.startsWith('{')) {
          try {
            const response = JSON.parse(line);
            const callback = this.pendingRequests.get(response.id);
            if (callback) {
              callback(response);
              this.pendingRequests.delete(response.id);
            }
          } catch {
            // Ignore parsing errors for non-JSON output
          }
        }
      }
    });

    this.server.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('MCP TypeScript Simple server running')) {
        console.log('✅ MCP server started successfully\n');
      }
    });

    this.server.on('close', (code) => {
      console.log(`\n⚠️  MCP server exited with code ${code}`);
      process.exit(1);
    });

    // Give server time to start
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  private async loadAvailableTools(): Promise<void> {
    try {
      console.log('🔍 Discovering available tools...');

      const response = await this.sendRequest({
        jsonrpc: '2.0',
        id: this.requestId++,
        method: 'tools/list'
      });

      if (response.error) {
        console.error('❌ Failed to load tools:', response.error.message);
        this.availableTools = [];
        return;
      }

      this.availableTools = response.result?.tools || [];
      console.log(`✅ Loaded ${this.availableTools.length} tools\n`);
    } catch (error) {
      console.error('❌ Error loading tools:', error);
      this.availableTools = [];
    }
  }

  private async showHelp(): Promise<void> {
    console.log('Available commands:');
    console.log('  help                    - Show this help message');
    console.log('  list                    - List available tools');
    console.log('  describe <tool>         - Show detailed tool information');

    // Dynamically show available tools
    if (this.availableTools.length > 0) {
      console.log('\nAvailable tools:');
      for (const tool of this.availableTools) {
        const params = this.getToolParameters(tool);
        console.log(`  ${tool.name} ${params} - ${tool.description}`);
      }
    }

    console.log('\nOther commands:');
    console.log('  call <tool> <args>      - Call a tool with arguments (JSON format)');
    console.log('  raw <json>              - Send raw JSON-RPC request');
    console.log('  quit, exit              - Exit the client');
    console.log();
  }

  private getToolParameters(tool: MCPTool): string {
    if (!tool.inputSchema?.properties) {
      return '';
    }

    const properties = tool.inputSchema.properties;
    const required = tool.inputSchema.required || [];

    const params = Object.keys(properties).map(key => {
      const isRequired = required.includes(key);
      return isRequired ? `<${key}>` : `[${key}]`;
    });

    return params.join(' ');
  }

  private async handleUserInput(input: string): Promise<void> {
    const [command, ...args] = input.split(' ');

    try {
      switch (command.toLowerCase()) {
        case 'help':
          await this.showHelp();
          break;

        case 'list':
          await this.listTools();
          break;

        case 'describe':
          if (args.length === 0) {
            console.log('❌ Usage: describe <tool-name>');
          } else {
            await this.describeTool(args[0]);
          }
          break;

        case 'call':
          if (args.length < 2) {
            console.log('❌ Usage: call <tool-name> <json-args>');
            console.log('   Example: call hello {"name": "World"}');
          } else {
            const toolName = args[0];
            const argsJson = args.slice(1).join(' ');
            await this.callToolWithJson(toolName, argsJson);
          }
          break;

        case 'raw':
          if (args.length === 0) {
            console.log('❌ Usage: raw <json-request>');
          } else {
            await this.sendRawRequest(args.join(' '));
          }
          break;

        case 'quit':
        case 'exit':
          this.rl.close();
          return;

        case '':
          // Empty input, just continue
          break;

        default:
          // Check if command matches a tool name
          const tool = this.availableTools.find(t => t.name === command.toLowerCase());
          if (tool) {
            await this.callToolWithArgs(tool, args);
          } else {
            console.log(`❌ Unknown command: ${command}`);
            console.log('Type "help" for available commands');
          }
      }
    } catch (error) {
      console.error('❌ Error:', error);
    }

    this.rl.prompt();
  }

  private async listTools(): Promise<void> {
    console.log('📋 Available tools:');

    if (this.availableTools.length === 0) {
      console.log('  No tools available');
      return;
    }

    this.availableTools.forEach((tool) => {
      const params = this.getToolParameters(tool);
      console.log(`  • ${tool.name} ${params}`);
      console.log(`    ${tool.description}`);
      console.log();
    });
  }

  private async describeTool(toolName: string): Promise<void> {
    const tool = this.availableTools.find(t => t.name === toolName);

    if (!tool) {
      console.log(`❌ Tool '${toolName}' not found`);
      return;
    }

    console.log(`🔧 Tool: ${tool.name}`);
    console.log(`Description: ${tool.description}`);

    if (tool.inputSchema?.properties) {
      console.log('Parameters:');
      const properties = tool.inputSchema.properties;
      const required = tool.inputSchema.required || [];

      Object.entries(properties).forEach(([name, schema]: [string, unknown]) => {
        const schemaObj = schema as { type?: string; description?: string };
        const isRequired = required.includes(name);
        const requiredText = isRequired ? ' (required)' : ' (optional)';
        console.log(`  • ${name}: ${schemaObj.type}${requiredText}`);
        if (schemaObj.description) {
          console.log(`    ${schemaObj.description}`);
        }
      });
    } else {
      console.log('Parameters: None');
    }

    console.log();
    console.log(`Usage examples:`);
    console.log(`  ${tool.name} <args...>     # Simple format`);
    console.log(`  call ${tool.name} {...}   # JSON format`);
  }

  private async callToolWithArgs(tool: MCPTool, args: string[]): Promise<void> {
    try {
      // Try to intelligently parse arguments based on tool schema
      const toolArgs = await this.parseToolArguments(tool, args);
      await this.callTool(tool.name, toolArgs);
    } catch (error) {
      console.log(`❌ Error parsing arguments: ${error}`);
      console.log(`Use: call ${tool.name} <json-args> for precise control`);
    }
  }

  private async parseToolArguments(tool: MCPTool, args: string[]): Promise<Record<string, unknown>> {
    if (!tool.inputSchema?.properties) {
      return {};
    }

    const properties = tool.inputSchema.properties;
    const propertyNames = Object.keys(properties);
    const result: Record<string, unknown> = {};

    // Simple heuristic: map positional arguments to required parameters first
    const required = tool.inputSchema.required || [];
    const requiredParams = propertyNames.filter(p => required.includes(p));

    // Map arguments to parameters
    requiredParams.forEach((param, index) => {
      if (index < args.length) {
        const value = args[index];
        const paramSchema = properties[param] as { type?: string };

        // Basic type conversion
        if (paramSchema.type === 'number') {
          result[param] = Number(value);
        } else if (paramSchema.type === 'boolean') {
          result[param] = value.toLowerCase() === 'true';
        } else {
          result[param] = value;
        }
      }
    });

    // If we have remaining args and only one string parameter, join them
    if (args.length > requiredParams.length && requiredParams.length === 1) {
      const firstParam = requiredParams[0];
      const firstParamSchema = properties[firstParam] as { type?: string };
      if (firstParamSchema.type === 'string') {
        result[firstParam] = args.join(' ');
      }
    }

    return result;
  }

  private async callToolWithJson(toolName: string, argsJson: string): Promise<void> {
    try {
      const args = JSON.parse(argsJson);
      await this.callTool(toolName, args);
    } catch (error) {
      console.log('❌ Invalid JSON arguments:', error);
    }
  }

  private async callTool(name: string, args: unknown): Promise<void> {
    console.log(`🔧 Calling tool: ${name}`);

    const response = await this.sendRequest({
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name,
        arguments: args
      }
    });

    if (response.error) {
      console.error('❌ Tool call failed:', response.error.message);
    } else {
      const content = response.result?.content?.[0]?.text;
      console.log('✅ Result:', content);
    }
  }

  private async sendRawRequest(jsonStr: string): Promise<void> {
    try {
      const request = JSON.parse(jsonStr);
      request.id = this.requestId++;
      request.jsonrpc = '2.0';

      console.log('📤 Sending raw request...');
      const response = await this.sendRequest(request);

      console.log('📥 Raw response:');
      console.log(JSON.stringify(response, null, 2));
    } catch (error) {
      console.error('❌ Invalid JSON:', error);
    }
  }

  private async sendRequest(request: MCPRequest): Promise<MCPResponse> {
    return new Promise((resolve, reject) => {
      if (!this.server?.stdin) {
        reject(new Error('Server not running'));
        return;
      }

      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error('Request timeout'));
      }, 10000);

      // Store callback
      this.pendingRequests.set(request.id, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });

      // Send request
      this.server.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  private cleanup(): void {
    if (this.server) {
      this.server.kill();
    }
    process.exit(0);
  }
}

// Run client if this file is executed directly
const client = new InteractiveMCPClient();
client.start().catch(console.error);

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  process.exit(0);
});