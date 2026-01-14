/**
 * BTCP Tool Executor - Handles tool registration and execution
 */

import type {
  BTCPContent,
  BTCPToolDefinition,
  ToolHandler,
  ToolExecutorConfig,
  BrowserAgent,
  JsonSchema,
} from './types.js';
import { BTCPExecutionError, BTCPToolNotFoundError } from './errors.js';
import { createTextContent, createImageContent } from './protocol.js';

/**
 * Tool Executor class - manages tool registration and execution
 */
export class ToolExecutor {
  private handlers: Map<string, ToolHandler> = new Map();
  private toolDefinitions: Map<string, BTCPToolDefinition> = new Map();
  private browserAgent?: BrowserAgent;
  private debug: boolean;

  constructor(config: ToolExecutorConfig = {}) {
    this.debug = config.debug ?? false;
    this.browserAgent = config.browserAgent;

    // Register default handlers
    this.registerDefaultHandlers();

    // Register custom handlers from config
    if (config.handlers) {
      for (const [name, handler] of Object.entries(config.handlers)) {
        this.registerHandler(name, handler);
      }
    }

    // Register browser agent tools if available
    if (this.browserAgent) {
      this.registerBrowserAgentTools();
    }
  }

  /**
   * Register a tool handler
   */
  registerHandler(name: string, handler: ToolHandler, definition?: BTCPToolDefinition): void {
    this.handlers.set(name, handler);
    if (definition) {
      this.toolDefinitions.set(name, definition);
    }
    this.log(`Registered handler: ${name}`);
  }

  /**
   * Unregister a tool handler
   */
  unregisterHandler(name: string): boolean {
    const deleted = this.handlers.delete(name);
    this.toolDefinitions.delete(name);
    if (deleted) {
      this.log(`Unregistered handler: ${name}`);
    }
    return deleted;
  }

  /**
   * Check if a handler exists
   */
  hasHandler(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Execute a tool by name
   */
  async execute(name: string, args: Record<string, unknown> = {}): Promise<BTCPContent[]> {
    const handler = this.handlers.get(name);
    if (!handler) {
      throw new BTCPToolNotFoundError(name);
    }

    this.log(`Executing tool: ${name}`, args);

    try {
      const result = await handler(args);
      return this.normalizeResult(result);
    } catch (error) {
      if (error instanceof BTCPToolNotFoundError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new BTCPExecutionError(message, name, { originalError: error });
    }
  }

  /**
   * Get all registered tool definitions
   */
  getToolDefinitions(): BTCPToolDefinition[] {
    return Array.from(this.toolDefinitions.values());
  }

  /**
   * Get a specific tool definition
   */
  getToolDefinition(name: string): BTCPToolDefinition | undefined {
    return this.toolDefinitions.get(name);
  }

  /**
   * Set the browser agent for browser automation tools
   */
  setBrowserAgent(agent: BrowserAgent): void {
    this.browserAgent = agent;
    this.registerBrowserAgentTools();
  }

  /**
   * Normalize various result types to BTCPContent[]
   */
  private normalizeResult(result: unknown): BTCPContent[] {
    // Already an array of BTCPContent
    if (Array.isArray(result)) {
      if (result.length > 0 && this.isBTCPContent(result[0])) {
        return result as BTCPContent[];
      }
      return [createTextContent(JSON.stringify(result, null, 2))];
    }

    // Single BTCPContent
    if (this.isBTCPContent(result)) {
      return [result];
    }

    // String result
    if (typeof result === 'string') {
      // Check if it's base64 image data
      if (this.isBase64Image(result)) {
        return [createImageContent(result, this.detectImageMimeType(result))];
      }
      return [createTextContent(result)];
    }

    // Object result
    if (typeof result === 'object' && result !== null) {
      return [createTextContent(JSON.stringify(result, null, 2))];
    }

    // Primitive result
    return [createTextContent(String(result))];
  }

  /**
   * Check if a value is a BTCPContent object
   */
  private isBTCPContent(value: unknown): value is BTCPContent {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const obj = value as Record<string, unknown>;
    return (
      obj['type'] === 'text' ||
      obj['type'] === 'image' ||
      obj['type'] === 'resource'
    );
  }

  /**
   * Check if a string is base64 image data
   */
  private isBase64Image(str: string): boolean {
    return (
      str.startsWith('data:image/') ||
      /^[A-Za-z0-9+/=]{100,}$/.test(str.slice(0, 200))
    );
  }

  /**
   * Detect image MIME type from base64 data
   */
  private detectImageMimeType(data: string): string {
    if (data.startsWith('data:image/png')) return 'image/png';
    if (data.startsWith('data:image/jpeg')) return 'image/jpeg';
    if (data.startsWith('data:image/gif')) return 'image/gif';
    if (data.startsWith('data:image/webp')) return 'image/webp';
    if (data.startsWith('data:image/svg')) return 'image/svg+xml';
    return 'image/png'; // default
  }

  /**
   * Register default built-in handlers
   */
  private registerDefaultHandlers(): void {
    // Echo tool for testing
    this.registerHandler(
      'echo',
      async (args) => {
        const message = args['message'] ?? 'Hello from BTCP!';
        return createTextContent(String(message));
      },
      {
        name: 'echo',
        description: 'Echo a message back (useful for testing)',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The message to echo back',
              default: 'Hello from BTCP!',
            },
          },
        },
      }
    );

