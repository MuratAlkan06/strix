/**
 * AI model identifiers — defined ONCE here (ADR-0001). Feature code references
 * these constants, never bare model-ID strings, so a model bump is a one-line
 * change with no string-search hunt.
 *
 *   MODEL_SONNET — the intake + (Slice 6) plan-generation model.
 *   MODEL_HAIKU  — the single lightweight canonicalize() classifier (PLAN §10
 *                  "a lightweight call no tier would notice").
 */
export const MODEL_SONNET = "claude-sonnet-4-6" as const;
export const MODEL_HAIKU = "claude-haiku-4-5" as const;
