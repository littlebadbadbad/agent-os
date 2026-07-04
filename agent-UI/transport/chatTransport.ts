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
                  catch { /* skip malformed */ }
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
                // Skip malformed JSON lines
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
  const electronAPI = (window as any).electronAPI;

  return {
    async sendAsync(params: ChatParams): Promise<AgentTurnResponse> {
      return electronAPI.invoke('chat:async', params) as Promise<AgentTurnResponse>;
    },

    sendStream(params: ChatParams): ReadableStream<AgentStreamChunk> {
      const { signal } = params;
      let cleanup: (() => void) | null = null;

      return new ReadableStream<AgentStreamChunk>({
        start(controller) {
          let cancelled = false;

          // Unsubscribe all IPC listeners — call once when the stream ends.
          const unsubs: (() => void)[] = [];

          const unsubscribeAll = () => {
            for (const unsub of unsubs) unsub();
            unsubs.length = 0;
          };

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
            electronAPI.on('chat:stream:chunk', onChunk),
            electronAPI.on('chat:stream:done', onDone),
            electronAPI.on('chat:stream:error', onError),
          );
          electronAPI.invoke('chat:stream:start', params);

          if (signal) {
            signal.addEventListener('abort', () => {
              electronAPI.invoke('chat:stream:stop');
              cleanup?.();
            });
          }
        },

        cancel() {
          electronAPI.invoke('chat:stream:stop');
          cleanup?.();
        },
      });
    },
  };
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const chatTransport: ChatTransport = IS_ELECTRON_IPC
  ? createIpcChatTransport()
  : createHttpChatTransport();
