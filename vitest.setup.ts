// vitest setup: polyfills for browser-only APIs used in tests

// requestAnimationFrame / cancelAnimationFrame — used by sub-agent
// registry's batched streaming-text rendering (registryExecution.ts)
globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number =>
  setTimeout(cb, 16) as unknown as number;
globalThis.cancelAnimationFrame = (id: number): void =>
  clearTimeout(id);
