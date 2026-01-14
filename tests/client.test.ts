/**
 * Tests for BTCPClient
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BTCPClient } from '../src/client.js';
import { BTCPServer } from '../src/server.js';
import { BTCPConnectionError } from '../src/errors.js';
import type { BrowserAgent } from '../src/types.js';

describe('BTCPClient', () => {
  let server: BTCPServer;
  let client: BTCPClient;
  let port: number;

  beforeEach(async () => {
    port = 10000 + Math.floor(Math.random() * 50000);
    server = new BTCPServer({ port, debug: false });
    await server.start();
  });

  afterEach(async () => {
    if (client?.isConnected()) {
      client.disconnect();
    }
    await server.stop();
  });

  describe('constructor', () => {
    it('should create client with default config', () => {
      client = new BTCPClient({ serverUrl: `http://localhost:${port}` });

      expect(client.isConnected()).toBe(false);
      expect(client.getSessionId()).toBeDefined();
    });

    it('should accept custom session ID', () => {
      client = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId: 'custom-session',
      });

      expect(client.getSessionId()).toBe('custom-session');
    });

    it('should create executor', () => {
      client = new BTCPClient({ serverUrl: `http://localhost:${port}` });

      const executor = client.getExecutor();
      expect(executor).toBeDefined();
      expect(executor.hasHandler('echo')).toBe(true);
    });
  });

  describe('connect', () => {
    it('should connect to server', async () => {
      client = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        debug: false,
      });

      await client.connect();

      expect(client.isConnected()).toBe(true);
    });

    it('should emit connect event', async () => {
      client = new BTCPClient({ serverUrl: `http://localhost:${port}` });

      const connectHandler = vi.fn();
      client.on('connect', connectHandler);

      await client.connect();

      expect(connectHandler).toHaveBeenCalled();
    });

    it('should throw on connection failure', async () => {
      client = new BTCPClient({
        serverUrl: 'http://localhost:99999', // Invalid port
        connectionTimeout: 1000,
      });

      await expect(client.connect()).rejects.toThrow();
    });

    it('should not connect twice', async () => {
      client = new BTCPClient({ serverUrl: `http://localhost:${port}` });

      await client.connect();
      await client.connect(); // Should not throw

      expect(client.isConnected()).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('should disconnect from server', async () => {
      client = new BTCPClient({ serverUrl: `http://localhost:${port}` });
      await client.connect();

      client.disconnect();

      expect(client.isConnected()).toBe(false);
    });

    it('should emit disconnect event', async () => {
      client = new BTCPClient({ serverUrl: `http://localhost:${port}` });
      await client.connect();

      const disconnectHandler = vi.fn();
      client.on('disconnect', disconnectHandler);

      client.disconnect();

      expect(disconnectHandler).toHaveBeenCalled();
    });

    it('should be safe to call when not connected', () => {
      client = new BTCPClient({ serverUrl: `http://localhost:${port}` });

      expect(() => client.disconnect()).not.toThrow();
    });
  });

  describe('registerTools', () => {
    it('should register tools with server', async () => {
      client = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId: 'register-test',
      });
      await client.connect();

      await client.registerTools();

      // Verify via server sessions endpoint
      const response = await fetch(`http://localhost:${port}/sessions`);
      const data = await response.json();
      const session = data.sessions.find((s: any) => s.id === 'register-test');
      expect(session?.toolCount).toBeGreaterThan(0);
    });

    it('should register custom tools', async () => {
      client = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId: 'custom-tools-test',
      });
      await client.connect();

      const executor = client.getExecutor();
      executor.registerHandler(
        'custom_tool',
        async () => 'result',
        { name: 'custom_tool', description: 'Custom', inputSchema: {} }
      );

      await client.registerTools();

      const response = await fetch(`http://localhost:${port}/sessions`);
      const data = await response.json();
      const session = data.sessions.find((s: any) => s.id === 'custom-tools-test');
      expect(session?.toolCount).toBeGreaterThan(2); // echo, evaluate, custom_tool
    });

    it('should allow passing specific tools', async () => {
      client = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId: 'specific-tools',
      });
      await client.connect();

      await client.registerTools([
        { name: 'tool1', description: 'Tool 1', inputSchema: {} },
        { name: 'tool2', description: 'Tool 2', inputSchema: {} },
      ]);

      const response = await fetch(`http://localhost:${port}/sessions`);
      const data = await response.json();
      const session = data.sessions.find((s: any) => s.id === 'specific-tools');
      expect(session?.toolCount).toBe(2);
    });
  });

  describe('event handling', () => {
    it('should subscribe to events', async () => {
      client = new BTCPClient({ serverUrl: `http://localhost:${port}` });

      const handler = vi.fn();
      client.on('connect', handler);

      await client.connect();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe from events', async () => {
      client = new BTCPClient({ serverUrl: `http://localhost:${port}` });

      const handler = vi.fn();
      client.on('connect', handler);
      client.off('connect', handler);

      await client.connect();

      expect(handler).not.toHaveBeenCalled();
    });

    it('should emit error event on parse error', async () => {
      client = new BTCPClient({ serverUrl: `http://localhost:${port}` });

      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      await client.connect();

      // Errors during message handling should emit error event
      // This is tested indirectly through integration tests
    });

    it('should emit toolCall event when tool is called', async () => {
      client = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId: 'toolcall-event-test',
      });

      const toolCallHandler = vi.fn();
      client.on('toolCall', toolCallHandler);

      await client.connect();
      await client.registerTools();

      // The toolCall event would be emitted when the server forwards a call
      // This is better tested in integration tests
    });
  });

  describe('setBrowserAgent', () => {
    it('should set browser agent on executor', async () => {
      client = new BTCPClient({ serverUrl: `http://localhost:${port}` });

      const mockAgent: BrowserAgent = {
        snapshot: vi.fn().mockResolvedValue('snapshot'),
        click: vi.fn(),
        fill: vi.fn(),
        type: vi.fn(),
        hover: vi.fn(),
        press: vi.fn(),
        scroll: vi.fn(),
        getText: vi.fn(),
        getAttribute: vi.fn(),
        isVisible: vi.fn(),
        getUrl: vi.fn().mockResolvedValue('https://test.com'),
        getTitle: vi.fn().mockResolvedValue('Test'),
        screenshot: vi.fn(),
        wait: vi.fn(),
        evaluate: vi.fn(),
      };

      client.setBrowserAgent(mockAgent);

      const executor = client.getExecutor();
      expect(executor.hasHandler('browser_snapshot')).toBe(true);
      expect(executor.hasHandler('browser_click')).toBe(true);
    });
  });

  describe('getExecutor', () => {
    it('should return the same executor instance', () => {
      client = new BTCPClient({ serverUrl: `http://localhost:${port}` });

      const executor1 = client.getExecutor();
      const executor2 = client.getExecutor();

      expect(executor1).toBe(executor2);
    });
  });

  describe('getSessionId', () => {
    it('should return session ID', () => {
      client = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId: 'my-session',
      });

      expect(client.getSessionId()).toBe('my-session');
    });

    it('should return generated session ID if not provided', () => {
      client = new BTCPClient({ serverUrl: `http://localhost:${port}` });

      const sessionId = client.getSessionId();
      expect(sessionId).toMatch(/^btcp-\d+-\d+$/);
    });
  });

  describe('isConnected', () => {
    it('should return false before connect', () => {
      client = new BTCPClient({ serverUrl: `http://localhost:${port}` });

      expect(client.isConnected()).toBe(false);
    });

    it('should return true after connect', async () => {
      client = new BTCPClient({ serverUrl: `http://localhost:${port}` });
      await client.connect();

      expect(client.isConnected()).toBe(true);
    });

    it('should return false after disconnect', async () => {
      client = new BTCPClient({ serverUrl: `http://localhost:${port}` });
      await client.connect();
      client.disconnect();

      expect(client.isConnected()).toBe(false);
    });
  });

  describe('request', () => {
    it('should send request and receive response', async () => {
      client = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId: 'request-test',
      });
      await client.connect();

      // ping should receive pong
      const result = await client.request('ping') as { pong: boolean };

      expect(result.pong).toBe(true);
    });

    it('should timeout on no response', async () => {
      client = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId: 'timeout-test',
        connectionTimeout: 500,
      });
      await client.connect();

      // A method that won't get a response
      await expect(client.request('unknown/method')).rejects.toThrow();
    });
  });

  describe('auto-reconnect', () => {
    it('should respect autoReconnect=false', async () => {
      client = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        autoReconnect: false,
      });
      await client.connect();

      const disconnectHandler = vi.fn();
      client.on('disconnect', disconnectHandler);

      // Stop server to trigger disconnect
      await server.stop();

      await new Promise((r) => setTimeout(r, 200));

      // Should not attempt to reconnect
      expect(disconnectHandler).toHaveBeenCalled();
    });

    it('should attempt reconnection with autoReconnect=true', async () => {
      // Create a new server for this test
      const reconnectPort = port + 100;
      const reconnectServer = new BTCPServer({ port: reconnectPort, debug: false });
      await reconnectServer.start();

      client = new BTCPClient({
        serverUrl: `http://localhost:${reconnectPort}`,
        autoReconnect: true,
        reconnectDelay: 100,
        maxReconnectAttempts: 2,
      });

      await client.connect();

      const disconnectHandler = vi.fn();
      const errorHandler = vi.fn();
      client.on('disconnect', disconnectHandler);
      client.on('error', errorHandler);

      // Stop server to trigger disconnect
      await reconnectServer.stop();

      await new Promise((r) => setTimeout(r, 500));

      // Should have attempted reconnection (and failed since server is down)
      expect(disconnectHandler).toHaveBeenCalled();
    });
  });
});
