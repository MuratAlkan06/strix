import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ANALYTICS_CONSENT_KEY } from "./consent";

/**
 * client.test.ts — the runtime consent-reconciliation path (issue #11 review).
 *
 * Focus: applyConsent() — the shared teardown/init core that BOTH a tab's own
 * choice (setAnalyticsConsent) and the banner container's cross-tab `storage`
 * effect route through. The M1 finding was that a sibling tab kept capturing +
 * re-persisting after another tab withdrew; the fix is that applyConsent("denied")
 * tears the live SDK down (opt out + scrub) whenever it runs, and the container
 * now calls it for BOTH directions. These tests exercise that reconciliation
 * directly (the two-tab behaviour reduces to applyConsent("denied") firing in
 * the sibling tab), plus the L2 live-consent gate on capture()/identify().
 *
 * vitest runs in `node` (no jsdom); we install minimal window/localStorage/
 * document fakes so the browser-only code paths are reachable. posthog-js is
 * mocked, so no real SDK/network is touched. Module state (`initialized`) is
 * reset per test via vi.resetModules() + a fresh dynamic import.
 */
const { mockPosthog } = vi.hoisted(() => ({
  mockPosthog: {
    init: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
  },
}));
vi.mock("posthog-js", () => ({ default: mockPosthog }));

const TOKEN = "phc_test_token";
const PH_COOKIE = `ph_${TOKEN}_posthog`;

/**
 * A localStorage fake whose STORED keys are own-enumerable props (so
 * Object.keys() sees them, exactly as real localStorage does) while getItem/
 * setItem/removeItem are non-enumerable methods (so they are NOT swept by the
 * `ph_`/`__ph_` scrub).
 */
function makeLocalStorage(seed: Record<string, string> = {}) {
  const ls: Record<string, string> & {
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
    removeItem(k: string): void;
  } = Object.create(null);
  Object.defineProperties(ls, {
    getItem: {
      value: (k: string) =>
        Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null,
    },
    setItem: {
      value: (k: string, v: string) => {
        ls[k] = String(v);
      },
    },
    removeItem: {
      value: (k: string) => {
        delete ls[k];
      },
    },
  });
  for (const [k, v] of Object.entries(seed)) ls[k] = v;
  return ls;
}

let cookieJar = "";

function installBrowserGlobals(store: ReturnType<typeof makeLocalStorage>) {
  cookieJar = "";
  const documentFake = {
    get cookie() {
      return cookieJar;
    },
    set cookie(v: string) {
      cookieJar = v;
    },
  };
  vi.stubGlobal("localStorage", store);
  vi.stubGlobal("window", { localStorage: store });
  vi.stubGlobal("document", documentFake);
}

/** Keys posthog itself writes; the scrub must remove all of them. */
function seedPostHogKeys(store: ReturnType<typeof makeLocalStorage>) {
  store.setItem(PH_COOKIE, JSON.stringify({ distinct_id: "abc" }));
  store.setItem(`__ph_opt_in_out_${TOKEN}`, "1");
  cookieJar = `${PH_COOKIE}=xyz`;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_POSTHOG_KEY = TOKEN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
});

