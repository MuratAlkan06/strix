import { describe, expect, it } from "vitest";

import {
  ANALYTICS_CONSENT_KEY,
  parseConsent,
  readAnalyticsConsent,
  type StorageLike,
} from "./consent";

/** In-memory Storage fake satisfying the read/write surface the store uses. */
function fakeStorage(seed: Record<string, string> = {}): StorageLike & {
  map: Map<string, string>;
} {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

describe("analytics consent key", () => {
  it("is a fixed device-global key (no per-user suffix)", () => {
    expect(ANALYTICS_CONSENT_KEY).toBe("strix.consent.analytics");
  });

  it("lives OUTSIDE the strix.install. purge prefix, so it survives sign-out", () => {
    // src/lib/sw/purge.ts sweeps only `strix.install.*`; the consent choice must
    // NOT match it (issue #11 AC A5 — the choice persists across the sign-out
    // purge on a shared device).
    expect(ANALYTICS_CONSENT_KEY.startsWith("strix.install.")).toBe(false);
  });
});

describe("parseConsent", () => {
  it("passes through the two valid choices", () => {
    expect(parseConsent("granted")).toBe("granted");
    expect(parseConsent("denied")).toBe("denied");
  });

  it("treats missing / corrupt / legacy values as pending (null)", () => {
    expect(parseConsent(null)).toBeNull();
    expect(parseConsent("")).toBeNull();
    expect(parseConsent("GRANTED")).toBeNull();
    expect(parseConsent("true")).toBeNull();
    expect(parseConsent("yes")).toBeNull();
  });
});

describe("readAnalyticsConsent", () => {
  it("reads a persisted choice", () => {
    const store = fakeStorage({ [ANALYTICS_CONSENT_KEY]: "granted" });
    expect(readAnalyticsConsent(store)).toBe("granted");
  });

  it("returns null when the key is absent (pending — analytics stays off)", () => {
    expect(readAnalyticsConsent(fakeStorage())).toBeNull();
  });

  it("returns null for a corrupt stored value", () => {
    const store = fakeStorage({ [ANALYTICS_CONSENT_KEY]: "sure-why-not" });
    expect(readAnalyticsConsent(store)).toBeNull();
  });

  it("returns null when no storage is available (private-mode / SSR)", () => {
    expect(readAnalyticsConsent(undefined)).toBeNull();
  });

  it("returns null when the storage throws on read", () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(readAnalyticsConsent(throwing)).toBeNull();
  });
});
