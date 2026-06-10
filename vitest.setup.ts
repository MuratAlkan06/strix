/**
 * Vitest setup — runs before any test file is imported. Sets the
 * placeholder env vars that scoped.ts -> client.ts validates at module
 * load. The synchronous scopedDb tests never actually hit the DB, so a
 * placeholder URL is enough; client.ts only checks that the var is set.
 *
 * Real-DB integration tests (Phase 1+) should use a separate
 * DATABASE_URL_TEST pointing at a dedicated Neon branch.
 */
process.env.DATABASE_URL ??=
  "postgresql://placeholder:placeholder@localhost:5432/placeholder";
