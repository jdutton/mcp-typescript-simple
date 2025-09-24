#!/usr/bin/env -S npx tsx

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
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
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

interface MCPCapabilities {
  tools?: {
    listChanged?: boolean;
  };
  resources?: {
    listChanged?: boolean;
  };
  prompts?: {
    listChanged?: boolean;
  };
  sampling?: Record<string, unknown>;
}

interface MCPInitializeResponse {
  protocolVersion: string;
  capabilities: MCPCapabilities;
  serverInfo: {
    name: string;
    version: string;
  };
  instructions?: string;
}

enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  VERBOSE = 3,
  DEBUG = 4
}

interface ClientConfig {
  url: string;
  bearerToken: string;
  timeout: number;
  logLevel: LogLevel;
  interactive: boolean;
}

class MCPLogger {
  constructor(private level: LogLevel) {}

  private log(level: LogLevel, emoji: string, message: string, data?: unknown): void {
    if (level <= this.level) {
      const timestamp = new Date().toISOString();
      const prefix = `${emoji} [${timestamp}]`;

      if (data !== undefined) {
        console.log(`${prefix} ${message}`, data);
      } else {
        console.log(`${prefix} ${message}`);
      }
    }
  }

  error(message: string, data?: unknown): void {
    this.log(LogLevel.ERROR, '❌', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log(LogLevel.WARN, '⚠️', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log(LogLevel.INFO, 'ℹ️', message, data);
  }

  verbose(message: string, data?: unknown): void {
    this.log(LogLevel.VERBOSE, '📝', message, data);
  }

  debug(message: string, data?: unknown): void {
    this.log(LogLevel.DEBUG, '🔍', message, data);
  }

  connection(message: string, data?: unknown): void {
    this.log(LogLevel.INFO, '🔗', message, data);
  }

  auth(message: string, data?: unknown): void {
    this.log(LogLevel.INFO, '🔐', message, data);
  }

  request(message: string, data?: unknown): void {
    this.log(LogLevel.VERBOSE, '📤', message, data);
  }

  response(message: string, data?: unknown): void {
    this.log(LogLevel.VERBOSE, '📥', message, data);
  }

  tool(message: string, data?: unknown): void {
    this.log(LogLevel.INFO, '🔧', message, data);
  }

  success(message: string, data?: unknown): void {
    this.log(LogLevel.INFO, '✅', message, data);
  }

  timing(message: string, data?: unknown): void {
    this.log(LogLevel.VERBOSE, '⏱️', message, data);
  }

  static sanitizeToken(token: string): string {
    if (token.length <= 20) {
      return token.substring(0, 8) + '...' + token.substring(token.length - 4);
    }
    return token.substring(0, 12) + '...' + token.substring(token.length - 8);
  }

  static sanitizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Hide sensitive query parameters
      const sensitiveParams = ['token', 'key', 'secret', 'password', 'auth'];
      for (const param of sensitiveParams) {
        if (parsed.searchParams.has(param)) {
          parsed.searchParams.set(param, '***');
        }
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }
}

class RequestTracker {
  private requests = new Map<number, {
    method: string;
    startTime: number;
    timeout?: NodeJS.Timeout;
  }>();

  track(id: number, method: string, timeoutMs: number): void {
    const startTime = Date.now();
    const timeout = setTimeout(() => {
      this.requests.delete(id);
    }, timeoutMs);

    this.requests.set(id, { method, startTime, timeout });
  }

  complete(id: number): { method: string; duration: number } | null {
    const request = this.requests.get(id);
    if (!request) return null;

    if (request.timeout) {
      clearTimeout(request.timeout);
    }

    this.requests.delete(id);
    return {
      method: request.method,
      duration: Date.now() - request.startTime
    };
  }

  cleanup(): void {
    for (const [id, request] of this.requests) {
      if (request.timeout) {
        clearTimeout(request.timeout);
      }
      this.requests.delete(id);
    }
  }
}

class ErrorAnalyzer {
  static analyze(error: unknown, context: { url?: string; method?: string; requestId?: number }): {
    category: string;
    message: string;
    hints: string[];
  } {
    const category = this.categorizeError(error);
    const message = this.extractMessage(error);
    const hints = this.generateHints(error, context, category);

    return { category, message, hints };
  }

  private static categorizeError(error: unknown): string {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return 'Network';
    }

    if (typeof error === 'object' && error !== null && 'status' in error) {
      const status = (error as { status: number }).status;
      if (status === 401 || status === 403) return 'Authentication';
      if (status >= 400 && status < 500) return 'Client';
      if (status >= 500) return 'Server';
    }

    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code: string }).code;
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') return 'Network';
      if (code === 'TIMEOUT') return 'Timeout';
    }

    return 'Unknown';
  }

  private static extractMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message: unknown }).message);
    }
    return 'Unknown error occurred';
  }

  private static generateHints(error: unknown, context: { url?: string; method?: string }, category: string): string[] {
    const hints: string[] = [];

    switch (category) {
      case 'Network':
        hints.push('Check if the server is running and accessible');
        hints.push('Verify the URL is correct and includes the proper protocol (http/https)');
        hints.push('Check network connectivity and firewall settings');
        if (context.url?.startsWith('https:')) {
          hints.push('Verify SSL/TLS certificate is valid');
        }
        break;

      case 'Authentication':
        hints.push('Verify the Bearer token is valid and not expired');
        hints.push('Check if the token has the required scopes/permissions');
        hints.push('Try refreshing or regenerating the authentication token');
        break;

      case 'Client':
        hints.push('Check the request format and parameters');
        if (context.method) {
          hints.push(`Verify that method '${context.method}' is supported by the server`);
        }
        hints.push('Review the MCP protocol version compatibility');
        break;

      case 'Server':
        hints.push('Server is experiencing internal issues');
        hints.push('Try again in a few moments');
        hints.push('Contact the server administrator if the issue persists');
        break;

      case 'Timeout':
        hints.push('Request took too long to complete');
        hints.push('Try increasing the timeout value');
        hints.push('Check if the server is overloaded');
        break;

      default:
        hints.push('Review the error details for more specific information');
        hints.push('Check the server logs if available');
    }

    return hints;
  }
}

