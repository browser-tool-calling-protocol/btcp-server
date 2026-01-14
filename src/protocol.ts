/**
 * BTCP Protocol - JSON-RPC 2.0 message utilities
 */

import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcMessage,
  JsonRpcError,
  BTCPContent,
  BTCPTextContent,
  BTCPImageContent,
  BTCPResourceContent,
  BTCPToolCallResponse,
} from './types.js';
import { BTCPParseError } from './errors.js';

// =============================================================================
// Message ID Generation
// =============================================================================

let messageCounter = 0;

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return `btcp-${Date.now()}-${++messageCounter}`;
}

// =============================================================================
// Message Creators
// =============================================================================

/**
 * Create a JSON-RPC 2.0 request
 */
export function createRequest(
  method: string,
  params?: Record<string, unknown>,
  id?: string | number
): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id: id ?? generateMessageId(),
    method,
    ...(params !== undefined && { params }),
  };
}

/**
 * Create a JSON-RPC 2.0 response
 */
export function createResponse(id: string | number, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

/**
 * Create a JSON-RPC 2.0 error response
 */
export function createErrorResponse(
  id: string | number,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  const error: JsonRpcError = {
    code,
    message,
    ...(data !== undefined && { data }),
  };
  return {
    jsonrpc: '2.0',
    id,
    error,
  };
}

/**
 * Create a JSON-RPC 2.0 notification (no id, no response expected)
 */
export function createNotification(
  method: string,
  params?: Record<string, unknown>
): JsonRpcNotification {
  return {
    jsonrpc: '2.0',
    method,
    ...(params !== undefined && { params }),
  };
}

// =============================================================================
// Content Creators
// =============================================================================

/**
 * Create text content
 */
export function createTextContent(text: string): BTCPTextContent {
  return {
    type: 'text',
    text,
  };
}

/**
 * Create image content
 */
export function createImageContent(data: string, mimeType: string = 'image/png'): BTCPImageContent {
  return {
    type: 'image',
    data,
    mimeType,
  };
}

/**
 * Create resource content
 */
export function createResourceContent(
  uri: string,
  options?: { text?: string; mimeType?: string; blob?: string }
): BTCPResourceContent {
  return {
    type: 'resource',
    uri,
    ...options,
  };
}

// =============================================================================
// Tool Response Creators
// =============================================================================

/**
 * Create a successful tool call response
 */
export function createToolCallResponse(
  id: string | number,
  content: BTCPContent[]
): BTCPToolCallResponse {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      content,
      isError: false,
    },
  };
}

/**
 * Create an error tool call response
 */
export function createToolCallErrorResponse(
  id: string | number,
  errorMessage: string,
  code: number = -32603
): BTCPToolCallResponse {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      content: [createTextContent(errorMessage)],
      isError: true,
    },
    error: {
      code,
      message: errorMessage,
    },
  };
}

// =============================================================================
// Message Parsing and Validation
// =============================================================================

/**
 * Parse a JSON-RPC message from a string
 */
export function parseMessage(data: string): JsonRpcMessage {
  try {
    const parsed = JSON.parse(data) as unknown;
    if (!isValidJsonRpcMessage(parsed)) {
      throw new BTCPParseError('Invalid JSON-RPC message structure');
    }
    return parsed;
  } catch (error) {
    if (error instanceof BTCPParseError) {
      throw error;
    }
    throw new BTCPParseError('Failed to parse JSON-RPC message', {
      originalError: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Serialize a JSON-RPC message to a string
 */
export function serializeMessage(message: JsonRpcMessage): string {
  return JSON.stringify(message);
}

/**
 * Check if an object is a valid JSON-RPC message
 */
function isValidJsonRpcMessage(obj: unknown): obj is JsonRpcMessage {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  const msg = obj as Record<string, unknown>;
  return msg['jsonrpc'] === '2.0';
}

// =============================================================================
// Message Type Guards
// =============================================================================

/**
 * Check if a message is a request (has id and method)
 */
export function isRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return 'id' in message && 'method' in message;
}

/**
 * Check if a message is a response (has id but no method)
 */
export function isResponse(message: JsonRpcMessage): message is JsonRpcResponse {
  return 'id' in message && !('method' in message);
}

/**
 * Check if a message is a notification (has method but no id)
 */
export function isNotification(message: JsonRpcMessage): message is JsonRpcNotification {
  return !('id' in message) && 'method' in message;
}

/**
 * Check if a response is an error response
 */
export function isErrorResponse(response: JsonRpcResponse): boolean {
  return 'error' in response && response.error !== undefined;
}

// =============================================================================
// BTCP-Specific Method Helpers
// =============================================================================

/**
 * Create a tools/list request
 */
export function createToolsListRequest(filter?: {
  capabilities?: string[];
  names?: string[];
}): JsonRpcRequest {
  return createRequest('tools/list', filter ? { filter } : undefined);
}

/**
 * Create a tools/call request
 */
export function createToolCallRequest(
  name: string,
  args?: Record<string, unknown>
): JsonRpcRequest {
  return createRequest('tools/call', {
    name,
    ...(args !== undefined && { arguments: args }),
  });
}

/**
 * Create a tools/register request
 */
export function createToolsRegisterRequest(
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    capabilities?: string[];
  }>
): JsonRpcRequest {
  return createRequest('tools/register', { tools });
}

/**
 * Create a session/join request
 */
export function createSessionJoinRequest(sessionId: string): JsonRpcRequest {
  return createRequest('session/join', { sessionId });
}

/**
 * Create a ping request
 */
export function createPingRequest(): JsonRpcRequest {
  return createRequest('ping');
}

/**
 * Create a pong response
 */
export function createPongResponse(id: string | number): JsonRpcResponse {
  return createResponse(id, {
    pong: true,
    timestamp: Date.now(),
  });
}
