/**
 * display-prices.ts — human-readable price strings for the cap-hit / upgrade
 * surfaces (SPEC §10 pricing).
 *
 * DISPLAY ONLY. This is deliberately NOT lib/billing/config.ts: it carries no
 * Stripe price IDs, no env reads, and no `stripe` import — the functional
 * Checkout wiring (price IDs from env) is slice S2, which lands AFTER the prod
 * cutover. Keeping these as plain client-safe strings lets the S1 modal render
 * accurate prices without tripping the commerce cutover gate.
 */
export const DISPLAY_PRICES = {
  pro: { monthly: "$9.99/mo", annual: "$89.99/yr" },
  max: { monthly: "$19.99/mo", annual: "$179.99/yr" },
} as const;
