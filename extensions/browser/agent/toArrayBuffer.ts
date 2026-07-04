/**
 * src/tools/browser/toArrayBuffer.ts — Cross-realm safe binary conversion
 *
 * Converts IPC-received values to ArrayBuffer regardless of which JavaScript
 * realm they were created in.  Essential for Electron IPC where data crossing
 * the contextBridge boundary may lose its original prototype chain, making
 * `instanceof` unreliable.
 *
 * `Object.prototype.toString` (the `[[Class]]` internal slot) is preserved
 * across V8 structured clones, so it works reliably across realms.
 *
 * Supported input types:
 *   - ArrayBuffer (pass-through, zero copy)
 *   - SharedArrayBuffer (copied into a plain ArrayBuffer)
 *   - All TypedArrays: Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array,
 *     Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array,
 *     BigInt64Array, BigUint64Array
 *   - DataView
 *
 * @param data  The value received from IPC (or any other source).
 * @returns     An ArrayBuffer with the same bytes, or `null` if the input
 *              is not binary data.
 */

function isTag(data: unknown, tag: string): boolean {
  return Object.prototype.toString.call(data) === tag;
}

/**
 * Copy a subsection of an ArrayBufferView's backing buffer into a new
 * standalone ArrayBuffer.  Handles non-zero `byteOffset` correctly
 * (e.g. subarrays, slices, and views into SharedArrayBuffer).
 */
function sliceArrayBufferView(view: ArrayBufferView): ArrayBuffer {
  if (view.byteLength === 0) return new ArrayBuffer(0);
  // Allocate a new standalone ArrayBuffer and copy the relevant subsection.
  // `new Uint8Array(view.buffer, byteOffset, length).buffer` returns the
  // ORIGINAL backing buffer (not a slice), so we must explicitly copy.
  const dest = new Uint8Array(view.byteLength);
  dest.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return dest.buffer as ArrayBuffer;
}

export function toArrayBuffer(data: unknown): ArrayBuffer | null {
  if (!data || typeof data !== 'object') return null;

  // ── Cross-realm safe: detect by [[Class]] tag ────────────────────────
  // Object.prototype.toString preserves the [[Class]] internal slot across
  // V8 structured clones (Electron contextBridge, postMessage, etc.) and
  // never throws — unlike `instanceof` which can fail when a constructor
  // is not defined (e.g. SharedArrayBuffer in Electron renderer without
  // COOP/COEP headers).

  // ArrayBuffer: direct pass-through (zero copy)
  if (isTag(data, '[object ArrayBuffer]')) return data as ArrayBuffer;

  // SharedArrayBuffer: must copy (can't pass across postMessage)
  if (isTag(data, '[object SharedArrayBuffer]')) {
    const sab = data as SharedArrayBuffer;
    const copy = new ArrayBuffer(sab.byteLength);
    new Uint8Array(copy).set(new Uint8Array(sab));
    return copy;
  }

  // Uint8Array is the most common case (Node.js Buffer → Uint8Array)
  if (isTag(data, '[object Uint8Array]')) {
    return sliceArrayBufferView(data as Uint8Array);
  }
  if (isTag(data, '[object Uint8ClampedArray]')) {
    return sliceArrayBufferView(data as Uint8ClampedArray);
  }
  if (isTag(data, '[object DataView]')) {
    return sliceArrayBufferView(data as DataView);
  }

  // Catch-all: all other TypedArrays (Int8Array, Uint16Array, Float64Array, etc.)
  if (ArrayBuffer.isView(data)) {
    return sliceArrayBufferView(data as ArrayBufferView);
  }

  return null;
}
