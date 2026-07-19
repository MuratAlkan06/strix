/**
 * migrate runner unit tests — covers the connection-string resolution + the
 * pooled-host guard (CS-7 / ADR-0002 Decision 1).
 *
 * Why this matters: the runtime DATABASE_URL is the Neon POOLED string, but
 * DDL must run against the DIRECT (non-pooled) host. Following the runbook with
 * only DATABASE_URL set would silently migrate over the pooler on the shared
 * preview DB. resolveMigrationUrl turns that footgun into a loud throw — these
 * tests pin that behavior so a future edit can't quietly re-open the gap.
 *
 * Only the pure resolver is exercised; the runner's top-level main() (which
 * opens a real Neon connection) is never invoked.
 */
import { describe, expect, it } from "vitest";
import { resolveMigrationUrl } from "./migrate";

const DIRECT =
  "postgresql://u:p@ep-example-000000.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require";
const POOLED =
  "postgresql://u:p@ep-example-000000-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require";

describe("resolveMigrationUrl", () => {
  it("prefers DIRECT_DATABASE_URL over DATABASE_URL", () => {
    expect(
      resolveMigrationUrl({
        DIRECT_DATABASE_URL: DIRECT,
        DATABASE_URL: POOLED,
      }),
    ).toBe(DIRECT);
  });

  it("falls back to DATABASE_URL when DIRECT_DATABASE_URL is unset", () => {
    expect(resolveMigrationUrl({ DATABASE_URL: DIRECT })).toBe(DIRECT);
  });

  it("throws when neither var is set", () => {
    expect(() => resolveMigrationUrl({})).toThrow(/required to run migrations/);
  });

  it("rejects a pooled host supplied via DATABASE_URL", () => {
    expect(() => resolveMigrationUrl({ DATABASE_URL: POOLED })).toThrow(
      /-pooler/,
    );
  });

  it("rejects a pooled host even when set as DIRECT_DATABASE_URL", () => {
    // Guards the misconfiguration where the pooled string is pasted into the
    // direct var — the guard is on the resolved value, not the var name.
    expect(() =>
      resolveMigrationUrl({ DIRECT_DATABASE_URL: POOLED }),
    ).toThrow(/direct\/non-pooled host/);
  });
});
