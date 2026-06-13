import { describe, expect, it } from "vitest";

import {
  purgeClientCaches,
  type CacheStorageLike,
  type LocalStorageLike,
} from "./purge";

/** Recording fake matching the injectable surface (same pattern as the
 * deleteStaleStrixCaches tests in runtime-caching.test.ts). */
function fakeStorage(keys: string[]): {
  storage: CacheStorageLike;
  deleted: string[];
} {
  const deleted: string[] = [];
  return {
    storage: {
      keys: async () => keys,
      delete: async (key: string) => {
        deleted.push(key);
        return true;
      },
    },
    deleted,
  };
}

/** Index-addressable localStorage fake (length / key(i) / removeItem). */
function fakeLocalStorage(seed: Record<string, string>): {
  storage: LocalStorageLike;
  map: Map<string, string>;
} {
  const map = new Map(Object.entries(seed));
  return {
    map,
    storage: {
      get length() {
        return map.size;
      },
      key: (i: number) => [...map.keys()][i] ?? null,
      removeItem: (k: string) => {
        map.delete(k);
      },
    },
  };
}

describe("purgeClientCaches", () => {
  it("deletes every cache, regardless of name or prefix", async () => {
    // Full clear per the planning doc: strix-* runtime caches, the
    // Serwist-internal precache (outside the strix- prefix), and anything
    // else all go.
    const existing = [
      "strix-shell-build123",
      "strix-dashboard-build123",
      "serwist-precache-v2-https://strix.example/",
      "unrelated-cache",
    ];
    const { storage, deleted } = fakeStorage(existing);

    await purgeClientCaches(storage);

    expect(deleted.sort()).toEqual([...existing].sort());
  });

  it("resolves on empty storage without attempting deletions", async () => {
    const { storage, deleted } = fakeStorage([]);

    await expect(purgeClientCaches(storage)).resolves.toBeUndefined();
    expect(deleted).toEqual([]);
  });

  it("is a successful no-op when the Cache API is unavailable", async () => {
    // Insecure context / legacy browser: nothing was ever stored in Cache
    // Storage, so there is nothing to purge and sign-out must not break.
    await expect(purgeClientCaches(undefined)).resolves.toBeUndefined();
  });

  it("rejects when enumeration fails (caller decides — auth still wins)", async () => {
    const storage: CacheStorageLike = {
      keys: async () => {
        throw new Error("keys unavailable");
      },
      delete: async () => true,
    };

    await expect(purgeClientCaches(storage)).rejects.toThrow(
      "keys unavailable",
    );
  });

  it("rejects when any single deletion fails, after attempting all", async () => {
    const attempted: string[] = [];
    const storage: CacheStorageLike = {
      keys: async () => ["a", "b", "c"],
      delete: async (key: string) => {
        attempted.push(key);
        if (key === "b") throw new Error("delete failed: b");
        return true;
      },
    };

    await expect(purgeClientCaches(storage)).rejects.toThrow(
      "delete failed: b",
    );
    // Promise.all fires all deletions before settling — one bad cache does
    // not stop the others from being attempted.
    expect(attempted).toEqual(["a", "b", "c"]);
  });
});

describe("purgeClientCaches — install-banner localStorage sweep (S8)", () => {
  it("removes every strix.install.* key for any user, leaving others intact", async () => {
    const { storage: caches } = fakeStorage([]);
    const { storage: local, map } = fakeLocalStorage({
      "strix.install.sessions.user_a": "5",
      "strix.install.dismissed.user_a": "1",
      "strix.install.sessions.user_b": "2", // a different user on a shared device
      "theme": "dark", // unrelated key — must survive
    });

    await purgeClientCaches(caches, local);

    expect(map.has("strix.install.sessions.user_a")).toBe(false);
    expect(map.has("strix.install.dismissed.user_a")).toBe(false);
    expect(map.has("strix.install.sessions.user_b")).toBe(false);
    expect(map.get("theme")).toBe("dark");
  });

  it("clears localStorage even when the Cache API is unavailable", async () => {
    const { storage: local, map } = fakeLocalStorage({
      "strix.install.dismissed.u": "1",
    });

    await purgeClientCaches(undefined, local);

    expect(map.has("strix.install.dismissed.u")).toBe(false);
  });

  it("clears localStorage first, so a later cache rejection still leaves it cleared", async () => {
    const caches: CacheStorageLike = {
      keys: async () => {
        throw new Error("keys unavailable");
      },
      delete: async () => true,
    };
    const { storage: local, map } = fakeLocalStorage({
      "strix.install.sessions.u": "3",
    });

    await expect(purgeClientCaches(caches, local)).rejects.toThrow(
      "keys unavailable",
    );
    // The synchronous localStorage sweep ran before the cache enumeration.
    expect(map.has("strix.install.sessions.u")).toBe(false);
  });

  it("is a no-op with an empty or missing localStorage", async () => {
    const { storage: caches } = fakeStorage([]);
    await expect(
      purgeClientCaches(caches, undefined),
    ).resolves.toBeUndefined();
    const { storage: local } = fakeLocalStorage({});
    await expect(purgeClientCaches(caches, local)).resolves.toBeUndefined();
  });
});
