/**
 * format.ts — small deterministic display formatters shared by the product
 * surfaces (goals list, equipment view). Locale is pinned to en-US so output
 * never depends on server environment.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-08-15" → "Aug 15, 2026". Non-ISO input is returned untouched. */
export function formatDate(iso: string): string {
  if (!ISO_DATE_RE.test(iso)) return iso;
  // Local-time parse + local-time format cancel out for a date-only value.
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${iso}T00:00:00`));
}

/**
 * Format a USD amount (drizzle numeric comes back as a string).
 * Whole-dollar amounts drop the cents ("$450"); fractional keep two
 * ("$120.50"). Null/unparseable → null (render nothing, not "$NaN").
 */
export function formatUsd(value: string | number | null): string | null {
  if (value === null) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const wholeDollars = Number.isInteger(n);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: wholeDollars ? 0 : 2,
    maximumFractionDigits: wholeDollars ? 0 : 2,
  }).format(n);
}
