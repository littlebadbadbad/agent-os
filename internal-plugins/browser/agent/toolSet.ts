import { type ToolSet, type ToolSetContext, type CompactToolCardDescriptor, type ToolCallInfo, type PluginSlotDeclaration } from "@agent-type";
import type { BrowserAdapter } from "./types";
import { createBrowserTools } from "./tools";

export const BROWSER_SYMBOL = Symbol("browser");

// ── Compact tool-card descriptor helpers ──────────────────────────────────────

function argStr(args: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = args?.[key];
  return typeof v === "string" ? v : undefined;
}

function resObj(value: unknown): object | undefined {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return undefined;
}

function resStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

const COMPACT_LABEL: Record<string, string> = {
  browser_list:          "List",
  browser_launch:        "Launch",
  browser_close:         "Close",
  browser_navigate:      "Navigate",
  browser_run:           "Run",
  browser_read:          "Read",
  browser_snapshot:      "Snapshot",
  browser_screenshot:    "Screenshot",
  browser_wait:          "Wait",
  browser_configure:     "Configure",
  browser_switch_tab:    "Switch Tab",
  browser_network:       "Network",
  browser_clear_network: "Clear Net",
};

function browserDescriptor(info: ToolCallInfo): CompactToolCardDescriptor {
  const { name, arguments: args, status, result, error } = info;

  const icon = "🌐";
  const label = COMPACT_LABEL[name] ?? name;

  // Error takes priority.
  if (status === "error" && error) {
    const short = error.split("\n")[0];
    const summary = short.length > 60 ? `${short.slice(0, 60)}…` : short;
    return { icon, label, summary, status: "error" };
  }

  let summary = label;

  switch (name) {
    case "browser_launch": {
      const lbl = argStr(args, "label");
      const startUrl = argStr(args, "startUrl");
      const ro = resObj(result);
      const id = ro ? resStr(ro["id"]) : null;
      if (status === "running") { summary = lbl ? `launching "${lbl}"…` : "launching…"; break; }
      summary = [lbl ?? startUrl, id ? `#${id.slice(0, 8)}` : null].filter(Boolean).join(" ");
      break;
    }
    case "browser_navigate": {
      const url = argStr(args, "url") ?? "";
      if (status === "running") { summary = `${url} …`; break; }
      const ro = resObj(result);
      const title = ro ? resStr(ro["title"]) : null;
      summary = title ? `${title} — ${url}` : url;
      break;
    }
    case "browser_run": {
      const script = argStr(args, "script") ?? "";
      const short = script.split("\n")[0].trim();
      summary = short.length > 50 ? `${short.slice(0, 50)}…` : short || "run script";
      break;
    }
    case "browser_snapshot": {
      if (status === "running") { summary = "capturing snapshot…"; break; }
      const ro = resObj(result);
      const title = ro ? resStr(ro["title"]) : null;
      summary = title ?? "snapshot done";
      break;
    }
    case "browser_screenshot": {
      summary = status === "running" ? "capturing screenshot…" : "screenshot captured";
      break;
    }
    case "browser_wait": {
      const selector = argStr(args, "selector");
      const waitUntil = argStr(args, "waitUntil");
      summary = [selector, waitUntil].filter(Boolean).join(" · ");
      break;
    }
    case "browser_switch_tab": {
      const idx = args?.["index"];
      summary = idx != null ? `tab #${idx}` : "switch tab";
      break;
    }
    case "browser_configure": {
      summary = "launch config";
      break;
    }
    case "browser_read": {
      if (status === "running") { summary = "reading output…"; break; }
      const ro = resObj(result);
      const output = ro ? resStr(ro["output"]) : resStr(result);
      if (!output) { summary = "read output"; break; }
      const firstLine = output.split("\n")[0];
      summary = firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
      break;
    }
  }

  return { icon, label, summary, status };
}

export function createBrowserToolSet(adapter: BrowserAdapter): ToolSet {
  const { tools, getSystemPrompt } = createBrowserTools(adapter);
  return {
    symbol: BROWSER_SYMBOL,
    name: "browser",
    coreTools: [
      "browser_launch",
      "browser_navigate",
      "browser_run",
      "browser_snapshot",
    ],
    tools,
    onGetSystemPrompt: getSystemPrompt,
    onGetSymbolState: (_ctx: ToolSetContext) => ({
      browserAdapter: adapter,
    }),
  };
}

export function getBrowserSlotDeclarations(
  toolNames: readonly string[],
): readonly PluginSlotDeclaration[] {
  return [
    {
      type: "app",
      icon: "\uD83C\uDF10",
      label: "Browser",
      defaultWidth: 1100,
      defaultHeight: 750,
      resizable: true,
      minimizable: true,
    },
    {
      type: "compactToolCard",
      toolNames,
      getDescriptor: browserDescriptor,
    },
    {
      type: "toolCard",
      toolNames,
    },
  ] satisfies readonly PluginSlotDeclaration[];
}
