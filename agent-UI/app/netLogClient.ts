/**
 * agent-UI/app/netLogClient.ts — Debug recorder decorator for AppApiClient.
 *
 * Wraps a real {@link AppApiClient} so that every `call()` and
 * `connectStream()` is mirrored into the {@link netLog} store without the
 * underlying transport or any consumer being aware of it.
 *
 * Applied only when `IS_DEBUG` is true (see env.ts); in production builds the
 * client is returned untouched and this module is dead-code-eliminated.
 */

import type { AppApiClient, AppStreamClient } from '@agent-type';
import { netLog } from '../store/netLog';

/**
 * Return a proxy client that records all traffic for `appId` into the debug
 * store while delegating every operation to `inner`.
 */
export function withNetRecording(inner: AppApiClient, appId: string): AppApiClient {
  return {
    async call<T = unknown>(
      method: string,
      params?: Record<string, unknown>,
    ): Promise<T> {
      const entry = netLog.startCall(appId, method, params);
      try {
        const result = await inner.call<T>(method, params);
        netLog.endCall(entry, result);
        return result;
      } catch (err) {
        netLog.failCall(entry, err);
        throw err;
      }
    },

    connectStream(streamName: string, params?: Record<string, unknown>): AppStreamClient {
      const entry = netLog.startStream(appId, streamName, params);
      const innerClient = inner.connectStream(streamName, params);
      return wrapStreamClient(innerClient, entry);
    },
  };
}

/**
 * Wrap an {@link AppStreamClient} so chunk/end/error events are recorded.
 *
 * The transport calls `inner.callbacks.onData` etc. directly, so we install
 * dispatchers on the inner client that first record, then forward to whatever
 * callback the consumer assigned to the *returned* client. Consumers overwrite
 * `callbacks.*` before calling `subscribe()`, and the dispatchers resolve those
 * lazily, so assignment order does not matter.
 */
function wrapStreamClient(
  inner: AppStreamClient,
  entry: ReturnType<typeof netLog.startStream>,
): AppStreamClient {
  let userOnData: (chunk: unknown) => void = () => {};
  let userOnEnd: () => void = () => {};
  let userOnError: (error: Error) => void = () => {};

  inner.callbacks.onData = (chunk: unknown) => {
    netLog.streamChunk(entry, chunk);
    userOnData(chunk);
  };
  inner.callbacks.onEnd = () => {
    netLog.streamEnded(entry);
    userOnEnd();
  };
  inner.callbacks.onError = (error: Error) => {
    netLog.streamFailed(entry, error);
    userOnError(error);
  };

  const callbacks: AppStreamClient['callbacks'] = {
    get onData() {
      return userOnData;
    },
    set onData(fn: (chunk: unknown) => void) {
      userOnData = fn;
    },
    get onEnd() {
      return userOnEnd;
    },
    set onEnd(fn: () => void) {
      userOnEnd = fn;
    },
    get onError() {
      return userOnError;
    },
    set onError(fn: (error: Error) => void) {
      userOnError = fn;
    },
  };

  return {
    callbacks,
    subscribe: () => {
      netLog.streamSubscribed(entry);
      const sub = inner.subscribe();
      return {
        unsubscribe: () => {
          netLog.streamUnsubscribed(entry);
          sub.unsubscribe();
        },
      };
    },
  };
}