class RemoteHTTPMCPClient {
  private requestId = 1;
  private requestTracker = new RequestTracker();
  private logger: MCPLogger;
  private availableTools: MCPTool[] = [];
  private initialized = false;
  private rl: any;

  constructor(private config: ClientConfig) {
    this.logger = new MCPLogger(config.logLevel);
  }

  async start(): Promise<void> {
    this.logger.info('Starting Remote HTTP MCP Client');
    this.logger.info('================================\n');

    try {
      await this.connect();
      await this.initialize();
      await this.loadAvailableTools();

      if (this.config.interactive) {
        await this.startInteractiveSession();
      }
    } catch (error) {
      const analysis = ErrorAnalyzer.analyze(error, { url: this.config.url });
      this.logger.error(`Startup failed (${analysis.category}): ${analysis.message}`);
      for (const hint of analysis.hints) {
        this.logger.debug(`Hint: ${hint}`);
      }
      process.exit(1);
    }
  }

  private async connect(): Promise<void> {
    const sanitizedUrl = MCPLogger.sanitizeUrl(this.config.url);
    const sanitizedToken = MCPLogger.sanitizeToken(this.config.bearerToken);

    this.logger.connection(`Connecting to MCP server: ${sanitizedUrl}`);
    this.logger.auth(`Authentication: Bearer ${sanitizedToken}`);

    // Connection test will be done during initialization
    this.logger.verbose('Connection test will be performed during MCP initialization');
  }

