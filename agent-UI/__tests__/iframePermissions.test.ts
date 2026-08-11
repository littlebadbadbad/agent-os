/**
 * Tests for agent-UI/slots/iframePermissions.ts
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_IFRAME_PERMISSIONS,
  buildIframePermissions,
  getSlotPermissions,
} from "../slots/iframePermissions";
import type { AppSlotDeclaration, SlotDeclaration } from "@agent-type";

describe("buildIframePermissions", () => {
  it("grants the default permissions (pointer lock + fullscreen)", () => {
    const parts = buildIframePermissions(DEFAULT_IFRAME_PERMISSIONS);
    expect(parts.sandboxTokens).toEqual(["allow-pointer-lock"]);
    expect(parts.allowPolicy).toBe("pointer-lock; fullscreen");
    expect(parts.attributes).toEqual(["allowfullscreen"]);
  });

  it("translates custom permission names into the right configuration", () => {
    const parts = buildIframePermissions(["pointer-lock", "clipboard-read", "camera"]);
    expect(parts.sandboxTokens).toEqual(["allow-pointer-lock"]);
    expect(parts.allowPolicy).toBe("pointer-lock; clipboard-read; camera");
    expect(parts.attributes).toEqual([]);
  });

  it("deduplicates repeated names", () => {
    const parts = buildIframePermissions(["pointer-lock", "pointer-lock"]);
    expect(parts.sandboxTokens).toEqual(["allow-pointer-lock"]);
    expect(parts.allowPolicy).toBe("pointer-lock");
  });

  it("returns empty parts when no permissions are granted", () => {
    expect(buildIframePermissions([])).toEqual({
      sandboxTokens: [],
      allowPolicy: "",
      attributes: [],
    });
  });
});

describe("getSlotPermissions", () => {
  it("returns the permissions declared by an iframe slot", () => {
    const decl: AppSlotDeclaration = { type: "panel", permissions: ["pointer-lock"] };
    expect(getSlotPermissions(decl)).toEqual(["pointer-lock"]);
  });

  it("returns undefined for an iframe slot with no declared permissions", () => {
    const decl: AppSlotDeclaration = { type: "app", icon: "🌐", label: "Browser" };
    expect(getSlotPermissions(decl)).toBeUndefined();
  });

  it("returns undefined for non-iframe slots", () => {
    const decl: AppSlotDeclaration = {
      type: "autocomplete",
      shouldTrigger: () => false,
      getItems: () => [],
    };
    expect(getSlotPermissions(decl)).toBeUndefined();
  });

  it("returns undefined when there is no declaration", () => {
    expect(getSlotPermissions(undefined)).toBeUndefined();
  });
});
