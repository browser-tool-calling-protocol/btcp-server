/**
 * Tests for ToolExecutor
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolExecutor } from '../src/executor.js';
import { BTCPToolNotFoundError, BTCPExecutionError } from '../src/errors.js';
import type { BrowserAgent, BTCPToolDefinition } from '../src/types.js';

describe('ToolExecutor', () => {
  let executor: ToolExecutor;

  beforeEach(() => {
    executor = new ToolExecutor();
  });

  describe('constructor', () => {
    it('should register default handlers', () => {
      expect(executor.hasHandler('echo')).toBe(true);
      expect(executor.hasHandler('evaluate')).toBe(true);
    });

    it('should accept custom handlers in config', () => {
      const customExecutor = new ToolExecutor({
        handlers: {
          custom_tool: async () => 'result',
        },
      });

      expect(customExecutor.hasHandler('custom_tool')).toBe(true);
    });

    it('should enable debug mode', () => {
      const debugExecutor = new ToolExecutor({ debug: true });
      expect(debugExecutor).toBeDefined();
    });
  });

  describe('registerHandler', () => {
    it('should register a new handler', () => {
      executor.registerHandler('my_tool', async () => 'result');

      expect(executor.hasHandler('my_tool')).toBe(true);
    });

    it('should register handler with definition', () => {
      const definition: BTCPToolDefinition = {
        name: 'my_tool',
        description: 'My custom tool',
        inputSchema: { type: 'object', properties: {} },
      };

      executor.registerHandler('my_tool', async () => 'result', definition);

      const defs = executor.getToolDefinitions();
      const found = defs.find((d) => d.name === 'my_tool');
      expect(found).toBeDefined();
      expect(found?.description).toBe('My custom tool');
    });

    it('should overwrite existing handler', () => {
      executor.registerHandler('my_tool', async () => 'first');
      executor.registerHandler('my_tool', async () => 'second');

      expect(executor.hasHandler('my_tool')).toBe(true);
    });
  });

  describe('unregisterHandler', () => {
    it('should remove a handler', () => {
      executor.registerHandler('temp_tool', async () => 'result');
      expect(executor.hasHandler('temp_tool')).toBe(true);

      const result = executor.unregisterHandler('temp_tool');

      expect(result).toBe(true);
      expect(executor.hasHandler('temp_tool')).toBe(false);
    });

    it('should return false for non-existent handler', () => {
      const result = executor.unregisterHandler('non_existent');

      expect(result).toBe(false);
    });

    it('should remove tool definition as well', () => {
      executor.registerHandler(
        'my_tool',
        async () => 'result',
        { name: 'my_tool', description: 'Test', inputSchema: {} }
      );
      executor.unregisterHandler('my_tool');

      const def = executor.getToolDefinition('my_tool');
      expect(def).toBeUndefined();
    });
  });

  describe('hasHandler', () => {
    it('should return true for existing handler', () => {
      expect(executor.hasHandler('echo')).toBe(true);
    });

    it('should return false for non-existent handler', () => {
      expect(executor.hasHandler('non_existent')).toBe(false);
    });
  });

  describe('execute', () => {
    it('should execute a tool and return content', async () => {
      const result = await executor.execute('echo', { message: 'Hello!' });

      expect(result).toHaveLength(1);
      expect(result[0]?.type).toBe('text');
      expect((result[0] as any).text).toBe('Hello!');
    });

    it('should use default message for echo', async () => {
      const result = await executor.execute('echo', {});

      expect((result[0] as any).text).toBe('Hello from BTCP!');
    });

    it('should throw BTCPToolNotFoundError for unknown tool', async () => {
      await expect(executor.execute('unknown_tool', {})).rejects.toThrow(
        BTCPToolNotFoundError
      );
    });

    it('should throw BTCPExecutionError on handler failure', async () => {
      executor.registerHandler('failing_tool', async () => {
        throw new Error('Tool failed!');
      });

      await expect(executor.execute('failing_tool', {})).rejects.toThrow(
        BTCPExecutionError
      );
    });

    it('should pass arguments to handler', async () => {
      const handler = vi.fn().mockResolvedValue('result');
      executor.registerHandler('test_tool', handler);

      await executor.execute('test_tool', { key: 'value' });

      expect(handler).toHaveBeenCalledWith({ key: 'value' });
    });
  });

  describe('result normalization', () => {
    it('should normalize string result to text content', async () => {
      executor.registerHandler('string_tool', async () => 'plain string');

      const result = await executor.execute('string_tool', {});

      expect(result[0]).toEqual({ type: 'text', text: 'plain string' });
    });

    it('should normalize object result to JSON text', async () => {
      executor.registerHandler('object_tool', async () => ({ foo: 'bar' }));

      const result = await executor.execute('object_tool', {});

      expect(result[0]?.type).toBe('text');
      expect(JSON.parse((result[0] as any).text)).toEqual({ foo: 'bar' });
    });

    it('should normalize array result to JSON text', async () => {
      executor.registerHandler('array_tool', async () => [1, 2, 3]);

      const result = await executor.execute('array_tool', {});

      expect(JSON.parse((result[0] as any).text)).toEqual([1, 2, 3]);
    });

    it('should preserve BTCPContent array', async () => {
      executor.registerHandler('content_tool', async () => [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: 'World' },
      ]);

      const result = await executor.execute('content_tool', {});

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ type: 'text', text: 'Hello' });
      expect(result[1]).toEqual({ type: 'text', text: 'World' });
    });

    it('should preserve single BTCPContent', async () => {
      executor.registerHandler('content_tool', async () => ({
        type: 'text',
        text: 'Single content',
      }));

      const result = await executor.execute('content_tool', {});

      expect(result[0]).toEqual({ type: 'text', text: 'Single content' });
    });

    it('should normalize number to string', async () => {
      executor.registerHandler('number_tool', async () => 42);

      const result = await executor.execute('number_tool', {});

      expect(result[0]).toEqual({ type: 'text', text: '42' });
    });

    it('should normalize boolean to string', async () => {
      executor.registerHandler('bool_tool', async () => true);

      const result = await executor.execute('bool_tool', {});

      expect(result[0]).toEqual({ type: 'text', text: 'true' });
    });

    it('should detect base64 image data', async () => {
      const base64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
      executor.registerHandler('image_tool', async () => base64);

      const result = await executor.execute('image_tool', {});

      expect(result[0]?.type).toBe('image');
      expect((result[0] as any).mimeType).toBe('image/png');
    });
  });

  describe('getToolDefinitions', () => {
    it('should return all tool definitions', () => {
      const definitions = executor.getToolDefinitions();

      expect(definitions.length).toBeGreaterThan(0);
      expect(definitions.find((d) => d.name === 'echo')).toBeDefined();
      expect(definitions.find((d) => d.name === 'evaluate')).toBeDefined();
    });

    it('should include custom tool definitions', () => {
      executor.registerHandler(
        'custom',
        async () => 'result',
        { name: 'custom', description: 'Custom tool', inputSchema: {} }
      );

      const definitions = executor.getToolDefinitions();
      const custom = definitions.find((d) => d.name === 'custom');

      expect(custom).toBeDefined();
      expect(custom?.description).toBe('Custom tool');
    });
  });

  describe('getToolDefinition', () => {
    it('should return definition for existing tool', () => {
      const def = executor.getToolDefinition('echo');

      expect(def).toBeDefined();
      expect(def?.name).toBe('echo');
    });

    it('should return undefined for non-existent tool', () => {
      const def = executor.getToolDefinition('non_existent');

      expect(def).toBeUndefined();
    });
  });

  describe('Browser Agent Integration', () => {
    let mockAgent: BrowserAgent;

    beforeEach(() => {
      mockAgent = {
        snapshot: vi.fn().mockResolvedValue('<html>snapshot</html>'),
        click: vi.fn().mockResolvedValue(undefined),
        fill: vi.fn().mockResolvedValue(undefined),
        type: vi.fn().mockResolvedValue(undefined),
        hover: vi.fn().mockResolvedValue(undefined),
        press: vi.fn().mockResolvedValue(undefined),
        scroll: vi.fn().mockResolvedValue(undefined),
        getText: vi.fn().mockResolvedValue('Element text'),
        getAttribute: vi.fn().mockResolvedValue('attr-value'),
        isVisible: vi.fn().mockResolvedValue(true),
        getUrl: vi.fn().mockResolvedValue('https://example.com'),
        getTitle: vi.fn().mockResolvedValue('Example Page'),
        screenshot: vi.fn().mockResolvedValue('base64screenshot'),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue({ result: 'evaluated' }),
      };
    });

    it('should register browser tools when agent is provided', () => {
      const agentExecutor = new ToolExecutor({ browserAgent: mockAgent });

      expect(agentExecutor.hasHandler('browser_snapshot')).toBe(true);
      expect(agentExecutor.hasHandler('browser_click')).toBe(true);
      expect(agentExecutor.hasHandler('browser_fill')).toBe(true);
      expect(agentExecutor.hasHandler('browser_scroll')).toBe(true);
    });

    it('should register browser tools via setBrowserAgent', () => {
      executor.setBrowserAgent(mockAgent);

      expect(executor.hasHandler('browser_snapshot')).toBe(true);
      expect(executor.hasHandler('browser_click')).toBe(true);
    });

    it('should execute browser_snapshot', async () => {
      executor.setBrowserAgent(mockAgent);

      const result = await executor.execute('browser_snapshot', {});

      expect(mockAgent.snapshot).toHaveBeenCalled();
      expect((result[0] as any).text).toBe('<html>snapshot</html>');
    });

    it('should execute browser_click', async () => {
      executor.setBrowserAgent(mockAgent);

      await executor.execute('browser_click', { selector: '#button' });

      expect(mockAgent.click).toHaveBeenCalledWith('#button');
    });

    it('should execute browser_fill', async () => {
      executor.setBrowserAgent(mockAgent);

      await executor.execute('browser_fill', { selector: '#input', value: 'test' });

      expect(mockAgent.fill).toHaveBeenCalledWith('#input', 'test');
    });

    it('should execute browser_scroll', async () => {
      executor.setBrowserAgent(mockAgent);

      await executor.execute('browser_scroll', { direction: 'down', amount: 100 });

      expect(mockAgent.scroll).toHaveBeenCalledWith('down', 100);
    });

    it('should execute browser_get_text', async () => {
      executor.setBrowserAgent(mockAgent);

      const result = await executor.execute('browser_get_text', { selector: '#elem' });

      expect(mockAgent.getText).toHaveBeenCalledWith('#elem');
      expect((result[0] as any).text).toBe('Element text');
    });

    it('should execute browser_get_url', async () => {
      executor.setBrowserAgent(mockAgent);

      const result = await executor.execute('browser_get_url', {});

      expect(mockAgent.getUrl).toHaveBeenCalled();
      expect((result[0] as any).text).toBe('https://example.com');
    });

    it('should execute browser_screenshot', async () => {
      executor.setBrowserAgent(mockAgent);

      const result = await executor.execute('browser_screenshot', {});

      expect(mockAgent.screenshot).toHaveBeenCalled();
      expect(result[0]?.type).toBe('image');
    });

    it('should execute browser_wait', async () => {
      executor.setBrowserAgent(mockAgent);

      await executor.execute('browser_wait', { timeout: 500 });

      expect(mockAgent.wait).toHaveBeenCalledWith(500);
    });

    it('should execute browser_execute', async () => {
      executor.setBrowserAgent(mockAgent);

      const result = await executor.execute('browser_execute', { script: 'return 1+1' });

      expect(mockAgent.evaluate).toHaveBeenCalledWith('return 1+1');
    });

    it('browser tools should have proper definitions', () => {
      executor.setBrowserAgent(mockAgent);

      const snapshotDef = executor.getToolDefinition('browser_snapshot');
      expect(snapshotDef?.capabilities).toContain('dom:read');

      const clickDef = executor.getToolDefinition('browser_click');
      expect(clickDef?.capabilities).toContain('dom:interact');

      const executeDef = executor.getToolDefinition('browser_execute');
      expect(executeDef?.capabilities).toContain('code:execute');
    });
  });

  describe('evaluate tool', () => {
    it('should evaluate JavaScript code', async () => {
      const result = await executor.execute('evaluate', { code: '2 + 2' });

      expect(JSON.parse((result[0] as any).text)).toBe(4);
    });

    it('should throw for non-string code', async () => {
      await expect(executor.execute('evaluate', { code: 123 })).rejects.toThrow(
        BTCPExecutionError
      );
    });

    it('should use browser agent evaluate when available', async () => {
      const mockAgent: BrowserAgent = {
        snapshot: vi.fn(),
        click: vi.fn(),
        fill: vi.fn(),
        type: vi.fn(),
        hover: vi.fn(),
        press: vi.fn(),
        scroll: vi.fn(),
        getText: vi.fn(),
        getAttribute: vi.fn(),
        isVisible: vi.fn(),
        getUrl: vi.fn(),
        getTitle: vi.fn(),
        screenshot: vi.fn(),
        wait: vi.fn(),
        evaluate: vi.fn().mockResolvedValue('browser result'),
      };

      executor.setBrowserAgent(mockAgent);

      const result = await executor.execute('evaluate', { code: 'test()' });

      expect(mockAgent.evaluate).toHaveBeenCalledWith('test()');
    });
  });
});
