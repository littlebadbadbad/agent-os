/**
 * agent-UI/styles/cssVariables.ts — Central CSS variable definitions
 *
 * Single source of truth for ALL CSS custom properties used by the UI layer
 * and apps.  Two tiers are provided:
 *
 *   **Unprefixed** (internal)  – consumed by SCSS modules inside the UI
 *     layer and by first-party apps (e.g. `var(--bg-primary)`).
 *
 *   **Prefixed**   (external)  – emitted at runtime on `:root` so that
 *     third-party app iframes can consume the same design tokens via a
 *     namespaced name (e.g. `var(--agent-sdk-bg-primary)`).
 *
 * The prefix is controlled by `VITE_CSS_PREFIX` (default `agent-sdk-`).
 * When the prefix is an empty string the two tiers are identical.
 */

// ── Variable catalogue ────────────────────────────────────────────────────────
// Keys are the variable name *without* leading `--`.
// Values are the canonical dark-theme (VSCode-inspired) palette used by the
// sidebar.  NEVER add a value here that differs from `global.scss` — this file
// IS the source of truth.

export const CSS_VARS = {
  // ── Background layers ──────────────────────────────────────────────────────
  'bg-primary':   '#1e1e1e',
  'bg-secondary': '#252526',
  'bg-tertiary':  '#2d2d30',
  'bg-elevated':  '#383838',
  'bg-hover':     '#2d3340',
  'bg-active':    '#1f4068',

  // ── Borders ────────────────────────────────────────────────────────────────
  'border':        '#3e3e42',
  'border-subtle': '#21262d',

  // ── Text ───────────────────────────────────────────────────────────────────
  'text-primary':   '#cccccc',
  'text-secondary': '#858585',
  'text-muted':     '#6e7681',
  'text-inverse':   '#ffffff',

  // ── Accent / primary ───────────────────────────────────────────────────────
  'primary':       '#0078d4',
  'primary-dark':  '#005fa3',
  'primary-deep':  '#003a6e',
  'primary-light': '#58a6ff',

  // ── Semantic colour ────────────────────────────────────────────────────────
  'blue':           '#0078d4',
  'blue-hover':     '#106ebe',
  'blue-light':     '#58a6ff',
  'blue-subtle':    '#182535',

  'green':          '#3fb950',
  'green-subtle':   '#12261e',
  'green-light':    '#56d364',

  'red':            '#f85149',
  'red-subtle':     '#2d1117',
  'red-light':      '#ff7b72',

  'yellow':         '#d29922',
  'yellow-subtle':  '#272115',
  'yellow-light':   '#e3b341',

  'orange':         '#db6d28',
  'purple':         '#bc8cff',
  'purple-subtle':  '#1e1637',

  // ── Spacing ────────────────────────────────────────────────────────────────
  'sp-1': '4px',
  'sp-2': '8px',
  'sp-3': '12px',
  'sp-4': '16px',
  'sp-5': '20px',
  'sp-6': '24px',
  'sp-8': '32px',

  // ── Border radius ──────────────────────────────────────────────────────────
  'radius-sm':    '4px',
  'radius-md':    '6px',
  'radius-lg':    '10px',
  'radius-full':  '9999px',

  // ── Typography ─────────────────────────────────────────────────────────────
  'font-xs':   '11px',
  'font-sm':   '12px',
  'font-base': '13px',
  'font-md':   '14px',
  'font-lg':   '16px',
  'font-xl':   '20px',
  'font-2xl':  '24px',

  // ── Layout ─────────────────────────────────────────────────────────────────
  'sidebar-width':  '236px',
  'header-height':  '48px',

  // ── Shadow ─────────────────────────────────────────────────────────────────
  'shadow-sm': '0 1px 3px rgba(0,0,0,0.4)',
  'shadow-md': '0 4px 12px rgba(0,0,0,0.5)',
  'shadow-lg': '0 8px 32px rgba(0,0,0,0.6)',
} as const satisfies Record<string, string>;

