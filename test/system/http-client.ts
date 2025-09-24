/**
 * HTTP Test Client for MCP System Testing
 *
 * Provides a test client that manages an HTTP server for MCP system tests.
 * Similar to STDIOTestClient but for HTTP transport testing.
 */

import { spawn, ChildProcess } from 'child_process';

export interface HTTPClientOptions {
  port?: number;
  timeout?: number;
  startupDelay?: number;
}

export class HTTPTestClient {
  private server: ChildProcess | null = null;
  private readonly options: Required<HTTPClientOptions>;
  private isStarted = false;

  constructor(options: HTTPClientOptions = {}) {
    // Use the same port logic as test environment configuration
    const defaultPort = parseInt(process.env.HTTP_TEST_PORT || '3001', 10);

    this.options = {
      port: options.port || defaultPort,
      timeout: options.timeout || 10000,
      startupDelay: options.startupDelay || 2000
    };
  }

  /**
   * Start the HTTP MCP server process
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      throw new Error('HTTP server already started');
    }

    console.log(`🚀 Starting HTTP MCP server on port ${this.options.port}...`);

    // Kill any existing processes on the target port
    await this.killProcessOnPort(this.options.port);

    return new Promise((resolve, reject) => {
      // Start the server process
      this.server = spawn('npx', ['tsx', 'src/index.ts'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          MCP_MODE: 'streamable_http',
          MCP_DEV_SKIP_AUTH: 'true',
          HTTP_PORT: this.options.port.toString(),
          HTTP_HOST: 'localhost'
        }
      });

      if (!this.server) {
        reject(new Error('Failed to start HTTP server process'));
        return;
      }

      let startupOutput = '';
      let errorOutput = '';

      // Capture server output
      this.server.stdout?.on('data', (data) => {
        const text = data.toString();
        startupOutput += text;

        // Look for server ready indicators
        if (text.includes('listening on') || text.includes('server running')) {
          // Add a small delay to ensure server is fully ready
          const readyTimer = setTimeout(() => {
            console.log(`✅ HTTP MCP server started on port ${this.options.port}`);
            this.isStarted = true;
            resolve();
          }, this.options.startupDelay);
          readyTimer.unref(); // Don't keep process alive
        }
      });

      this.server.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      this.server.on('error', (error) => {
        console.error('❌ HTTP server process error:', error);
        reject(new Error(`HTTP server process error: ${error.message}`));
      });

      this.server.on('exit', (code, signal) => {
        if (!this.isStarted) {
          console.error('❌ HTTP server exited before becoming ready');
          console.error('Server output:', startupOutput);
          console.error('Server errors:', errorOutput);
          reject(new Error(`HTTP server exited with code ${code}, signal ${signal}`));
        }
      });

      // Timeout if server doesn't start within the timeout period
      const timeoutTimer = setTimeout(() => {
        console.error('❌ HTTP server startup timeout');
        console.error('Server output:', startupOutput);
        console.error('Server errors:', errorOutput);
        this.forceStop();
        reject(new Error(`HTTP server startup timeout after ${this.options.timeout}ms`));
      }, this.options.timeout);
      timeoutTimer.unref(); // Don't keep process alive
    });
  }

  /**
   * Stop the HTTP server process
   */
  async stop(): Promise<void> {
    if (!this.isStarted || !this.server) {
      return;
    }

    console.log('🛑 Stopping HTTP MCP server...');

    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      // Set up exit handler
      const exitHandler = () => {
        console.log('✅ HTTP MCP server stopped');
        this.server = null;
        this.isStarted = false;
        resolve();
      };

      this.server.on('exit', exitHandler);

      // Try graceful shutdown first
      this.server.kill('SIGTERM');

      // Force kill after timeout
      const forceKillTimer = setTimeout(() => {
        if (this.server && !this.server.killed) {
          console.log('⚠️  Force killing HTTP server...');
          this.server.kill('SIGKILL');
          exitHandler();
        }
      }, 5000);
      forceKillTimer.unref(); // Don't keep process alive
    });
  }

  /**
   * Force stop the server (used in error cases)
   */
  private forceStop(): void {
    if (this.server && !this.server.killed) {
      this.server.kill('SIGKILL');
      this.server = null;
      this.isStarted = false;
    }
  }

  /**
   * Kill any existing processes on the specified port
   */
  private async killProcessOnPort(port: number): Promise<void> {
    return new Promise((resolve) => {
      const lsof = spawn('lsof', ['-ti', `:${port}`], { stdio: 'pipe' });
      let output = '';

      lsof.stdout?.on('data', (data) => {
        output += data.toString();
      });

      lsof.on('close', (code) => {
        if (code === 0 && output.trim()) {
          const pids = output.trim().split('\n').filter(pid => pid);
          if (pids.length > 0) {
            console.log(`🛑 Killing existing processes on port ${port}: ${pids.join(', ')}`);

            // Kill all processes
            pids.forEach(pid => {
              try {
                process.kill(parseInt(pid), 'SIGTERM');
              } catch {
                // Process might already be dead, ignore
              }
            });

            // Wait longer for graceful shutdown in test environment
            setTimeout(() => {
              // Force kill if still running
              pids.forEach(pid => {
                try {
                  process.kill(parseInt(pid), 'SIGKILL');
                } catch {
                  // Process might already be dead, ignore
                }
              });
              // Additional wait to ensure port is freed
              setTimeout(resolve, 500);
            }, 2000);
          } else {
            resolve();
          }
        } else {
          // No processes found on port
          resolve();
        }
      });

      lsof.on('error', () => {
        // lsof not available or failed, continue anyway
        resolve();
      });
    });
  }

  /**
   * Get the port the server is running on
   */
  getPort(): number {
    return this.options.port;
  }

  /**
   * Get the base URL for the server
   */
  getBaseUrl(): string {
    return `http://localhost:${this.options.port}`;
  }

  /**
   * Check if the server is started
   */
  isReady(): boolean {
    return this.isStarted && this.server !== null && !this.server.killed;
  }
}