/**
 * agent-UI/transport/chatTransport.ts — Chat communication transport
 *
 * PURE COMMUNICATION LAYER — ZERO business logic.
 *
 * Defines the ChatTransport interface and provides two implementations:
 *   - HttpChatTransport: uses HTTP fetch (standalone HTTP mode)
 *   - IpcChatTransport: uses Electron IPC (electron-ipc mode)
 *
 * The factory function `createChatTransport()` selects the right one
 * based on the runtime environment.
 */

import type { AgentTurnResponse, AgentStreamChunk, AgentMessage, ToolDescriptor, ToolChoice } from '@agent-sdk';
import { BACKEND_URL } from '../config';
import { IS_ELECTRON_IPC } from '../env';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatParams {
  provider: string;
  model: string;
  messages: AgentMessage[];
  tools?: readonly ToolDescriptor[];
  toolChoice?: ToolChoice;
  systemPrompt?: string;
  signal?: AbortSignal;
}

export interface ChatTransport {
  /** Non-streaming chat — returns the full response. */
  sendAsync(params: ChatParams): Promise<AgentTurnResponse>;

  /** Streaming chat — returns a ReadableStream of chunks. */
  sendStream(params: ChatParams): ReadableStream<AgentStreamChunk>;
}

// ── HTTP implementation ───────────────────────────────────────────────────────

function createHttpChatTransport(): ChatTransport {
  return {
    async sendAsync(params: ChatParams): Promise<AgentTurnResponse> {
      const { provider, model, messages, tools, toolChoice, systemPrompt, signal } = params;
      const resp = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model, messages, tools, toolChoice, systemPrompt }),
        signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => resp.statusText);
        throw new Error(`Backend error (HTTP ${resp.status}): ${text}`);
      }

      return resp.json() as Promise<AgentTurnResponse>;
    },

    sendStream(params: ChatParams): ReadableStream<AgentStreamChunk> {
      const { provider, model, messages, tools, toolChoice, systemPrompt, signal } = params;

      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

      const startFetch = async () => {
        const resp = await fetch(`${BACKEND_URL}/api/chat/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, model, messages, tools, toolChoice, systemPrompt }),
          signal,
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => resp.statusText);
          throw new Error(`Backend stream error (HTTP ${resp.status}): ${text}`);
        }

        if (!resp.body) {
          throw new Error('No response body for streaming request');
        }

        reader = resp.body.getReader();
      };

      const fetchPromise = startFetch();
      const decoder = new TextDecoder();
      let buffer = '';

      return new ReadableStream<AgentStreamChunk>({
        async pull(controller) {
          await fetchPromise;
          if (!reader) { controller.close(); return; }

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              // Process remaining buffer
              if (buffer.trim()) {
                const lines = buffer.split('\n').filter((l) => l.trim());
                for (const line of lines) {
                  // SSE format: "data: <json>" — strip the prefix before parsing
                  const payload = line.trim().startsWith('data: ')
                    ? line.trim().slice(6).trim()
                    : line.trim();
                  if (payload === '[DONE]') continue;
                  try { controller.enqueue(JSON.parse(payload)); }
                  catch { console.warn('[chatTransport] SSE skip malformed JSON:', payload?.slice(0, 120)); }
                }
              }
              controller.close();
              return;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            // Keep last (possibly incomplete) line in buffer
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              // SSE format: "data: <json>" — strip the prefix before parsing
              const payload = trimmed.startsWith('data: ')
                ? trimmed.slice(6).trim()
                : trimmed;
              if (payload === '[DONE]') continue;
              try {
                controller.enqueue(JSON.parse(payload));
              } catch {
                console.warn('[chatTransport] SSE skip malformed JSON:', payload?.slice(0, 120));
              }
            }
          }
        },

        async cancel() {
          reader?.cancel().catch(() => {});
        },
      });
    },
  };
}

// ── IPC implementation ─────────────────────────────────────────────────────────

function createIpcChatTransport(): ChatTransport {
  const electronAPI = window.electronAPI;
  if (!electronAPI) {
    throw new Error('[IpcChatTransport] window.electronAPI is not available');
  }

  return {
    async sendAsync(params: ChatParams): Promise<AgentTurnResponse> {
      return electronAPI.invoke('chat:async', params) as Promise<AgentTurnResponse>;
    },

    sendStream(params: ChatParams): ReadableStream<AgentStreamChunk> {
      const { signal } = params;

      // Eagerly-initialized no-op — guarantees cancel() is always safe
      // even if called before start() completes (race-condition guard).
      let cleanup: () => void = () => {};
      // Promise-based sessionId: cancel() waits for resolution before
      // sending the stop IPC, preventing backend stream leaks.
      let resolveSessionId: (id: string) => void;
      const sessionIdPromise = new Promise<string>((resolve) => {
        resolveSessionId = resolve;
      });

      return new ReadableStream<AgentStreamChunk>({
        // CHANNEL ISOLATION: Each streaming session gets its own IPC channel
        // namespace (`chat:stream:<sessionId>:*`).  The sessionId is returned
        // by `chat:stream:start` BEFORE any chunk events fire — we use it to
        // construct per-session channel names so parallel streams cannot
        // cross-talk.  This mirrors the plugin stream pattern.
        async start(controller) {
          let cancelled = false;

          // Unsubscribe all IPC listeners — call once when the stream ends.
          const unsubs: (() => void)[] = [];

          const unsubscribeAll = () => {
            for (const unsub of unsubs) unsub();
            unsubs.length = 0;
          };

          // 1. Start the stream and get the session-scoped channel prefix.
          const result = (await electronAPI.invoke('chat:stream:start', params)) as { sessionId: string };
          const sessionId = result.sessionId;
          resolveSessionId(sessionId);
          const ch = (name: string) => `chat:stream:${sessionId}:${name}`;

          // 2. Subscribe to the session-scoped channels.
          const onChunk = (chunk: AgentStreamChunk) => {
            if (!cancelled) controller.enqueue(chunk);
          };

          const onDone = () => {
            if (!cancelled) {
              cancelled = true;
              unsubscribeAll();
              controller.close();
            }
          };

          const onError = (error: Error) => {
            if (!cancelled) {
              cancelled = true;
              unsubscribeAll();
              controller.error(error);
            }
          };

          cleanup = () => {
            if (!cancelled) {
              cancelled = true;
              unsubscribeAll();
            }
          };

          unsubs.push(
            electronAPI.on(ch('chunk'), onChunk as (...args: unknown[]) => void),
            electronAPI.on(ch('done'), onDone as (...args: unknown[]) => void),
            electronAPI.on(ch('error'), onError as (...args: unknown[]) => void),
          );

          if (signal) {
            signal.addEventListener('abort', () => {
              sessionIdPromise.then((id) => {
                electronAPI.invoke('chat:stream:stop', { sessionId: id });
              });
              cleanup();
            });
          }
        },

        cancel() {
          sessionIdPromise.then((id) => {
            electronAPI.invoke('chat:stream:stop', { sessionId: id });
          });
          cleanup();
        },
      });
    },
  };
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const chatTransport: ChatTransport = IS_ELECTRON_IPC
  ? createIpcChatTransport()
  : createHttpChatTransport();
