import { describe, expect, it } from "vitest";

import {
  isInstallEligible,
  isIosUserAgent,
  resolveInstallVariant,
} from "./install-platform";

describe("resolveInstallVariant", () => {
  it("renders nothing when already standalone, whatever else is true", () => {
    expect(
      resolveInstallVariant({
        isStandalone: true,
        hasInstallPrompt: true,
        isIos: true,
      }),
    ).toBe("none");
  });

  it("prefers the native chrome flow when a prompt was captured", () => {
    expect(
      resolveInstallVariant({
        isStandalone: false,
        hasInstallPrompt: true,
        isIos: false,
      }),
    ).toBe("chrome");
  });

  it("shows iOS instructions on iOS with no captured prompt", () => {
    expect(
      resolveInstallVariant({
        isStandalone: false,
        hasInstallPrompt: false,
        isIos: true,
      }),
    ).toBe("ios");
  });

  it("shows nothing on a desktop browser with no prompt and no iOS", () => {
    expect(
      resolveInstallVariant({
        isStandalone: false,
        hasInstallPrompt: false,
        isIos: false,
      }),
    ).toBe("none");
  });

  it("does not show iOS instructions once a prompt exists (chrome wins)", () => {
    // A device reporting both (shouldn't happen, but be total): the actionable
    // native prompt is the better path.
    expect(
      resolveInstallVariant({
        isStandalone: false,
        hasInstallPrompt: true,
        isIos: true,
      }),
    ).toBe("chrome");
  });
});

describe("isInstallEligible", () => {
  it("requires BOTH an active goal AND >= 3 sessions", () => {
    expect(isInstallEligible(true, 3)).toBe(true);
    expect(isInstallEligible(true, 4)).toBe(true);
  });

  it("is false without an active goal", () => {
    expect(isInstallEligible(false, 10)).toBe(false);
  });

  it("is false below the 3-session floor", () => {
    expect(isInstallEligible(true, 0)).toBe(false);
    expect(isInstallEligible(true, 1)).toBe(false);
    expect(isInstallEligible(true, 2)).toBe(false);
  });

  it("is false while the session count is still unknown (null)", () => {
    // null === "not yet read from storage" — the gate stays shut until known.
    expect(isInstallEligible(true, null)).toBe(false);
  });
});

describe("isIosUserAgent", () => {
  it("matches iPhone / iPad / iPod UAs", () => {
    expect(
      isIosUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      ),
    ).toBe(true);
    expect(isIosUserAgent("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe(
      true,
    );
    expect(isIosUserAgent("something iPod touch")).toBe(true);
  });

  it("does not match Android or desktop UAs", () => {
    expect(
      isIosUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120",
      ),
    ).toBe(false);
    expect(
      isIosUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"),
    ).toBe(false);
  });
});
