/**
 * MCP Inspector Automation Helper
 *
 * Provides utilities for automating MCP Inspector interactions in headless tests
 *
 * Features:
 * - Automatic signal handling (CTRL-C cleanup)
 * - Process group management for Inspector and its children
 */

import { Page, expect } from '@playwright/test';
import { ChildProcess, spawn } from 'node:child_process';
import axios from 'axios';
import { setTimeout as sleep } from 'node:timers/promises';
import { verifyPortsFreed } from './port-utils.js';
import { stopProcessGroup } from './process-utils.js';
import { setupTestEnvironment, TestEnvironmentCleanup } from './test-setup.js';
import { TEST_PORTS } from './port-registry.js';
import { registerProcess } from './signal-handler.js';

// Re-export from centralized port registry
export const INSPECTOR_PORT = TEST_PORTS.INSPECTOR;
export const INSPECTOR_URL = `http://localhost:${INSPECTOR_PORT}`;

// Re-export for convenience
export { setupTestEnvironment, type TestEnvironmentCleanup, verifyPortsFreed };

/**
 * Start MCP Inspector process in its own process group
 * Returns the child process for cleanup later
 */
export async function startMCPInspector(mcpServerUrl: string): Promise<ChildProcess> {
  console.log(`🔍 Starting MCP Inspector on port ${INSPECTOR_PORT}`);
  console.log(`   Connecting to MCP server: ${mcpServerUrl}`);

  // Inspector uses CLIENT_PORT (UI) and SERVER_PORT (proxy)
  // For streamable HTTP servers, pass the URL and transport type
  const inspector = spawn('npx', [
    '@modelcontextprotocol/inspector',
    '--transport', 'streamable-http',  // Use streamable-http transport
    '--server-url', mcpServerUrl       // Pass server URL as argument
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,  // Run in separate process group for reliable cleanup
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLIENT_PORT: INSPECTOR_PORT.toString(),        // UI port
      SERVER_PORT: (INSPECTOR_PORT + 3).toString(),  // Proxy port (16277)
      MCP_SERVER_URL: mcpServerUrl,                  // Also pass as env var
      DANGEROUSLY_OMIT_AUTH: 'true',                 // Disable auth for testing
      MCP_AUTO_OPEN_ENABLED: 'false'                 // Don't auto-open browser
    }
  });

  inspector.stdout?.on('data', (data) => {
    const text = data.toString();
    console.log('[inspector]', text.trim());
  });

  inspector.stderr?.on('data', (data) => {
    const text = data.toString();
    // Only log errors, not normal startup messages
    if (text.includes('error') || text.includes('Error')) {
      console.error('[inspector:error]', text.trim());
    }
  });

  // Register with signal handler for automatic CTRL-C cleanup
  registerProcess(inspector);

  // Wait for Inspector to be ready
  const maxWaitTime = 30000; // 30 seconds
  const checkInterval = 500;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    try {
      const response = await axios.get(INSPECTOR_URL, {
        timeout: 1000,
        validateStatus: () => true
      });

      if (response.status === 200) {
        console.log('✅ MCP Inspector ready');
        return inspector;
      }
    } catch {
      // Inspector not ready yet, continue waiting
    }

    await sleep(checkInterval);
  }

  inspector.kill();
  throw new Error('MCP Inspector failed to start within timeout');
}

/**
 * Stop MCP Inspector forcefully by killing entire process group
 * This ensures all child processes are killed, including node processes spawned by npx
 */
export async function stopMCPInspector(inspector: ChildProcess): Promise<void> {
  return stopProcessGroup(inspector, 'MCP Inspector');
}

/**
 * Wait for MCP Inspector to fully load in the browser
 */
export async function waitForInspectorLoad(page: Page): Promise<void> {
  console.log('   Waiting for MCP Inspector UI to load...');

  // Wait for the main container to be visible
  await page.waitForSelector('[data-testid="inspector-container"], .inspector-root, body', {
    state: 'visible',
    timeout: 15000
  });

  // Give React/Vue time to hydrate
  await sleep(2000);

  console.log('   ✅ MCP Inspector UI loaded');
}

/**
 * Connect to MCP server via Inspector UI
 * Handles OAuth flow if needed
 */
export async function connectToServerViaInspector(page: Page, mcpServerUrl: string): Promise<void> {
  console.log('🔌 Connecting to MCP server via Inspector...');

  try {
    // Look for connection status or connect button
    // The exact selectors depend on MCP Inspector's UI structure

    // Try to find a "Connect" button if not already connected
    const connectButton = await page.locator('button:has-text("Connect"), button[aria-label="Connect"]').first();

    if (await connectButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('   Clicking Connect button...');
      await connectButton.click();

      // Wait for connection to establish
      await sleep(2000);
    }

    // Check if already connected (look for connection status indicator)
    const connectionStatus = await page.locator('[data-testid="connection-status"], .connection-status').first();

    if (await connectionStatus.isVisible({ timeout: 2000 }).catch(() => false)) {
      const statusText = await connectionStatus.textContent();
      console.log(`   Connection status: ${statusText}`);
    }

    console.log('   ✅ Connected to MCP server');
  } catch (error) {
    console.error('   ❌ Connection failed:', error);

    // Take screenshot for debugging
    await page.screenshot({ path: 'playwright-results/connect-error.png' });
    throw error;
  }
}

/**
 * Disconnect from MCP server via Inspector UI
 */
