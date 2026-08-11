/**
 * agent-UI/slots/iframePermissions.ts — iframe permission translation
 *
 * Pure helpers that translate Permissions Policy feature names into the
 * concrete iframe configuration the browser requires:
 *
 *   - `allow` attribute  → the Permissions Policy itself,
 *   - sandbox token      → required by sandboxed iframes (e.g. `allow-pointer-lock`),
 *   - dedicated attribute → e.g. `allowfullscreen`.
 *
 * This is the single source of truth for how a slot's `permissions` field
 * becomes real iframe attributes — IframeSandbox just applies the result.
 */

import type { AppSlotDeclaration, SlotDeclaration } from "@agent-type";

/** Features that additionally require a sandbox token on sandboxed iframes. */
const SANDBOX_TOKENS: Readonly<Record<string, string>> = {
  "pointer-lock": "allow-pointer-lock",
};

/** Features that map to a dedicated boolean iframe attribute. */
const IFRAME_ATTRIBUTES: Readonly<Record<string, string>> = {
  fullscreen: "allowfullscreen",
};

/**
 * Permissions granted to every slot iframe unless the slot declaration
 * overrides them.  Pointer lock + fullscreen are what make content sites
 * (3D games, video, presentations) behave exactly like a real browser tab.
 */
export const DEFAULT_IFRAME_PERMISSIONS: readonly string[] = ["pointer-lock", "fullscreen"];

/** The three pieces of iframe configuration derived from a permission list. */
export interface IframePermissionParts {
  /** Sandbox tokens to add, e.g. `["allow-pointer-lock"]`. */
  readonly sandboxTokens: readonly string[];
  /** Value for the `allow` attribute, e.g. `"pointer-lock; fullscreen"`. */
  readonly allowPolicy: string;
  /** Boolean attributes to set, e.g. `["allowfullscreen"]`. */
  readonly attributes: readonly string[];
}

/**
 * Translate a list of Permissions Policy feature names into the iframe
 * configuration that grants them.
 *
 * @param permissions Feature names (see MDN "Permissions Policy").
 * @returns The sandbox tokens, `allow` policy, and boolean attributes to apply.
 */
export function buildIframePermissions(permissions: readonly string[]): IframePermissionParts {
  const names = new Set(permissions);
  const sandboxTokens: string[] = [];
  const attributes: string[] = [];
  for (const name of names) {
    const token = SANDBOX_TOKENS[name];
    if (token !== undefined) sandboxTokens.push(token);
    const attribute = IFRAME_ATTRIBUTES[name];
    if (attribute !== undefined) attributes.push(attribute);
  }
  return {
    sandboxTokens,
    allowPolicy: [...names].join("; "),
    attributes,
  };
}

/**
 * Extract the permissions declared by a slot declaration.
 *
 * Non-iframe slot declarations (compactToolCard, autocomplete) carry no
 * `permissions` field — returns `undefined` for them so the caller falls
 * back to {@link DEFAULT_IFRAME_PERMISSIONS}.
 */
export function getSlotPermissions(
  declaration: AppSlotDeclaration | undefined,
): readonly string[] | undefined {
  return declaration !== undefined && "permissions" in declaration
    ? declaration.permissions
    : undefined;
}
