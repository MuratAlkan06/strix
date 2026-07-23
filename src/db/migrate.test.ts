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
import { assertMigrationTarget, resolveMigrationUrl } from "./migrate";

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

/**
 * Prod-target confirmation (CS-7 Medium). The decision is exercised directly
 * with an injected `isTTY`, so no test needs a real TTY; the readline prompt
 * (`confirmMigrationTarget`) is a thin wrapper left to manual/integration use.
 * The security invariant under test: no thrown message ever leaks the
 * credentialed URL or the "u:p" credential portion — only the resolved host.
 */
const HOST = "ep-example-000000.c-2.us-west-2.aws.neon.tech";

describe("assertMigrationTarget", () => {
  it("proceeds when the resolved host is the sole allowlist entry", () => {
    expect(
      assertMigrationTarget(DIRECT, { STRIX_MIGRATE_TARGET: HOST }, false),
    ).toEqual({ proceed: true });
  });

  it("proceeds on any member of a comma-separated allowlist (trims whitespace)", () => {
    expect(
      assertMigrationTarget(
        DIRECT,
        { STRIX_MIGRATE_TARGET: `other.host , ${HOST} , another.host` },
        false,
      ),
    ).toEqual({ proceed: true });
  });

  it("throws naming the resolved host when it is not in the allowlist", () => {
    expect(() =>
      assertMigrationTarget(DIRECT, { STRIX_MIGRATE_TARGET: "wrong.host" }, false),
    ).toThrow(new RegExp(HOST.replace(/\./g, "\\.")));
  });

  it("throws non-interactively when no allowlist is set (not a TTY)", () => {
    expect(() => assertMigrationTarget(DIRECT, {}, false)).toThrow(
      /non-interactive migration requires STRIX_MIGRATE_TARGET/,
    );
  });

  it("requires interactive confirmation when no allowlist is set and stdin is a TTY", () => {
    expect(assertMigrationTarget(DIRECT, {}, true)).toEqual({
      confirmRequired: true,
    });
  });

  it("never leaks the credentialed URL or credentials in the mismatch error", () => {
    let message = "";
    try {
      assertMigrationTarget(DIRECT, { STRIX_MIGRATE_TARGET: "wrong.host" }, false);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain("u:p");
    expect(message).not.toContain(DIRECT);
  });

  it("never leaks the credentialed URL or credentials in the non-interactive error", () => {
    let message = "";
    try {
      assertMigrationTarget(DIRECT, {}, false);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain("u:p");
    expect(message).not.toContain(DIRECT);
  });
});