  private async initialize(): Promise<void> {
    this.logger.info('Initializing MCP session...');

    const initRequest: MCPRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          roots: { listChanged: true },
          sampling: {}
        },
        clientInfo: {
          name: 'remote-http-client',
          version: '1.0.0'
        }
      }
    };

    try {
      const response = await this.sendRequest(initRequest);

      if (response.error) {
        throw new Error(`Initialize failed: ${response.error.message}`);
      }

      const result = response.result as MCPInitializeResponse;
      this.logger.success(`Session initialized: protocol=${result.protocolVersion}`);
      this.logger.verbose('Server capabilities:', result.capabilities);
      this.logger.verbose('Server info:', result.serverInfo);

      if (result.instructions) {
        this.logger.info(`Server instructions: ${result.instructions}`);
      }

      this.initialized = true;
    } catch (error) {
      const analysis = ErrorAnalyzer.analyze(error, { method: 'initialize' });
      this.logger.error(`Initialize failed (${analysis.category}): ${analysis.message}`);
      throw error;
    }
  }

  private async loadAvailableTools(): Promise<void> {
    if (!this.initialized) {
      throw new Error('Client not initialized');
    }

    this.logger.verbose('Discovering available tools...');

    const toolsRequest: MCPRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/list',
      params: {}
    };

    try {
      const response = await this.sendRequest(toolsRequest);

      if (response.error) {
        this.logger.warn(`Failed to load tools: ${response.error.message}`);
        this.availableTools = [];
        return;
      }

      const result = response.result as { tools: MCPTool[] };
      this.availableTools = result.tools || [];
      this.logger.success(`Loaded ${this.availableTools.length} tools`);

      if (this.config.logLevel >= LogLevel.VERBOSE && this.availableTools.length > 0) {
        this.logger.verbose('Available tools:', this.availableTools.map(t => t.name));
      }
    } catch (error) {
      const analysis = ErrorAnalyzer.analyze(error, { method: 'tools/list' });
      this.logger.error(`Tool discovery failed (${analysis.category}): ${analysis.message}`);
      this.availableTools = [];
    }
  }

  private async sendRequest(request: MCPRequest): Promise<MCPResponse> {
    const startTime = Date.now();
    this.requestTracker.track(request.id, request.method, this.config.timeout);

    this.logger.request(`Request ID: ${request.id}, Method: ${request.method}`);
    if (this.config.logLevel >= LogLevel.DEBUG) {
      this.logger.debug('Full request:', request);
    }

    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': `Bearer ${this.config.bearerToken}`,
          'User-Agent': 'RemoteHTTPMCPClient/1.0.0'
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.config.timeout)
      });

      const duration = Date.now() - startTime;
      this.logger.timing(`Request completed (${duration}ms)`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const responseData = await response.json() as MCPResponse;
      this.logger.response(`Response ID: ${responseData.id}, Status: ${responseData.error ? 'Error' : 'Success'}`);

      if (this.config.logLevel >= LogLevel.DEBUG) {
        this.logger.debug('Full response:', responseData);
      }

      this.requestTracker.complete(request.id);
      return responseData;

    } catch (error) {
      const tracking = this.requestTracker.complete(request.id);
      const duration = tracking?.duration || Date.now() - startTime;

      const analysis = ErrorAnalyzer.analyze(error, {
        url: this.config.url,
        method: request.method,
        requestId: request.id
      });

      this.logger.error(`Request failed after ${duration}ms (${analysis.category}): ${analysis.message}`);

      if (this.config.logLevel >= LogLevel.VERBOSE) {
        for (const hint of analysis.hints) {
          this.logger.debug(`Hint: ${hint}`);
        }
      }

      throw error;
    }
  }

  private async startInteractiveSession(): Promise<void> {
    this.logger.info('\nStarting interactive session...');
    this.showHelp();

    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'mcp> '
    });

    this.rl.on('line', (input: string) => {
      this.handleUserInput(input.trim());
    });

    this.rl.on('close', () => {
      this.logger.info('\nGoodbye!');
      this.cleanup();
    });

    this.rl.prompt();
  }

  private showHelp(): void {
    console.log('\nAvailable commands:');
    console.log('  help                    - Show this help message');
    console.log('  list                    - List available tools');
    console.log('  describe <tool>         - Show detailed tool information');
    console.log('  call <tool> <json>      - Call a tool with JSON arguments');
    console.log('  raw <json>              - Send raw JSON-RPC request');
    console.log('  debug [on|off]          - Toggle debug logging');
    console.log('  quit, exit              - Exit the client');

    if (this.availableTools.length > 0) {
      console.log('\nAvailable tools:');
      for (const tool of this.availableTools) {
        const params = this.getToolParameters(tool);
        console.log(`  ${tool.name} ${params} - ${tool.description}`);
      }
    }
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
          this.showHelp();
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

        case 'debug':
          this.toggleDebug(args[0]);
          break;

        case 'quit':
        case 'exit':
          this.rl.close();
          return;

        case '':
          break;

        default:
          const tool = this.availableTools.find(t => t.name === command.toLowerCase());
          if (tool) {
            console.log('❌ For tool execution, use: call <tool-name> <json-args>');
          } else {
            console.log(`❌ Unknown command: ${command}`);
            console.log('Type "help" for available commands');
          }
      }
    } catch (error) {
      const analysis = ErrorAnalyzer.analyze(error, {});
      this.logger.error(`Command failed (${analysis.category}): ${analysis.message}`);
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

      Object.entries(properties).forEach(([name, schema]: [string, any]) => {
        const isRequired = required.includes(name);
        const requiredText = isRequired ? ' (required)' : ' (optional)';
        console.log(`  • ${name}: ${schema.type}${requiredText}`);
        if (schema.description) {
          console.log(`    ${schema.description}`);
        }
      });
    } else {
      console.log('Parameters: None');
    }

    console.log();
    console.log(`Usage: call ${tool.name} {...}`);
  }

  private async callToolWithJson(toolName: string, argsJson: string): Promise<void> {
    try {
      const args = JSON.parse(argsJson);
      await this.callTool(toolName, args);
    } catch (error) {
      console.log('❌ Invalid JSON arguments:', (error as Error).message);
    }
  }

  private async callTool(name: string, args: unknown): Promise<void> {
    this.logger.tool(`Calling tool: ${name}`);

    const toolRequest: MCPRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name,
        arguments: args
      }
    };

    try {
      const response = await this.sendRequest(toolRequest);

      if (response.error) {
        this.logger.error(`Tool call failed: ${response.error.message}`);
        if (response.error.data) {
          this.logger.debug('Error details:', response.error.data);
        }
      } else {
        const result = response.result as { content?: Array<{ text?: string; type?: string }> };
        const content = result.content?.[0]?.text;
        this.logger.success('Tool result:', content || result);
      }
    } catch (error) {
      const analysis = ErrorAnalyzer.analyze(error, { method: 'tools/call' });
      this.logger.error(`Tool execution failed (${analysis.category}): ${analysis.message}`);
    }
  }

  private async sendRawRequest(jsonStr: string): Promise<void> {
    try {
      const request = JSON.parse(jsonStr) as MCPRequest;
      request.id = this.requestId++;
      request.jsonrpc = '2.0';

      console.log('📤 Sending raw request...');
      const response = await this.sendRequest(request);

      console.log('📥 Raw response:');
      console.log(JSON.stringify(response, null, 2));
    } catch (error) {
      console.error('❌ Invalid JSON or request failed:', (error as Error).message);
    }
  }

  private toggleDebug(setting?: string): void {
    if (setting === 'on') {
      this.logger = new MCPLogger(LogLevel.DEBUG);
      console.log('✅ Debug logging enabled');
    } else if (setting === 'off') {
      this.logger = new MCPLogger(this.config.logLevel);
      console.log('✅ Debug logging disabled');
    } else {
      const current = this.logger['level'] === LogLevel.DEBUG ? 'on' : 'off';
      console.log(`Debug logging is currently: ${current}`);
      console.log('Usage: debug [on|off]');
    }
  }

  private cleanup(): void {
    this.requestTracker.cleanup();
    process.exit(0);
  }
}