/** All unprefixed variable names (e.g. `"bg-primary"`). */
export type CssVarName = keyof typeof CSS_VARS;

// ── Prefix ────────────────────────────────────────────────────────────────────

/**
 * Read the CSS variable prefix from `VITE_CSS_PREFIX`.
 * Falls back to `"agent-sdk-"` when the env var is not set.
 * The trailing `-` is part of the prefix value so that variable names read
 * naturally: `--agent-sdk-bg-primary`.
 */
export function getCssPrefix(): string {
  return (import.meta.env as { VITE_CSS_PREFIX?: string }).VITE_CSS_PREFIX ?? 'agent-sdk-';
}

/**
 * Return the **prefixed** CSS custom property name for a given variable.
 *
 * ```ts
 * prefixedName('bg-primary') // → '--agent-sdk-bg-primary'
 * ```
 * When the prefix is empty, returns the unprefixed name (`--bg-primary`).
 */
export function prefixedName(name: CssVarName): string {
  const prefix = getCssPrefix();
  return `--${prefix}${name}`;
}

/**
 * Return a `var()` expression referencing the prefixed variable.
 *
 * ```ts
 * cssVar('bg-primary') // → 'var(--agent-sdk-bg-primary)'
 * ```
 */
export function cssVar(name: CssVarName): string {
  return `var(${prefixedName(name)})`;
}

// ── Host :root injection ──────────────────────────────────────────────────────

let hostInjected = false;

/**
 * Inject **prefixed** CSS custom properties into the host `:root`.
 *
 * Call this once during app initialisation (e.g. inside `AgentWidget`).
 * After this call, both unprefixed (defined statically in `global.scss`)
 * **and** prefixed variables are available on `:root`.
 *
 * When the prefix is empty this is a no-op (the unprefixed vars in
 * `global.scss` ARE the external API).
 *
 * Safe to call multiple times — repeated calls are no-ops.
 */
export function injectHostCssVars(): void {
  if (hostInjected) return;
  const prefix = getCssPrefix();
  if (!prefix) {
    hostInjected = true;
    return;
  }
  const root = document.documentElement;
  for (const [name, value] of Object.entries(CSS_VARS)) {
    root.style.setProperty(`--${prefix}${name}`, value);
  }
  hostInjected = true;
}

// ── Iframe injection ──────────────────────────────────────────────────────────

/**
 * Build a CSS declaration block suitable for injection into a app iframe.
 *
 * Returns both unprefixed **and** prefixed declarations so that:
 * - First-party (internal) apps can use `var(--bg-primary)`
 * - Third-party (external) apps can use `var(--agent-sdk-bg-primary)`
 *
 * When the prefix is empty, only unprefixed names are emitted (they ARE the
 * external API in that case).
 */
export function buildIframeCssVars(): string {
  const prefix = getCssPrefix();
  const declarations: string[] = [];

  // Unprefixed (for internal apps)
  for (const [name, value] of Object.entries(CSS_VARS)) {
    declarations.push(`--${name}:${value}`);
  }

  // Prefixed (for external / third-party apps)
  if (prefix) {
    for (const [name, value] of Object.entries(CSS_VARS)) {
      declarations.push(`--${prefix}${name}:${value}`);
    }
  }

  return declarations.join(';');
}

/**
 * Inject both unprefixed and prefixed CSS custom properties into an iframe's
 * document root so that all `var(--*)` references inside the iframe resolve.
 *
 * CSS custom properties do **not** cross iframe boundaries, even with
 * `allow-same-origin`.  Every app iframe must have these injected before
 * its styles are applied.
 */
export function injectIframeCssVars(iframe: HTMLIFrameElement): void {
  const iframeDoc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!iframeDoc?.head) return;

  const declarations = buildIframeCssVars();
  if (!declarations) return;

  const styleEl = iframeDoc.createElement('style');
  styleEl.textContent = `:root{${declarations}}`;
  iframeDoc.head.appendChild(styleEl);
}
