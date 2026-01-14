# BTCP - Browser Tool Calling Protocol

An open standard enabling AI agents to discover and invoke tools directly within browsers through client-defined interfaces.

## Overview

BTCP (Browser Tool Calling Protocol) is a client-side tool execution framework that enables AI agents to interact with browser-based tools. Unlike server-side protocols, BTCP executes tools locally in the browser, providing:

- **Security**: Sandboxed execution with capability-based permissions
- **Performance**: No network round-trips for tool execution
- **Privacy**: Sensitive data never leaves the browser

### Architecture

```
┌──────────────┐     HTTP Streaming     ┌──────────────┐     MCP     ┌──────────────┐
│   Browser    │◄─────(SSE + POST)─────►│  BTCP Server │◄──────────►│   AI Agent   │
│   Client     │                        │    (Relay)   │            │              │
└──────────────┘                        └──────────────┘            └──────────────┘
      ▲
      │ Tool Execution (local, sandboxed)
      ▼
┌──────────────┐
│  Browser DOM │
└──────────────┘
```

## Installation

```bash
npm install btcp-client
```

## Quick Start

### 1. Start the Server

```bash
npm run start:server
```

### 2. Connect a Browser Client

```typescript
import { BTCPClient } from 'btcp-client';

const client = new BTCPClient({
  serverUrl: 'http://localhost:8765',
  sessionId: 'my-session',
  debug: true,
});

// Set up browser agent for DOM automation
client.setBrowserAgent(myBrowserAgent);

// Connect and register tools
await client.connect();
await client.registerTools();
```

### 3. Connect an AI Agent

```typescript
// Join the session
const joinResponse = await request(createSessionJoinRequest('my-session'));

// List available tools
const tools = await request(createToolsListRequest());

// Call a tool
const result = await request(createToolCallRequest('browser_click', {
  selector: '#submit-button'
}));
```

## API Reference

### BTCPClient

The main client class for browser applications.

```typescript
const client = new BTCPClient({
  serverUrl: string;      // Server URL (default: 'http://localhost:8765')
  sessionId?: string;     // Session identifier
  debug?: boolean;        // Enable debug logging
  autoReconnect?: boolean; // Auto-reconnect on disconnect (default: true)
  reconnectDelay?: number; // Reconnect delay in ms (default: 1000)
  maxReconnectAttempts?: number; // Max reconnect attempts (default: 5)
  connectionTimeout?: number; // Connection timeout in ms (default: 30000)
});
```

#### Methods

- `connect(): Promise<void>` - Connect to the server
- `disconnect(): void` - Disconnect from the server
- `isConnected(): boolean` - Check connection status
- `getSessionId(): string` - Get the session ID
- `getExecutor(): ToolExecutor` - Get the tool executor
- `setBrowserAgent(agent: BrowserAgent): void` - Set browser automation agent
- `registerTools(tools?: BTCPToolDefinition[]): Promise<void>` - Register tools
- `request(method: string, params?: object): Promise<unknown>` - Send a request
- `on(event, handler): void` - Subscribe to events
- `off(event, handler): void` - Unsubscribe from events

#### Events

- `connect` - Connection established
- `disconnect` - Connection lost
- `error` - Error occurred
- `message` - Message received
- `toolCall` - Tool call received
- `toolsList` - Tools list updated

### BTCPServer

The relay server for routing messages between browsers and agents.

```typescript
const server = new BTCPServer({
  port?: number;           // Server port (default: 8765)
  host?: string;           // Server host (default: '0.0.0.0')
  debug?: boolean;         // Enable debug logging
  keepAliveInterval?: number; // Keep-alive interval in ms (default: 30000)
  requestTimeout?: number; // Request timeout in ms (default: 30000)
});
```

#### Methods

- `start(): Promise<void>` - Start the server
- `stop(): Promise<void>` - Stop the server

#### HTTP Endpoints

- `GET /events` - SSE stream for real-time communication
- `POST /message` - Send JSON-RPC messages
- `GET /health` - Health check
- `GET /sessions` - List active sessions

### ToolExecutor

Manages tool registration and execution.

```typescript
const executor = new ToolExecutor({
  handlers?: Record<string, ToolHandler>;
  browserAgent?: BrowserAgent;
  debug?: boolean;
});
```

#### Methods

- `registerHandler(name, handler, definition?): void` - Register a tool
- `unregisterHandler(name): boolean` - Remove a tool
- `hasHandler(name): boolean` - Check if tool exists
- `execute(name, args): Promise<BTCPContent[]>` - Execute a tool
- `getToolDefinitions(): BTCPToolDefinition[]` - Get all tool definitions
- `setBrowserAgent(agent): void` - Set browser agent

## Built-in Browser Tools

When a `BrowserAgent` is attached, these tools are automatically available:

| Tool | Description | Capability |
|------|-------------|------------|
| `browser_snapshot` | Get page accessibility tree | `dom:read` |
| `browser_click` | Click an element | `dom:interact` |
| `browser_fill` | Fill an input field | `dom:interact` |
| `browser_type` | Type text | `dom:interact` |
| `browser_hover` | Hover over element | `dom:interact` |
| `browser_press` | Press a key | `dom:interact` |
| `browser_scroll` | Scroll the page | `dom:interact` |
| `browser_get_text` | Get element text | `dom:read` |
| `browser_get_attribute` | Get element attribute | `dom:read` |
| `browser_is_visible` | Check element visibility | `dom:read` |
| `browser_get_url` | Get current URL | `dom:read` |
| `browser_get_title` | Get page title | `dom:read` |
| `browser_screenshot` | Take screenshot | `dom:read` |
| `browser_wait` | Wait for time | - |
| `browser_execute` | Execute JavaScript | `code:execute` |

## Protocol

BTCP uses JSON-RPC 2.0 over HTTP Streaming:

- **SSE (Server-Sent Events)** for server-to-client messages
- **HTTP POST** for client-to-server messages

### Message Types

```typescript
// Tool Registration
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "tools/register",
  "params": {
    "tools": [{ "name": "...", "description": "...", "inputSchema": {...} }]
  }
}

// Tool Call
{
  "jsonrpc": "2.0",
  "id": "2",
  "method": "tools/call",
  "params": {
    "name": "browser_click",
    "arguments": { "selector": "#button" }
  }
}

// Tool Response
{
  "jsonrpc": "2.0",
  "id": "2",
  "result": {
    "content": [{ "type": "text", "text": "Clicked element: #button" }],
    "isError": false
  }
}
```

## Error Handling

BTCP provides typed error classes:

```typescript
import {
  BTCPError,           // Base error
  BTCPConnectionError, // Connection failures
  BTCPTimeoutError,    // Request timeouts
  BTCPValidationError, // Invalid parameters
  BTCPExecutionError,  // Tool execution failures
  BTCPToolNotFoundError, // Tool not found
} from 'btcp-client';
```

## Examples

See the `src/examples/` directory:

- `browser-client.ts` - Browser client with mock agent
- `agent-client.ts` - AI agent connecting to browser

Run the examples:

```bash
# Terminal 1: Start server
npm run start:server

# Terminal 2: Start browser client
npx ts-node src/examples/browser-client.ts my-session

# Terminal 3: Run agent
npx ts-node src/examples/agent-client.ts my-session
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in development mode
npm run dev
```

## License

MIT
