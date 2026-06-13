import { describe, expect, it } from "vitest";

import {
  dismissedKey,
  installBannerStorageKeys,
  recordSession,
  sessionCountKey,
  sessionCountedFlagKey,
  type StorageLike,
} from "./use-local-storage";

/** In-memory Storage fake satisfying the read/write surface recordSession uses. */
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

const USER = "user_abc";

describe("install-banner storage keys", () => {
  it("scopes every key to the Clerk user id", () => {
    expect(sessionCountKey(USER)).toBe("strix.install.sessions.user_abc");
    expect(dismissedKey(USER)).toBe("strix.install.dismissed.user_abc");
    expect(sessionCountedFlagKey(USER)).toBe("strix.install.counted.user_abc");
  });

  it("a different user gets a different namespace (no shared-device bleed)", () => {
    expect(sessionCountKey("a")).not.toBe(sessionCountKey("b"));
    expect(dismissedKey("a")).not.toBe(dismissedKey("b"));
  });

  it("installBannerStorageKeys lists exactly the DURABLE keys (not the session flag)", () => {
    const keys = installBannerStorageKeys(USER);
    expect(keys).toEqual([sessionCountKey(USER), dismissedKey(USER)]);
    expect(keys).not.toContain(sessionCountedFlagKey(USER));
  });

  it("every durable key falls under the strix.install. purge prefix", () => {
    for (const key of installBannerStorageKeys(USER)) {
      expect(key.startsWith("strix.install.")).toBe(true);
    }
  });
});

describe("recordSession", () => {
  it("counts a brand-new user once and flags the session", () => {
    const durable = fakeStorage();
    const session = fakeStorage();

    expect(recordSession(durable, session, USER)).toBe(1);
    expect(durable.map.get(sessionCountKey(USER))).toBe("1");
    expect(session.map.get(sessionCountedFlagKey(USER))).toBe("1");
  });

  it("does NOT re-count within the same session (flag already set)", () => {
    const durable = fakeStorage({ [sessionCountKey(USER)]: "1" });
    const session = fakeStorage({ [sessionCountedFlagKey(USER)]: "1" });

    expect(recordSession(durable, session, USER)).toBe(1);
    // unchanged
    expect(durable.map.get(sessionCountKey(USER))).toBe("1");
  });

  it("increments across a new session (flag cleared, count persisted)", () => {
    const durable = fakeStorage({ [sessionCountKey(USER)]: "2" });
    const session = fakeStorage(); // new session: no counted flag

    expect(recordSession(durable, session, USER)).toBe(3);
    expect(durable.map.get(sessionCountKey(USER))).toBe("3");
    expect(session.map.get(sessionCountedFlagKey(USER))).toBe("1");
  });

  it("treats a corrupt durable count as 0 and recovers to 1", () => {
    const durable = fakeStorage({ [sessionCountKey(USER)]: "not-a-number" });
    const session = fakeStorage();

    expect(recordSession(durable, session, USER)).toBe(1);
    expect(durable.map.get(sessionCountKey(USER))).toBe("1");
  });

  it("keeps two users' counts independent in the same storages", () => {
    const durable = fakeStorage();
    const session = fakeStorage();

    expect(recordSession(durable, session, "alice")).toBe(1);
    expect(recordSession(durable, session, "bob")).toBe(1);
    expect(durable.map.get(sessionCountKey("alice"))).toBe("1");
    expect(durable.map.get(sessionCountKey("bob"))).toBe("1");
  });
});
