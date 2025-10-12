/**
 * Centralized Signal Handling for Test Infrastructure
 *
 * Manages SIGINT/SIGTERM signals to ensure graceful cleanup of child processes.
 * Prevents port leaks when tests are interrupted (CTRL-C).
 *
 * Design principles:
 * 1. Single signal handler registry
 * 2. Automatic child process tracking
 * 3. Graceful SIGTERM → SIGKILL cascade
 * 4. Process group management
 * 5. Cleanup callback support
 */

import { ChildProcess } from 'child_process';

/**
 * Cleanup callback function type
 * Called before process exit to perform custom cleanup
 */
export type CleanupCallback = () => Promise<void> | void;

/**
 * Signal handler manager
 * Singleton that tracks all child processes and cleanup callbacks
 */
class SignalHandlerManager {
  private childProcesses = new Set<ChildProcess>();
  private cleanupCallbacks = new Set<CleanupCallback>();
  private isShuttingDown = false;
  private handlersInstalled = false;

  /**
   * Register a child process for automatic cleanup
   * When SIGINT/SIGTERM is received, this process will be killed
   *
   * @param process - Child process to track
   * @returns Cleanup function to unregister the process
   */
  registerProcess(process: ChildProcess): () => void {
    this.childProcesses.add(process);

    // Auto-install signal handlers on first registration
    if (!this.handlersInstalled) {
      this.installSignalHandlers();
    }

    // Return unregister function
    return () => {
      this.childProcesses.delete(process);
    };
  }

  /**
   * Register a cleanup callback
   * Called before process exit to perform custom cleanup
   *
   * @param callback - Async or sync cleanup function
   * @returns Cleanup function to unregister the callback
   */
  registerCleanup(callback: CleanupCallback): () => void {
    this.cleanupCallbacks.add(callback);

    // Auto-install signal handlers on first registration
    if (!this.handlersInstalled) {
      this.installSignalHandlers();
    }

    // Return unregister function
    return () => {
      this.cleanupCallbacks.delete(callback);
    };
  }

  /**
   * Install signal handlers for SIGINT and SIGTERM
   * Only installs once, subsequent calls are no-ops
   */
  private installSignalHandlers(): void {
    if (this.handlersInstalled) {
      return;
    }

    // Increase max listeners to prevent warnings in test suites
    // Tests may register many child processes simultaneously
    process.setMaxListeners(100);

    // SIGINT (CTRL-C)
    process.on('SIGINT', async () => {
      if (!this.isShuttingDown) {
        console.log('\n⚠️  SIGINT received (CTRL-C), cleaning up...');
        await this.shutdown('SIGINT');
      }
    });

    // SIGTERM (kill command)
    process.on('SIGTERM', async () => {
      if (!this.isShuttingDown) {
        console.log('\n⚠️  SIGTERM received, cleaning up...');
        await this.shutdown('SIGTERM');
      }
    });

    // Process exit (last resort)
    process.on('exit', () => {
      // Synchronous cleanup only
      if (!this.isShuttingDown) {
        this.isShuttingDown = true;
        console.log('⚠️  Process exiting, force killing child processes...');
        for (const child of this.childProcesses) {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }
      }
    });

    this.handlersInstalled = true;
  }

  /**
   * Graceful shutdown sequence
   * 1. Run cleanup callbacks
   * 2. Send SIGTERM to all child processes
   * 3. Wait for graceful shutdown
   * 4. Force SIGKILL after timeout
   * 5. Exit process
   */
  private async shutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;

    try {
      // Step 1: Run cleanup callbacks
      if (this.cleanupCallbacks.size > 0) {
        console.log(`🧹 Running ${this.cleanupCallbacks.size} cleanup callback(s)...`);
        const cleanupPromises = Array.from(this.cleanupCallbacks).map(async (callback) => {
          try {
            await callback();
          } catch (error) {
            console.error('⚠️  Cleanup callback failed:', error);
          }
        });
        await Promise.all(cleanupPromises);
      }

      // Step 2: Kill child processes
      if (this.childProcesses.size > 0) {
        console.log(`🛑 Terminating ${this.childProcesses.size} child process(es)...`);

        // Send SIGTERM to all children
        for (const child of this.childProcesses) {
          if (!child.killed) {
            try {
              child.kill('SIGTERM');
            } catch (error) {
              console.error(`⚠️  Failed to send SIGTERM to PID ${child.pid}:`, error);
            }
          }
        }

        // Wait for graceful shutdown (max 2 seconds)
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Force kill any remaining processes
        for (const child of this.childProcesses) {
          if (!child.killed) {
            try {
              console.log(`⚠️  Force killing PID ${child.pid}...`);
              child.kill('SIGKILL');
            } catch (error) {
              console.error(`⚠️  Failed to kill PID ${child.pid}:`, error);
            }
          }
        }
      }

      console.log('✅ Cleanup complete, exiting...');
    } catch (error) {
      console.error('❌ Cleanup failed:', error);
    } finally {
      // Exit with appropriate code
      process.exit(signal === 'SIGINT' ? 130 : 143);
    }
  }

  /**
   * Reset the signal handler (for testing)
   * WARNING: Only use in tests!
   */
  reset(): void {
    this.childProcesses.clear();
    this.cleanupCallbacks.clear();
    this.isShuttingDown = false;
    // Note: Cannot uninstall Node.js signal handlers, so handlersInstalled stays true
  }

  /**
   * Get current state (for debugging/monitoring)
   */
  getState(): {
    processCount: number;
    callbackCount: number;
    isShuttingDown: boolean;
    handlersInstalled: boolean;
  } {
    return {
      processCount: this.childProcesses.size,
      callbackCount: this.cleanupCallbacks.size,
      isShuttingDown: this.isShuttingDown,
      handlersInstalled: this.handlersInstalled,
    };
  }
}

// Singleton instance
const signalHandler = new SignalHandlerManager();

/**
 * Register a child process for automatic cleanup on SIGINT/SIGTERM
 *
 * @param process - Child process to track
 * @returns Cleanup function to unregister
 *
 * @example
 * ```typescript
 * const server = spawn('node', ['server.js']);
 * const unregister = registerProcess(server);
 *
 * // Later, when you manually stop the server:
 * server.kill();
 * unregister();
 * ```
 */
export function registerProcess(process: ChildProcess): () => void {
  return signalHandler.registerProcess(process);
}

/**
 * Register a cleanup callback to run before process exit
 *
 * @param callback - Async or sync cleanup function
 * @returns Cleanup function to unregister
 *
 * @example
 * ```typescript
 * const unregister = registerCleanup(async () => {
 *   await database.close();
 *   await cache.flush();
 * });
 *
 * // Later, if cleanup is no longer needed:
 * unregister();
 * ```
 */
export function registerCleanup(callback: CleanupCallback): () => void {
  return signalHandler.registerCleanup(callback);
}

/**
 * Get current signal handler state (for debugging)
 */
export function getSignalHandlerState() {
  return signalHandler.getState();
}

/**
 * Reset signal handler state (for testing only!)
 * WARNING: Only use in tests!
 */
export function resetSignalHandler() {
  signalHandler.reset();
}