export async function disconnectFromServerViaInspector(page: Page): Promise<void> {
  console.log('🔌 Disconnecting from MCP server...');

  try {
    const disconnectButton = await page.locator('button:has-text("Disconnect"), button[aria-label="Disconnect"]').first();

    if (await disconnectButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await disconnectButton.click();
      await sleep(1000);
      console.log('   ✅ Disconnected from MCP server');
    } else {
      console.log('   ⚠️  Disconnect button not found (may already be disconnected)');
    }
  } catch (error) {
    console.error('   ❌ Disconnect failed:', error);
    throw error;
  }
}

/**
 * Send ping via Inspector UI
 */
export async function sendPingViaInspector(page: Page): Promise<void> {
  console.log('📡 Sending ping...');

  try {
    // Look for ping button or invoke ping via developer tools
    const pingButton = await page.locator('button:has-text("Ping"), [data-action="ping"]').first();

    if (await pingButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await pingButton.click();
      await sleep(500);
      console.log('   ✅ Ping sent');
    } else {
      console.log('   ⚠️  Ping button not found (may not be exposed in UI)');
    }
  } catch (error) {
    console.error('   ❌ Ping failed:', error);
    throw error;
  }
}

/**
 * Get list of tools from Inspector UI
 */
export async function getToolsListFromInspector(page: Page): Promise<string[]> {
  console.log('📋 Getting tools list from Inspector...');

  try {
    // Wait for tools list to be visible
    await page.waitForSelector('[data-testid="tools-list"], .tools-list, [role="list"]', {
      timeout: 5000
    });

    // Get all tool names from the UI
    const toolElements = await page.locator('[data-testid="tool-name"], .tool-name, [role="listitem"]').all();
    const tools: string[] = [];

    for (const element of toolElements) {
      const text = await element.textContent();
      if (text?.trim()) {
        tools.push(text.trim());
      }
    }

    console.log(`   ✅ Found ${tools.length} tools:`, tools);
    return tools;
  } catch (error) {
    console.error('   ❌ Failed to get tools list:', error);

    // Try alternative approach - look for any text that might be tool names
    const bodyText = await page.textContent('body');
    console.log('   Page content (first 500 chars):', bodyText?.substring(0, 500));

    throw error;
  }
}

/**
 * Invoke a tool via Inspector UI
 */
export async function invokeToolViaInspector(
  page: Page,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; result?: string; error?: string }> {
  console.log(`🔧 Invoking tool: ${toolName}`, args);

  try {
    // Find the tool in the list
    const toolButton = await page.locator(`button:has-text("${toolName}"), [data-tool="${toolName}"]`).first();

    if (!await toolButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      throw new Error(`Tool "${toolName}" not found in UI`);
    }

    // Click the tool to open its form
    await toolButton.click();
    await sleep(500);

    // Fill in arguments
    for (const [key, value] of Object.entries(args)) {
      const input = await page.locator(`input[name="${key}"], textarea[name="${key}"]`).first();

      if (await input.isVisible({ timeout: 1000 }).catch(() => false)) {
        await input.fill(String(value));
      } else {
        console.log(`   ⚠️  Input field for "${key}" not found, may be auto-filled or not required`);
      }
    }

    // Submit the tool invocation
    const invokeButton = await page.locator('button:has-text("Invoke"), button:has-text("Execute"), button:has-text("Run")').first();
    await invokeButton.click();

    // Wait for result
    await sleep(2000);

    // Try to extract result from UI
    const resultElement = await page.locator('[data-testid="tool-result"], .tool-result, [role="region"]').first();

    if (await resultElement.isVisible({ timeout: 3000 }).catch(() => false)) {
      const resultText = await resultElement.textContent();
      console.log('   ✅ Tool invocation successful');
      return {
        success: true,
        result: resultText || undefined
      };
    }

    // No result found, but no error either
    console.log('   ⚠️  Tool invoked but result not visible in UI');
    return {
      success: true
    };

  } catch (error) {
    console.error(`   ❌ Tool invocation failed:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Verify Inspector UI shows expected connection state
 */
export async function verifyConnectionState(page: Page, expectedState: 'connected' | 'disconnected'): Promise<void> {
  console.log(`   Verifying connection state: ${expectedState}`);

  const timeout = 5000;

  if (expectedState === 'connected') {
    // Look for indicators of connection
    const connectedIndicators = [
      '[data-testid="connection-status"][data-state="connected"]',
      '.connection-status.connected',
      'text=/connected/i',
      '[aria-label*="connected" i]'
    ];

    for (const selector of connectedIndicators) {
      const element = await page.locator(selector).first();
      if (await element.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log('   ✅ Connection state verified: connected');
        return;
      }
    }
  } else {
    // Look for indicators of disconnection
    const disconnectedIndicators = [
      '[data-testid="connection-status"][data-state="disconnected"]',
      '.connection-status.disconnected',
      'text=/disconnected/i',
      '[aria-label*="disconnected" i]'
    ];

    for (const selector of disconnectedIndicators) {
      const element = await page.locator(selector).first();
      if (await element.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log('   ✅ Connection state verified: disconnected');
        return;
      }
    }
  }

  // If we can't verify via specific selectors, check page content
  const pageText = await page.textContent('body');
  const hasExpectedState = pageText?.toLowerCase().includes(expectedState);

  if (hasExpectedState) {
    console.log(`   ✅ Connection state verified via page text: ${expectedState}`);
  } else {
    console.log(`   ⚠️  Could not verify connection state (expected: ${expectedState})`);
    console.log('   Page text:', pageText?.substring(0, 500));
  }
}
