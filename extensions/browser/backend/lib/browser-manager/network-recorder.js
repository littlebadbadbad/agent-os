/**
 * NetworkRecorder — captures all HTTP network activity for a single Playwright Page.
 *
 * Attaches three Playwright event listeners (request, response, requestfailed) on
 * construction and removes them when stop() is called.
 *
 * Entries are stored in a fixed-capacity ring buffer keyed by a globally-assigned
 * monotonic id injected from the parent BrowserInstance.  This guarantees that
 * afterId-based cursor pagination works correctly across tabs.
 *
 * @example
 * ```js
 * const recorder = new NetworkRecorder(page, {
 *   tabIndex: 0,
 *   getNextId: () => globalId++,
 * });
 * // … later …
 * const { entries } = recorder.query({ resourceType: ['xhr', 'fetch'], limit: 50 });
 * recorder.stop();
 * ```
 */

const DEFAULT_MAX_ENTRIES = 1000;
/** Maximum bytes stored per request or response body. Bodies exceeding this are truncated. */
const MAX_BODY_BYTES = 64 * 1024; // 64 KB

/**
 * @typedef {Object} NetworkEntry
 * @property {number}                    id              - Monotonic global id (cross-tab).
 * @property {number}                    tabIndex        - Zero-based tab index this entry belongs to.
 * @property {number}                    timestamp       - Unix ms when the request was initiated.
 * @property {string}                    method          - HTTP method, e.g. 'GET'.
 * @property {string}                    url             - Full request URL.
 * @property {string}                    resourceType    - Playwright resource type: document, xhr, fetch, …
 * @property {number|null}               status          - HTTP response status code, null if no response.
 * @property {string|null}               statusText      - HTTP status text, null if no response.
 * @property {number|null}               duration        - Round-trip time in ms, null if not completed.
 * @property {Record<string,string>|null} requestHeaders  - Request headers (only when includeHeaders=true).
 * @property {Record<string,string>|null} responseHeaders - Response headers (only when includeHeaders=true).
 * @property {string|null}               requestBody     - Request body (POST data), truncated to 64 KB. null if absent or includeBody=false.
 * @property {string|null}               responseBody    - Response body for text content types, truncated to 64 KB. null if binary or includeBody=false.
 * @property {boolean}                   responseBodyTruncated - True when responseBody was truncated at MAX_BODY_BYTES.
 * @property {boolean}                   failed          - Whether the request failed at the network level.
 * @property {string|null}               failureText     - Playwright failure description, null if not failed.
 */

/**
 * @typedef {Object} NetworkQueryOptions
 * @property {number}   [limit=100]       - Maximum number of entries to return.
 * @property {number}   [afterId]         - Only return entries with id strictly > afterId.
 * @property {string[]} [resourceType]    - Filter by Playwright resource type.
 * @property {string}   [urlPattern]      - Substring filter applied to entry.url.
 * @property {string[]} [methodFilter]    - Filter by HTTP method (case-insensitive).
 * @property {boolean}  [includeHeaders]  - Whether to include request/response headers (default false).
 * @property {boolean}  [includeBody]     - Whether to include request/response body text (default false).
 * @property {number}   [statusMin]       - Only return entries with status >= statusMin (e.g. 400).
 * @property {number}   [statusMax]       - Only return entries with status <= statusMax (e.g. 499).
 * @property {boolean}  [onlyFailed]      - Only return network-failed requests (failed === true).
 * @property {number}   [minDurationMs]   - Only return entries with duration >= minDurationMs.
 * @property {number}   [maxDurationMs]   - Only return entries with duration <= maxDurationMs.
 * @property {string}   [bodyKeyword]     - Case-insensitive substring filter on requestBody or responseBody.
 * @property {string}   [headerKeyword]   - Case-insensitive substring filter on request/response header names or values.
 * @property {number}   [bodyMaxBytes]    - Truncate returned body strings to this many bytes (default: full captured content).
 */

/**
 * @typedef {Object} NetworkQueryResult
 * @property {NetworkEntry[]} entries    - Matching entries (ascending id order).
 * @property {number}         totalCount - Total entries in the buffer (before limit/filter).
 * @property {boolean}        hasMore    - True when more entries exist beyond the returned slice.
 */

export class NetworkRecorder {
  /** @type {number} */
  #tabIndex;
  /** @type {() => number} */
  #getNextId;
  /** @type {number} */
  #maxEntries;
  /**
   * Completed and in-flight entries, ordered by id ascending.
   * In-flight entries (no response yet) are present with status=null.
   * @type {NetworkEntry[]}
   */
  #entries = [];
  /**
   * Tracks in-flight requests: maps a Playwright Request object to the
   * corresponding entry so we can fill in response details when they arrive.
   * @type {Map<import('playwright').Request, NetworkEntry>}
   */
  #pending = new Map();

