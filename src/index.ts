/**
 * BTCP - Browser Tool Calling Protocol
 *
 * An open standard enabling AI agents to discover and invoke tools
 * directly within browsers through client-defined interfaces.
 *
 * @packageDocumentation
 */

// =============================================================================
// Core Classes
// =============================================================================

export { BTCPClient } from './client.js';
export { BTCPServer } from './server.js';
export { ToolExecutor } from './executor.js';

// =============================================================================
// Error Classes
// =============================================================================

export {
  ErrorCodes,
  BTCPError,
  BTCPConnectionError,
  BTCPTimeoutError,
  BTCPSessionError,
  BTCPValidationError,
  BTCPExecutionError,
  BTCPToolNotFoundError,
  BTCPPermissionError,
  BTCPParseError,
  BTCPInvalidRequestError,
  BTCPMethodNotFoundError,
} from './errors.js';

// =============================================================================
// Protocol Utilities
// =============================================================================

export {
  // Message ID
  generateMessageId,

  // Message creators
  createRequest,
  createResponse,
  createErrorResponse,
  createNotification,

  // Content creators
  createTextContent,
  createImageContent,
  createResourceContent,

  // Tool response creators
  createToolCallResponse,
  createToolCallErrorResponse,

  // Message parsing
  parseMessage,
  serializeMessage,

  // Type guards
  isRequest,
  isResponse,
  isNotification,
  isErrorResponse,

  // BTCP-specific helpers
  createToolsListRequest,
  createToolCallRequest,
  createToolsRegisterRequest,
  createSessionJoinRequest,
  createPingRequest,
  createPongResponse,
} from './protocol.js';

// =============================================================================
// Types
// =============================================================================

export type {
  // JSON-RPC types
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  JsonRpcNotification,
  JsonRpcMessage,

  // JSON Schema
  JsonSchema,

  // BTCP Tool types
  BTCPToolDefinition,
  BTCPToolExample,

  // BTCP Content types
  BTCPContent,
  BTCPTextContent,
  BTCPImageContent,
  BTCPResourceContent,

  // BTCP Message types
  BTCPMessageType,
  BTCPHelloMessage,
  BTCPToolsListRequest,
  BTCPToolsListResponse,
  BTCPToolCallRequest,
  BTCPToolCallResponse,
  BTCPToolRegisterRequest,
  BTCPSessionJoinRequest,
  BTCPSessionJoinResponse,
  BTCPPingMessage,
  BTCPPongMessage,

  // Configuration types
  BTCPClientConfig,
  BTCPClientEvents,
  BTCPClientEventName,
  BTCPClientEventHandler,
  BTCPServerConfig,

  // Executor types
  ToolHandler,
  ToolExecutorConfig,

  // Browser Agent interface
  BrowserAgent,

  // Server types
  SSEClient,
  Session,
  PendingResponse,
} from './types.js';

// =============================================================================
// Default Export
// =============================================================================

export { BTCPClient as default } from './client.js';