describe("applyConsent — reconcile the live SDK to a value", () => {
  it("'granted' inits PostHog and opts in", async () => {
    installBrowserGlobals(makeLocalStorage({ [ANALYTICS_CONSENT_KEY]: "granted" }));
    const client = await import("./client");

    client.applyConsent("granted");

    expect(mockPosthog.init).toHaveBeenCalledWith(TOKEN, expect.any(Object));
    // Session replay stays off: consent copy discloses usage events only (PR #100 finding).
    expect(mockPosthog.init).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({ disable_session_recording: true }),
    );
    expect(mockPosthog.opt_in_capturing).toHaveBeenCalledWith({
      captureEventName: false,
    });
    expect(mockPosthog.opt_out_capturing).not.toHaveBeenCalled();
  });

  it("'denied' on an initialised SDK opts out and scrubs PostHog storage (cross-tab withdrawal — M1)", async () => {
    const store = makeLocalStorage({ [ANALYTICS_CONSENT_KEY]: "granted" });
    installBrowserGlobals(store);
    const client = await import("./client");

    // Sibling tab was capturing: init, then posthog wrote its own keys.
    client.applyConsent("granted");
    seedPostHogKeys(store);

    // Another tab withdrew → this tab's `storage` effect runs applyConsent("denied").
    store.setItem(ANALYTICS_CONSENT_KEY, "denied");
    client.applyConsent("denied");

    expect(mockPosthog.opt_out_capturing).toHaveBeenCalledTimes(1);
    // Every ph_/__ph_ key is gone; the consent key is untouched.
    expect(store.getItem(PH_COOKIE)).toBeNull();
    expect(store.getItem(`__ph_opt_in_out_${TOKEN}`)).toBeNull();
    expect(store.getItem(ANALYTICS_CONSENT_KEY)).toBe("denied");
    // Host-only cookie expired.
    expect(cookieJar).toContain("Max-Age=0");
    expect(cookieJar).toContain("path=/");
  });

  it("'denied' is a no-op when the SDK was never initialised (nothing to tear down)", async () => {
    const store = makeLocalStorage();
    installBrowserGlobals(store);
    const client = await import("./client");

    client.applyConsent("denied");

    expect(mockPosthog.opt_out_capturing).not.toHaveBeenCalled();
  });

  it("null (pending) is a no-op — neither inits nor tears down", async () => {
    installBrowserGlobals(makeLocalStorage());
    const client = await import("./client");

    client.applyConsent(null);

    expect(mockPosthog.init).not.toHaveBeenCalled();
    expect(mockPosthog.opt_out_capturing).not.toHaveBeenCalled();
  });

  it("teardown is idempotent — a repeat 'denied' removes nothing new and does not throw", async () => {
    const store = makeLocalStorage({ [ANALYTICS_CONSENT_KEY]: "granted" });
    installBrowserGlobals(store);
    const client = await import("./client");

    client.applyConsent("granted");
    seedPostHogKeys(store);
    store.setItem(ANALYTICS_CONSENT_KEY, "denied");
    client.applyConsent("denied");
    const cookieAfterFirst = cookieJar;

    // A redundant storage-event-driven re-run must be safe.
    expect(() => client.applyConsent("denied")).not.toThrow();
    expect(store.getItem(PH_COOKIE)).toBeNull();
    expect(store.getItem(`__ph_opt_in_out_${TOKEN}`)).toBeNull();
    expect(cookieJar).toBe(cookieAfterFirst);
  });
});

describe("setAnalyticsConsent — this tab's own choice", () => {
  it("'denied' persists the choice AND tears the SDK down", async () => {
    const store = makeLocalStorage({ [ANALYTICS_CONSENT_KEY]: "granted" });
    installBrowserGlobals(store);
    const client = await import("./client");

    client.applyConsent("granted");
    seedPostHogKeys(store);
    client.setAnalyticsConsent("denied");

    expect(store.getItem(ANALYTICS_CONSENT_KEY)).toBe("denied");
    expect(mockPosthog.opt_out_capturing).toHaveBeenCalledTimes(1);
    expect(store.getItem(PH_COOKIE)).toBeNull();
  });
});

describe("capture()/identify() — live-consent gate (L2 defence-in-depth)", () => {
  it("do not capture after consent flips to 'denied' even while initialised", async () => {
    const store = makeLocalStorage({ [ANALYTICS_CONSENT_KEY]: "granted" });
    installBrowserGlobals(store);
    const client = await import("./client");

    client.applyConsent("granted"); // initialised === true

    client.capture("intake_started");
    client.identify("user_1");
    expect(mockPosthog.capture).toHaveBeenCalledTimes(1);
    expect(mockPosthog.identify).toHaveBeenCalledTimes(1);

    // Withdrawal in this or a sibling tab flips the stored value.
    store.setItem(ANALYTICS_CONSENT_KEY, "denied");

    client.capture("intake_completed");
    client.identify("user_1");
    // Still gated even though `initialized` stays true.
    expect(mockPosthog.capture).toHaveBeenCalledTimes(1);
    expect(mockPosthog.identify).toHaveBeenCalledTimes(1);
  });
});