  // Bound listener references so they can be removed with page.off().
  #onRequest;
  #onResponse;
  #onRequestFailed;

  /** @type {import('playwright').Page} */
  #page;

  /**
   * @param {import('playwright').Page} page
   * @param {{ tabIndex: number; getNextId: () => number; maxEntries?: number }} opts
   */
  constructor(page, { tabIndex, getNextId, maxEntries = DEFAULT_MAX_ENTRIES }) {
    this.#page       = page;
    this.#tabIndex   = tabIndex;
    this.#getNextId  = getNextId;
    this.#maxEntries = maxEntries;

    // Bind listeners once so we can remove them later.
    this.#onRequest      = this.#handleRequest.bind(this);
    this.#onResponse     = this.#handleResponse.bind(this);
    this.#onRequestFailed = this.#handleRequestFailed.bind(this);

    page.on('request',       this.#onRequest);
    page.on('response',      this.#onResponse);
    page.on('requestfailed', this.#onRequestFailed);
  }

  // ── Private event handlers ─────────────────────────────────────────────────

  /** @param {import('playwright').Request} request */
  #handleRequest(request) {
    const rawPostData = request.postData();
    const requestBody = rawPostData
      ? rawPostData.slice(0, MAX_BODY_BYTES)
      : null;

    const entry = {
      id:                    this.#getNextId(),
      tabIndex:              this.#tabIndex,
      timestamp:             Date.now(),
      method:                request.method(),
      url:                   request.url(),
      resourceType:          request.resourceType(),
      status:                null,
      statusText:            null,
      duration:              null,
      requestHeaders:        this.#extractHeaders(request.headers()),
      responseHeaders:       null,
      requestBody,
      responseBody:          null,
      responseBodyTruncated: false,
      failed:                false,
      failureText:           null,
    };

    this.#pending.set(request, entry);
    this.#pushEntry(entry);
  }

  /** @param {import('playwright').Response} response */
  async #handleResponse(response) {
    const request = response.request();
    const entry   = this.#pending.get(request);
    if (!entry) return;

    entry.status     = response.status();
    entry.statusText = response.statusText();
    entry.duration   = Date.now() - entry.timestamp;

    try {
      const allHeaders      = await response.allHeaders();
      entry.responseHeaders = this.#extractHeaders(allHeaders);

      // Capture text-type response bodies within the size limit.
      const ct = response.headers()['content-type'] ?? '';
      if (this.#isTextContentType(ct)) {
        try {
          const buf  = await response.body();
          const text = buf.toString('utf8');
          if (text.length > MAX_BODY_BYTES) {
            entry.responseBody          = text.slice(0, MAX_BODY_BYTES);
            entry.responseBodyTruncated = true;
          } else {
            entry.responseBody = text;
          }
        } catch { /* page closed or body already consumed */ }
      }
    } catch {
      // allHeaders() can throw if the page is already closed.
      entry.responseHeaders = this.#extractHeaders(response.headers());
    }

    this.#pending.delete(request);
  }

  /** @param {import('playwright').Request} request */
  #handleRequestFailed(request) {
    const entry = this.#pending.get(request);
    if (!entry) return;

    entry.failed      = true;
    entry.failureText = request.failure()?.errorText ?? 'unknown failure';
    entry.duration    = Date.now() - entry.timestamp;
    this.#pending.delete(request);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Push a new entry into the ring buffer, evicting the oldest when full.
   * @param {NetworkEntry} entry
   */
  #pushEntry(entry) {
    this.#entries.push(entry);
    if (this.#entries.length > this.#maxEntries) {
      this.#entries.shift();
    }
  }

