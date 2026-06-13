import { describe, expect, it } from "vitest";

import {
  INITIAL_WATCH_STATE,
  watchSession,
  type SessionWatchSnapshot,
  type SessionWatchState,
} from "./session-watch-model";

/** Run a sequence of snapshots through the machine, collecting purge fires. */
function run(snapshots: SessionWatchSnapshot[]): {
  state: SessionWatchState;
  purges: number[];
} {
  let state = INITIAL_WATCH_STATE;
  const purges: number[] = [];
  snapshots.forEach((snapshot, index) => {
    const result = watchSession(state, snapshot);
    state = result.state;
    if (result.shouldPurge) purges.push(index);
  });
  return { state, purges };
}

describe("watchSession", () => {
  it("never purges while Clerk is still loading", () => {
    const { purges } = run([
      { isLoaded: false, isSignedIn: undefined },
      { isLoaded: false, isSignedIn: undefined },
    ]);
    expect(purges).toEqual([]);
  });

  it("does not purge on a cold start that resolves to signed-out", () => {
    const { purges } = run([
      { isLoaded: false, isSignedIn: undefined },
      { isLoaded: true, isSignedIn: false },
      { isLoaded: true, isSignedIn: false },
    ]);
    expect(purges).toEqual([]);
  });

  it("purges exactly once on a signed-in → signed-out transition", () => {
    const { purges } = run([
      { isLoaded: true, isSignedIn: true },
      { isLoaded: true, isSignedIn: false }, // expiry / revocation / sign-out
      { isLoaded: true, isSignedIn: false }, // re-render: must not re-fire
    ]);
    expect(purges).toEqual([1]);
  });

  it("stays armed across repeated signed-in snapshots", () => {
    const { purges } = run([
      { isLoaded: true, isSignedIn: true },
      { isLoaded: true, isSignedIn: true },
      { isLoaded: true, isSignedIn: true },
      { isLoaded: true, isSignedIn: false },
    ]);
    expect(purges).toEqual([3]);
  });

  it("re-arms after the next sign-in (one purge per session end)", () => {
    const { purges } = run([
      { isLoaded: true, isSignedIn: true },
      { isLoaded: true, isSignedIn: false },
      { isLoaded: true, isSignedIn: true },
      { isLoaded: true, isSignedIn: false },
    ]);
    expect(purges).toEqual([1, 3]);
  });

  it("a loading blip between snapshots does not disarm or fire", () => {
    const { purges } = run([
      { isLoaded: true, isSignedIn: true },
      { isLoaded: false, isSignedIn: undefined }, // transient re-load
      { isLoaded: true, isSignedIn: true },
    ]);
    expect(purges).toEqual([]);
  });
});