// Command line argument parsing
function parseArgs(): ClientConfig {
  const args = process.argv.slice(2);
  const config: Partial<ClientConfig> = {
    timeout: 10000,
    logLevel: LogLevel.INFO,
    interactive: true
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--url':
        if (!next) throw new Error('--url requires a value');
        config.url = next;
        i++;
        break;

      case '--token':
        if (!next) throw new Error('--token requires a value');
        config.bearerToken = next;
        i++;
        break;

      case '--timeout':
        if (!next) throw new Error('--timeout requires a value');
        config.timeout = parseInt(next, 10);
        if (isNaN(config.timeout!)) throw new Error('--timeout must be a number');
        i++;
        break;

      case '--verbose':
      case '-v':
        config.logLevel = LogLevel.VERBOSE;
        break;

      case '--debug':
        config.logLevel = LogLevel.DEBUG;
        break;

      case '--no-interactive':
        config.interactive = false;
        break;

      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
        break;

      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
    }
  }

  if (!config.url) {
    throw new Error('--url is required');
  }

  if (!config.bearerToken) {
    throw new Error('--token is required');
  }

  return config as ClientConfig;
}

function showHelp(): void {
  console.log(`
Remote HTTP MCP Client

Usage: npx tsx tools/remote-http-client.ts --url <url> --token <token> [options]

Required:
  --url <url>           MCP server HTTP endpoint
  --token <token>       Bearer token for authentication

Options:
  --timeout <ms>        Request timeout in milliseconds (default: 10000)
  --verbose, -v         Enable verbose logging
  --debug               Enable debug logging with full request/response details
  --no-interactive      Disable interactive mode
  --help, -h            Show this help

Examples:
  npx tsx tools/remote-http-client.ts --url http://localhost:3000/mcp --token ya29.abc123
  npx tsx tools/remote-http-client.ts --url https://api.example.com/mcp --token token123 --verbose
  npx tsx tools/remote-http-client.ts --url http://localhost:3000/mcp --token token123 --debug
`);
}

// Main execution
async function main(): Promise<void> {
  try {
    const config = parseArgs();
    const client = new RemoteHTTPMCPClient(config);
    await client.start();
  } catch (error) {
    console.error('❌ Error:', (error as Error).message);

    if ((error as Error).message.includes('--')) {
      console.error('\nUse --help for usage information');
    }

    process.exit(1);
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  process.exit(0);
});

// Run if this file is executed directly
main().catch(console.error);