  /**
   * Normalise a Playwright headers object to a plain `Record<string, string>`.
   * Playwright can return either `Record<string,string>` (headers()) or an array
   * of `{ name, value }` pairs (allHeaders()).  Handle both.
   * @param {Record<string,string> | Array<{name:string;value:string}>} raw
   * @returns {Record<string, string>}
   */
  /**
   * Returns true for content-types whose body should be captured as text.
   * Binary types (images, fonts, video, audio, wasm, zip, …) are excluded.
   * @param {string} contentType
   * @returns {boolean}
   */
  #isTextContentType(contentType) {
    const ct = contentType.split(';')[0].trim().toLowerCase();
    return (
      ct.startsWith('text/') ||
      ct === 'application/json' ||
      ct === 'application/ld+json' ||
      ct === 'application/xml' ||
      ct === 'application/xhtml+xml' ||
      ct === 'application/javascript' ||
      ct === 'application/x-www-form-urlencoded' ||
      ct.endsWith('+json') ||
      ct.endsWith('+xml')
    );
  }

  #extractHeaders(raw) {
    if (Array.isArray(raw)) {
      /** @type {Record<string,string>} */
      const out = {};
      for (const { name, value } of raw) out[name.toLowerCase()] = value;
      return out;
    }
    /** @type {Record<string,string>} */
    const out = {};
    for (const [k, v] of Object.entries(raw)) out[k.toLowerCase()] = v;
    return out;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Query the recorded network entries with optional filters and pagination.
   *
   * @param {NetworkQueryOptions} [opts]
   * @returns {NetworkQueryResult}
   */
  query({
    limit          = 100,
    afterId,
    resourceType,
    urlPattern,
    methodFilter,
    includeHeaders = false,
    includeBody    = false,
    statusMin,
    statusMax,
    onlyFailed,
    minDurationMs,
    maxDurationMs,
    bodyKeyword,
    headerKeyword,
    bodyMaxBytes,
  } = {}) {
    const resourceTypeSet = resourceType?.length
      ? new Set(resourceType.map(t => t.toLowerCase()))
      : null;

    const methodSet = methodFilter?.length
      ? new Set(methodFilter.map(m => m.toUpperCase()))
      : null;

    let filtered = this.#entries;

    if (afterId !== undefined) {
      filtered = filtered.filter(e => e.id > afterId);
    }
    if (resourceTypeSet) {
      filtered = filtered.filter(e => resourceTypeSet.has(e.resourceType.toLowerCase()));
    }
    if (urlPattern) {
      filtered = filtered.filter(e => e.url.includes(urlPattern));
    }
    if (methodSet) {
      filtered = filtered.filter(e => methodSet.has(e.method.toUpperCase()));
    }
    if (statusMin !== undefined) {
      filtered = filtered.filter(e => e.status !== null && e.status >= statusMin);
    }
    if (statusMax !== undefined) {
      filtered = filtered.filter(e => e.status !== null && e.status <= statusMax);
    }
    if (onlyFailed) {
      filtered = filtered.filter(e => e.failed);
    }
    if (minDurationMs !== undefined) {
      filtered = filtered.filter(e => e.duration !== null && e.duration >= minDurationMs);
    }
    if (maxDurationMs !== undefined) {
      filtered = filtered.filter(e => e.duration !== null && e.duration <= maxDurationMs);
    }
    if (bodyKeyword) {
      const kw = bodyKeyword.toLowerCase();
      filtered = filtered.filter(e =>
        (e.requestBody  !== null && e.requestBody.toLowerCase().includes(kw)) ||
        (e.responseBody !== null && e.responseBody.toLowerCase().includes(kw)),
      );
    }
    if (headerKeyword) {
      const kw = headerKeyword.toLowerCase();
      /** @param {Record<string,string>|null} headers */
      const matchesHeaders = (headers) => {
        if (!headers) return false;
        for (const [name, value] of Object.entries(headers)) {
          if (name.toLowerCase().includes(kw) || value.toLowerCase().includes(kw)) return true;
        }
        return false;
      };
      filtered = filtered.filter(e =>
        matchesHeaders(e.requestHeaders) || matchesHeaders(e.responseHeaders),
      );
    }

    const totalCount     = filtered.length;
    const effectiveLimit = limit === 0 ? filtered.length : limit;
    const hasMore        = filtered.length > effectiveLimit;
    // Return the most recent effectiveLimit entries (tail of the ascending-id list).
    const slice      = filtered.slice(-effectiveLimit);

    /**
     * Map a stored entry to the shape returned to the caller, stripping or
     * truncating headers/bodies according to the query options.
     * @param {NetworkEntry} e
     * @returns {NetworkEntry}
     */
    const mapEntry = (e) => {
      let requestBody           = includeBody ? e.requestBody  : null;
      let responseBody          = includeBody ? e.responseBody : null;
      let responseBodyTruncated = e.responseBodyTruncated;

      if (includeBody && bodyMaxBytes !== undefined) {
        if (requestBody  && requestBody.length  > bodyMaxBytes) {
          requestBody = requestBody.slice(0, bodyMaxBytes);
        }
        if (responseBody && responseBody.length > bodyMaxBytes) {
          responseBody          = responseBody.slice(0, bodyMaxBytes);
          responseBodyTruncated = true;
        }
      }

      return {
        ...e,
        requestHeaders:       includeHeaders ? e.requestHeaders  : null,
        responseHeaders:      includeHeaders ? e.responseHeaders : null,
        requestBody,
        responseBody,
        responseBodyTruncated,
      };
    };

    return { entries: slice.map(mapEntry), totalCount, hasMore };
  }

  /**
   * Clear all recorded entries and discard in-flight request tracking.
   * Useful after a page reload or navigation to start fresh.
   */
  clear() {
    this.#entries = [];
    this.#pending.clear();
  }

  /**
   * Remove all Playwright event listeners and clear state.
   * Must be called when the associated page closes to prevent memory leaks.
   */
  stop() {
    this.#page.off('request',       this.#onRequest);
    this.#page.off('response',      this.#onResponse);
    this.#page.off('requestfailed', this.#onRequestFailed);
    this.#entries = [];
    this.#pending.clear();
  }
}
