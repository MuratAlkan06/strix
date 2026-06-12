/**
 * runtime-caching.test.ts — pins the service worker's caching contract
 * (phase 2.5, S4): which rule claims which request, in which named cache,
 * with which strategy. The table below classifies representative requests
 * through the REAL rule table (first matcher wins, exactly like Serwist's
 * router), so a rule-order regression or a matcher loosened to swallow
 * /api/ai/* fails here — the "AI responses are never cached or replayed"
 * guarantee is the load-bearing row.
 */
import { describe, expect, it } from "vitest";
import { CacheFirst, NetworkOnly, StaleWhileRevalidate } from "serwist";

import {
  STRIX_CACHE_PREFIX,
  deleteStaleStrixCaches,
  getRuntimeCaching,
  strixCacheNames,
  type StrixRuleId,
  type StrixRuntimeCaching,
} from "./runtime-caching";

const ORIGIN = "https://strix.example";
const BUILD_ID = "build123";

/**
 * Classify a request through the rule table the way the SW router does:
 * first matcher to return truthy wins. `destination` mimics
 * Request.destination (undici Requests always report "", so the fetch-event
 * request surface is faked with exactly the fields the matchers read).
 */
function classify(
  rawUrl: string,
  destination: RequestDestination = "",
): StrixRuntimeCaching | null {
  const url = new URL(rawUrl, ORIGIN);
  const sameOrigin = url.origin === ORIGIN;
  const request = { url: url.href, destination } as Request;
  const rules = getRuntimeCaching(BUILD_ID);
  return (
    rules.find((rule) =>
      (rule.matcher as (opts: unknown) => boolean)({
        url,
        request,
        sameOrigin,
        event: undefined,
      }),
    ) ?? null
  );
}

describe("getRuntimeCaching classification", () => {
  const names = strixCacheNames(BUILD_ID);

  const TABLE: Array<{
    name: string;
    url: string;
    destination?: RequestDestination;
    expected: StrixRuleId | null;
  }> = [
    // -- AI endpoints: never cached, never replayed (own rule, above /api/*) --
    { name: "AI plan endpoint", url: "/api/ai/plan", expected: "ai-never-cached" },
    { name: "AI intake endpoint", url: "/api/ai/intake", expected: "ai-never-cached" },
    { name: "AI replan endpoint", url: "/api/ai/replan", expected: "ai-never-cached" },
    // -- everything else under /api: network only, nothing stored --
    { name: "goals API", url: "/api/me/goals", expected: "api-network-only" },
    { name: "webhook API", url: "/api/webhooks/clerk", expected: "api-network-only" },
    // -- dashboard HTML + RSC payloads: SWR in the named dashboard cache --
    {
      name: "dashboard HTML navigation",
      url: "/dashboard",
      destination: "document",
      expected: "dashboard-swr",
    },
    {
      name: "dashboard RSC payload",
      url: "/dashboard?_rsc=1a2b3",
      expected: "dashboard-swr",
    },
    // -- app shell: CacheFirst in the versioned shell cache --
    {
      name: "JS chunk",
      url: "/_next/static/chunks/main-app-abc123.js",
      destination: "script",
      expected: "app-shell-cache-first",
    },
    {
      name: "CSS chunk",
      url: "/_next/static/css/app-abc123.css",
      destination: "style",
      expected: "app-shell-cache-first",
    },
    {
      name: "next/font asset",
      url: "/_next/static/media/fraunces-abc123.woff2",
      destination: "font",
      expected: "app-shell-cache-first",
    },
    { name: "PWA icon", url: "/icons/icon-192.png", expected: "app-shell-cache-first" },
    { name: "manifest", url: "/manifest.webmanifest", expected: "app-shell-cache-first" },
    {
      name: "same-origin font outside /_next",
      url: "/some/other/font.woff2",
      destination: "font",
      expected: "app-shell-cache-first",
    },
    // -- everything else: no rule, network passthrough, nothing stored --
    { name: "goal detail page", url: "/goals/abc", expected: null },
    { name: "landing page", url: "/", expected: null },
    {
      name: "cross-origin script (Clerk CDN)",
      url: "https://clerk.example.com/npm/clerk.browser.js",
      destination: "script",
      expected: null,
    },
    {
      name: "cross-origin URL that merely looks like our AI API",
      url: "https://evil.example.com/api/ai/plan",
      expected: null,
    },
  ];

  for (const row of TABLE) {
    it(`${row.name} → ${row.expected ?? "no rule (passthrough)"}`, () => {
      expect(classify(row.url, row.destination)?.id ?? null).toBe(row.expected);
    });
  }

  it("orders the AI rule ABOVE the general API rule", () => {
    const ids = getRuntimeCaching(BUILD_ID).map((rule) => rule.id);
    expect(ids.indexOf("ai-never-cached")).toBeLessThan(
      ids.indexOf("api-network-only"),
    );
  });

  it("uses NetworkOnly (no storage) for both API rules", () => {
    const rules = getRuntimeCaching(BUILD_ID);
    for (const id of ["ai-never-cached", "api-network-only"] as const) {
      const rule = rules.find((r) => r.id === id);
      expect(rule?.handler).toBeInstanceOf(NetworkOnly);
    }
  });

  it("pins strategy + versioned cache name for the storing rules", () => {
    const rules = getRuntimeCaching(BUILD_ID);
    const dashboard = rules.find((r) => r.id === "dashboard-swr")?.handler;
    expect(dashboard).toBeInstanceOf(StaleWhileRevalidate);
    expect((dashboard as StaleWhileRevalidate).cacheName).toBe(names.dashboard);

    const shell = rules.find((r) => r.id === "app-shell-cache-first")?.handler;
    expect(shell).toBeInstanceOf(CacheFirst);
    expect((shell as CacheFirst).cacheName).toBe(names.shell);
  });
});

describe("strixCacheNames", () => {
  it("embeds the build ID in every cache name (versioning contract)", () => {
    expect(strixCacheNames("abc")).toEqual({
      shell: "strix-shell-abc",
      dashboard: "strix-dashboard-abc",
    });
  });

  it("keeps the strix- prefix S7's purge enumerates", () => {
    for (const name of Object.values(strixCacheNames("abc"))) {
      expect(name.startsWith(STRIX_CACHE_PREFIX)).toBe(true);
    }
  });
});

describe("deleteStaleStrixCaches", () => {
  it("deletes strix-* caches from other builds, keeps current + foreign caches", async () => {
    const existing = [
      "strix-shell-oldbuild",
      "strix-dashboard-oldbuild",
      `strix-shell-${BUILD_ID}`,
      `strix-dashboard-${BUILD_ID}`,
      "serwist-precache-v2-https://strix.example/",
      "unrelated-cache",
    ];
    const deleted: string[] = [];
    await deleteStaleStrixCaches(
      {
        keys: async () => existing,
        delete: async (key: string) => {
          deleted.push(key);
          return true;
        },
      },
      BUILD_ID,
    );
    expect(deleted.sort()).toEqual([
      "strix-dashboard-oldbuild",
      "strix-shell-oldbuild",
    ]);
  });
});
