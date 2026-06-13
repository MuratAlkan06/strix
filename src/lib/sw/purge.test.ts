import { describe, expect, it } from "vitest";

import { purgeClientCaches, type CacheStorageLike } from "./purge";

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
