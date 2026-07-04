/**
 * Terminal routes — PURE PROTOCOL LAYER.
 *
 * Only: extract params → call service → send result.
 * Transport-specific: SSE stream endpoint keeps res.write() wiring.
 */

import { readBody, send } from "../../lib/http.js";
import { createLogger } from "../../lib/logger.js";
import * as terminalService from "../../services/terminals.js";

const log = createLogger("terminals");

export async function handleTerminalRoutes(req, res, path) {
  // GET /api/terminals/shells — list available shells
  if (req.method === "GET" && path === "/api/terminals/shells") {
    return send(res, 200, { shells: terminalService.availableShells() });
  }

  // POST /api/terminals — create
  if (req.method === "POST" && path === "/api/terminals") {
    const body = await readBody(req);
    return send(res, 201, terminalService.createTerminalSession({
      label: body.label,
      shell: body.shell,
      cwd: body.cwd,
    }));
  }

  // GET /api/terminals — list
  if (req.method === "GET" && path === "/api/terminals") {
    return send(res, 200, terminalService.listTerminals());
  }

  // GET /api/terminals/:id/stream — SSE (transport-specific)
  if (req.method === "GET" && path.startsWith("/api/terminals/") && path.endsWith("/stream")) {
    const id = decodeURIComponent(path.slice("/api/terminals/".length, -"/stream".length));

    // Existence check + initial state via service (not direct getTerminal call).
    let initialState;
    try {
      initialState = terminalService.readTerminalOutput({ id, fromOffset: 0 });
    } catch {
      return send(res, 404, { error: `Terminal "${id}" not found` });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 1000\n\n");

    const { output: history, running, exitCode } = initialState;
    if (history) {
      res.write(`event: output\ndata: ${JSON.stringify({ output: history })}\n\n`);
    }
    if (!running) {
      res.write(`event: done\ndata: ${JSON.stringify({ exitCode })}\n\n`);
      res.end();
      return;
    }

    const ctrl = new AbortController();
    terminalService.subscribeTerminalOutput({
      id,
      signal: ctrl.signal,
      onOutput: (text) => res.write(`event: output\ndata: ${JSON.stringify({ output: text })}\n\n`),
      onDone: (code) => {
        res.write(`event: done\ndata: ${JSON.stringify({ exitCode: code })}\n\n`);
        res.end();
      },
    });

    req.on("close", () => ctrl.abort());
    return;
  }

  // GET /api/terminals/:id/output — buffered read
  if (req.method === "GET" && path.startsWith("/api/terminals/") && path.endsWith("/output")) {
    const id = decodeURIComponent(path.slice("/api/terminals/".length, -"/output".length));
    const url = new URL(req.url, "http://localhost");
    const fromOffset = parseInt(url.searchParams.get("offset") ?? "0", 10);
    return send(res, 200, terminalService.readTerminalOutput({ id, fromOffset }));
  }

  // POST /api/terminals/:id/resize — PTY resize
  if (req.method === "POST" && path.startsWith("/api/terminals/") && path.endsWith("/resize")) {
    const id = decodeURIComponent(path.slice("/api/terminals/".length, -"/resize".length));
    const body = await readBody(req);
    const cols = Number(body.cols);
    const rows = Number(body.rows);
    return send(res, 200, terminalService.resizeTerminalSession({ id, cols, rows }));
  }

  // POST /api/terminals/:id/input — stdin write
  if (req.method === "POST" && path.startsWith("/api/terminals/") && path.endsWith("/input")) {
    const id = decodeURIComponent(path.slice("/api/terminals/".length, -"/input".length));
    const body = await readBody(req);
    return send(res, 200, terminalService.sendTerminalInput({ id, text: body.input }));
  }

  // DELETE /api/terminals/:id — kill + remove
  if (req.method === "DELETE" && path.startsWith("/api/terminals/")) {
    const id = decodeURIComponent(path.slice("/api/terminals/".length));
    return send(res, 200, terminalService.removeTerminalSession({ id }));
  }

  return false;
}
