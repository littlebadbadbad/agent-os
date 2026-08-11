/**
 * extensions/terminal/__tests__/backend/upgrade.test.js — Backend upgrade tests
 *
 * TODO: Restore full test coverage from backend/__tests__/upgrade.route.test.js.
 * The original tests used handleUpgradeRoutes directly; these need to be
 * rewritten to test via the BackendAppHost's defineApi registration.
 */

import { describe, it, expect } from "vitest";
import * as upgrade from "../../backend/services/upgrade.js";

describe("upgrade backend service", () => {
  it("exports getVersion", () => {
    expect(typeof upgrade.getVersion).toBe("function");
  });

  it("getVersion returns a string", () => {
    const v = upgrade.getVersion();
    expect(typeof v).toBe("string");
    expect(v.length).toBeGreaterThan(0);
  });
});
