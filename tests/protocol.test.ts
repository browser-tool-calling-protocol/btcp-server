/**
 * Tests for protocol utilities
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateMessageId,
  createRequest,
  createResponse,
  createErrorResponse,
  createNotification,
  createTextContent,
  createImageContent,
  createResourceContent,
  createToolCallResponse,
  createToolCallErrorResponse,
  parseMessage,
  serializeMessage,
  isRequest,
  isResponse,
  isNotification,
  isErrorResponse,
  createToolsListRequest,
  createToolCallRequest,
  createToolsRegisterRequest,
  createSessionJoinRequest,
  createPingRequest,
  createPongResponse,
} from '../src/protocol.js';
import { BTCPParseError } from '../src/errors.js';

describe('Protocol Utilities', () => {
  describe('generateMessageId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateMessageId();
      const id2 = generateMessageId();
      const id3 = generateMessageId();

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it('should generate IDs with btcp prefix', () => {
      const id = generateMessageId();
      expect(id).toMatch(/^btcp-\d+-\d+$/);
    });
  });

  describe('createRequest', () => {
    it('should create a valid JSON-RPC request', () => {
      const request = createRequest('tools/list');

      expect(request.jsonrpc).toBe('2.0');
      expect(request.method).toBe('tools/list');
      expect(request.id).toBeDefined();
      expect(request.params).toBeUndefined();
    });

    it('should include params when provided', () => {
      const request = createRequest('tools/call', { name: 'echo', arguments: { msg: 'hi' } });

      expect(request.params).toEqual({ name: 'echo', arguments: { msg: 'hi' } });
    });

    it('should use custom ID when provided', () => {
      const request = createRequest('ping', undefined, 'custom-id-123');

      expect(request.id).toBe('custom-id-123');
    });
  });

  describe('createResponse', () => {
    it('should create a valid JSON-RPC response', () => {
      const response = createResponse('req-1', { success: true });

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('req-1');
      expect(response.result).toEqual({ success: true });
      expect(response.error).toBeUndefined();
    });

    it('should handle null result', () => {
      const response = createResponse('req-2', null);

      expect(response.result).toBeNull();
    });
  });

  describe('createErrorResponse', () => {
    it('should create a valid JSON-RPC error response', () => {
      const response = createErrorResponse('req-1', -32600, 'Invalid request');

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('req-1');
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32600);
      expect(response.error?.message).toBe('Invalid request');
    });

    it('should include error data when provided', () => {
      const response = createErrorResponse('req-1', -32602, 'Invalid params', { field: 'name' });

      expect(response.error?.data).toEqual({ field: 'name' });
    });
  });

  describe('createNotification', () => {
    it('should create a valid JSON-RPC notification', () => {
      const notification = createNotification('tools/updated');

      expect(notification.jsonrpc).toBe('2.0');
      expect(notification.method).toBe('tools/updated');
      expect((notification as any).id).toBeUndefined();
    });

    it('should include params when provided', () => {
      const notification = createNotification('browser/disconnected', { sessionId: 'sess-1' });

      expect(notification.params).toEqual({ sessionId: 'sess-1' });
    });
  });

  describe('Content Creators', () => {
    describe('createTextContent', () => {
      it('should create text content', () => {
        const content = createTextContent('Hello, world!');

        expect(content.type).toBe('text');
        expect(content.text).toBe('Hello, world!');
      });
    });

    describe('createImageContent', () => {
      it('should create image content with default mime type', () => {
        const content = createImageContent('base64data');

        expect(content.type).toBe('image');
        expect(content.data).toBe('base64data');
        expect(content.mimeType).toBe('image/png');
      });

      it('should use custom mime type', () => {
        const content = createImageContent('base64data', 'image/jpeg');

        expect(content.mimeType).toBe('image/jpeg');
      });
    });

    describe('createResourceContent', () => {
      it('should create resource content', () => {
        const content = createResourceContent('file:///path/to/file');

        expect(content.type).toBe('resource');
        expect(content.uri).toBe('file:///path/to/file');
      });

      it('should include optional fields', () => {
        const content = createResourceContent('file:///doc.txt', {
          text: 'File contents',
          mimeType: 'text/plain',
        });

        expect(content.text).toBe('File contents');
        expect(content.mimeType).toBe('text/plain');
      });
    });
  });

  describe('Tool Response Creators', () => {
    describe('createToolCallResponse', () => {
      it('should create a successful tool response', () => {
        const content = [createTextContent('Result')];
        const response = createToolCallResponse('req-1', content);

        expect(response.jsonrpc).toBe('2.0');
        expect(response.id).toBe('req-1');
        expect(response.result?.content).toEqual(content);
        expect(response.result?.isError).toBe(false);
      });
    });

    describe('createToolCallErrorResponse', () => {
      it('should create an error tool response', () => {
        const response = createToolCallErrorResponse('req-1', 'Tool failed');

        expect(response.id).toBe('req-1');
        expect(response.result?.isError).toBe(true);
        expect(response.result?.content[0]).toEqual({ type: 'text', text: 'Tool failed' });
        expect(response.error?.message).toBe('Tool failed');
      });

      it('should use custom error code', () => {
        const response = createToolCallErrorResponse('req-1', 'Not found', -32601);

        expect(response.error?.code).toBe(-32601);
      });
    });
  });

  describe('Message Parsing', () => {
    describe('parseMessage', () => {
      it('should parse a valid request', () => {
        const json = '{"jsonrpc":"2.0","id":"1","method":"ping"}';
        const message = parseMessage(json);

        expect(message.jsonrpc).toBe('2.0');
        expect((message as any).method).toBe('ping');
      });

      it('should parse a valid response', () => {
        const json = '{"jsonrpc":"2.0","id":"1","result":{"success":true}}';
        const message = parseMessage(json);

        expect((message as any).result).toEqual({ success: true });
      });

      it('should throw BTCPParseError for invalid JSON', () => {
        expect(() => parseMessage('not json')).toThrow(BTCPParseError);
      });

      it('should throw BTCPParseError for invalid JSON-RPC', () => {
        expect(() => parseMessage('{"foo":"bar"}')).toThrow(BTCPParseError);
      });
    });

    describe('serializeMessage', () => {
      it('should serialize a message to JSON', () => {
        const request = createRequest('ping');
        const json = serializeMessage(request);
        const parsed = JSON.parse(json);

        expect(parsed.jsonrpc).toBe('2.0');
        expect(parsed.method).toBe('ping');
      });
    });
  });

  describe('Type Guards', () => {
    describe('isRequest', () => {
      it('should return true for requests', () => {
        const request = createRequest('ping');
        expect(isRequest(request)).toBe(true);
      });

      it('should return false for responses', () => {
        const response = createResponse('1', {});
        expect(isRequest(response)).toBe(false);
      });

      it('should return false for notifications', () => {
        const notification = createNotification('event');
        expect(isRequest(notification)).toBe(false);
      });
    });

    describe('isResponse', () => {
      it('should return true for responses', () => {
        const response = createResponse('1', {});
        expect(isResponse(response)).toBe(true);
      });

      it('should return false for requests', () => {
        const request = createRequest('ping');
        expect(isResponse(request)).toBe(false);
      });
    });

    describe('isNotification', () => {
      it('should return true for notifications', () => {
        const notification = createNotification('event');
        expect(isNotification(notification)).toBe(true);
      });

      it('should return false for requests', () => {
        const request = createRequest('ping');
        expect(isNotification(request)).toBe(false);
      });
    });

    describe('isErrorResponse', () => {
      it('should return true for error responses', () => {
        const response = createErrorResponse('1', -32600, 'Error');
        expect(isErrorResponse(response)).toBe(true);
      });

      it('should return false for success responses', () => {
        const response = createResponse('1', {});
        expect(isErrorResponse(response)).toBe(false);
      });
    });
  });

  describe('BTCP-Specific Helpers', () => {
    describe('createToolsListRequest', () => {
      it('should create a tools/list request', () => {
        const request = createToolsListRequest();

        expect(request.method).toBe('tools/list');
      });

      it('should include filter when provided', () => {
        const request = createToolsListRequest({ capabilities: ['dom:read'] });

        expect(request.params).toEqual({ filter: { capabilities: ['dom:read'] } });
      });
    });

    describe('createToolCallRequest', () => {
      it('should create a tools/call request', () => {
        const request = createToolCallRequest('echo', { message: 'hi' });

        expect(request.method).toBe('tools/call');
        expect(request.params).toEqual({ name: 'echo', arguments: { message: 'hi' } });
      });

      it('should work without arguments', () => {
        const request = createToolCallRequest('browser_snapshot');

        expect(request.params).toEqual({ name: 'browser_snapshot' });
      });
    });

    describe('createToolsRegisterRequest', () => {
      it('should create a tools/register request', () => {
        const tools = [
          { name: 'test', description: 'Test tool', inputSchema: { type: 'object' } },
        ];
        const request = createToolsRegisterRequest(tools);

        expect(request.method).toBe('tools/register');
        expect(request.params).toEqual({ tools });
      });
    });

    describe('createSessionJoinRequest', () => {
      it('should create a session/join request', () => {
        const request = createSessionJoinRequest('session-123');

        expect(request.method).toBe('session/join');
        expect(request.params).toEqual({ sessionId: 'session-123' });
      });
    });

    describe('createPingRequest', () => {
      it('should create a ping request', () => {
        const request = createPingRequest();

        expect(request.method).toBe('ping');
      });
    });

    describe('createPongResponse', () => {
      it('should create a pong response', () => {
        const response = createPongResponse('ping-1');

        expect(response.id).toBe('ping-1');
        expect((response.result as any).pong).toBe(true);
        expect((response.result as any).timestamp).toBeDefined();
      });
    });
  });
});