    // Evaluate JavaScript (with safety warning)
    this.registerHandler(
      'evaluate',
      async (args) => {
        const code = args['code'];
        if (typeof code !== 'string') {
          throw new BTCPExecutionError('Code must be a string', 'evaluate');
        }

        // If browser agent is available, use it
        if (this.browserAgent) {
          const result = await this.browserAgent.evaluate(code);
          return createTextContent(JSON.stringify(result, null, 2));
        }

        // Fallback to local eval (Node.js environment)
        // eslint-disable-next-line no-eval
        const result = eval(code);
        return createTextContent(JSON.stringify(result, null, 2));
      },
      {
        name: 'evaluate',
        description: 'Evaluate JavaScript code and return the result',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'The JavaScript code to evaluate',
            },
          },
          required: ['code'],
        },
        capabilities: ['code:execute'],
      }
    );
  }

  /**
   * Register browser automation tools when a BrowserAgent is available
   */
  private registerBrowserAgentTools(): void {
    if (!this.browserAgent) return;

    const agent = this.browserAgent;

    // browser_snapshot - Get accessibility tree/DOM snapshot
    this.registerHandler(
      'browser_snapshot',
      async () => {
        const snapshot = await agent.snapshot();
        return createTextContent(snapshot);
      },
      {
        name: 'browser_snapshot',
        description: 'Get the current page accessibility tree/DOM snapshot',
        inputSchema: { type: 'object', properties: {} },
        capabilities: ['dom:read'],
      }
    );

    // browser_click - Click an element
    this.registerHandler(
      'browser_click',
      async (args) => {
        const selector = String(args['selector'] ?? '');
        await agent.click(selector);
        return createTextContent(`Clicked element: ${selector}`);
      },
      {
        name: 'browser_click',
        description: 'Click an element on the page',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector or accessibility reference',
            },
          },
          required: ['selector'],
        },
        capabilities: ['dom:interact'],
      }
    );

    // browser_fill - Fill an input field
    this.registerHandler(
      'browser_fill',
      async (args) => {
        const selector = String(args['selector'] ?? '');
        const value = String(args['value'] ?? '');
        await agent.fill(selector, value);
        return createTextContent(`Filled "${selector}" with value`);
      },
      {
        name: 'browser_fill',
        description: 'Fill an input field with a value (clears existing content)',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector or accessibility reference',
            },
            value: {
              type: 'string',
              description: 'The value to fill',
            },
          },
          required: ['selector', 'value'],
        },
        capabilities: ['dom:interact'],
      }
    );

    // browser_type - Type text (without clearing)
    this.registerHandler(
      'browser_type',
      async (args) => {
        const text = String(args['text'] ?? '');
        await agent.type(text);
        return createTextContent(`Typed: ${text}`);
      },
      {
        name: 'browser_type',
        description: 'Type text at the current focus position',
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'The text to type',
            },
          },
          required: ['text'],
        },
        capabilities: ['dom:interact'],
      }
    );

    // browser_hover - Hover over an element
    this.registerHandler(
      'browser_hover',
      async (args) => {
        const selector = String(args['selector'] ?? '');
        await agent.hover(selector);
        return createTextContent(`Hovered over: ${selector}`);
      },
      {
        name: 'browser_hover',
        description: 'Hover over an element',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector or accessibility reference',
            },
          },
          required: ['selector'],
        },
        capabilities: ['dom:interact'],
      }
    );

    // browser_press - Press a key
    this.registerHandler(
      'browser_press',
      async (args) => {
        const key = String(args['key'] ?? '');
        await agent.press(key);
        return createTextContent(`Pressed key: ${key}`);
      },
      {
        name: 'browser_press',
        description: 'Press a keyboard key (e.g., "Enter", "Tab", "Escape")',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'The key to press',
            },
          },
          required: ['key'],
        },
        capabilities: ['dom:interact'],
      }
    );

    // browser_scroll - Scroll the page
    this.registerHandler(
      'browser_scroll',
      async (args) => {
        const direction = (args['direction'] as 'up' | 'down' | 'left' | 'right') ?? 'down';
        const amount = typeof args['amount'] === 'number' ? args['amount'] : undefined;
        await agent.scroll(direction, amount);
        return createTextContent(`Scrolled ${direction}${amount ? ` by ${amount}px` : ''}`);
      },
      {
        name: 'browser_scroll',
        description: 'Scroll the page in a direction',
        inputSchema: {
          type: 'object',
          properties: {
            direction: {
              type: 'string',
              enum: ['up', 'down', 'left', 'right'],
              description: 'Direction to scroll',
              default: 'down',
            },
            amount: {
              type: 'number',
              description: 'Amount to scroll in pixels (optional)',
            },
          },
        },
        capabilities: ['dom:interact'],
      }
    );

    // browser_get_text - Get text content of an element
    this.registerHandler(
      'browser_get_text',
      async (args) => {
        const selector = String(args['selector'] ?? '');
        const text = await agent.getText(selector);
        return createTextContent(text);
      },
      {
        name: 'browser_get_text',
        description: 'Get the text content of an element',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector or accessibility reference',
            },
          },
          required: ['selector'],
        },
        capabilities: ['dom:read'],
      }
    );

    // browser_get_attribute - Get attribute of an element
    this.registerHandler(
      'browser_get_attribute',
      async (args) => {
        const selector = String(args['selector'] ?? '');
        const attribute = String(args['attribute'] ?? '');
        const value = await agent.getAttribute(selector, attribute);
        return createTextContent(value ?? 'null');
      },
      {
        name: 'browser_get_attribute',
        description: 'Get an attribute value from an element',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector or accessibility reference',
            },
            attribute: {
              type: 'string',
              description: 'The attribute name to get',
            },
          },
          required: ['selector', 'attribute'],
        },
        capabilities: ['dom:read'],
      }
    );

    // browser_is_visible - Check if element is visible
    this.registerHandler(
      'browser_is_visible',
      async (args) => {
        const selector = String(args['selector'] ?? '');
        const visible = await agent.isVisible(selector);
        return createTextContent(String(visible));
      },
      {
        name: 'browser_is_visible',
        description: 'Check if an element is visible on the page',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector or accessibility reference',
            },
          },
          required: ['selector'],
        },
        capabilities: ['dom:read'],
      }
    );

    // browser_get_url - Get current URL
    this.registerHandler(
      'browser_get_url',
      async () => {
        const url = await agent.getUrl();
        return createTextContent(url);
      },
      {
        name: 'browser_get_url',
        description: 'Get the current page URL',
        inputSchema: { type: 'object', properties: {} },
        capabilities: ['dom:read'],
      }
    );

    // browser_get_title - Get page title
    this.registerHandler(
      'browser_get_title',
      async () => {
        const title = await agent.getTitle();
        return createTextContent(title);
      },
      {
        name: 'browser_get_title',
        description: 'Get the current page title',
        inputSchema: { type: 'object', properties: {} },
        capabilities: ['dom:read'],
      }
    );

    // browser_screenshot - Take a screenshot
    this.registerHandler(
      'browser_screenshot',
      async () => {
        const screenshot = await agent.screenshot();
        return createImageContent(screenshot, 'image/png');
      },
      {
        name: 'browser_screenshot',
        description: 'Take a screenshot of the current page',
        inputSchema: { type: 'object', properties: {} },
        capabilities: ['dom:read'],
      }
    );

    // browser_wait - Wait for a specified time
    this.registerHandler(
      'browser_wait',
      async (args) => {
        const timeout = typeof args['timeout'] === 'number' ? args['timeout'] : 1000;
        await agent.wait(timeout);
        return createTextContent(`Waited ${timeout}ms`);
      },
      {
        name: 'browser_wait',
        description: 'Wait for a specified number of milliseconds',
        inputSchema: {
          type: 'object',
          properties: {
            timeout: {
              type: 'number',
              description: 'Time to wait in milliseconds',
              default: 1000,
            },
          },
        },
        capabilities: [],
      }
    );

    // browser_execute - Execute arbitrary JavaScript
    this.registerHandler(
      'browser_execute',
      async (args) => {
        const script = String(args['script'] ?? '');
        const result = await agent.evaluate(script);
        return createTextContent(JSON.stringify(result, null, 2));
      },
      {
        name: 'browser_execute',
        description: 'Execute JavaScript code in the browser context',
        inputSchema: {
          type: 'object',
          properties: {
            script: {
              type: 'string',
              description: 'The JavaScript code to execute',
            },
          },
          required: ['script'],
        },
        capabilities: ['code:execute'],
      }
    );
  }

  /**
   * Debug logging
   */
  private log(message: string, data?: unknown): void {
    if (this.debug) {
      console.log(`[ToolExecutor] ${message}`, data ?? '');
    }
  }
}
