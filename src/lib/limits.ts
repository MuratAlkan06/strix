/**
 * limits.ts — free-tier usage caps (SPEC §10 "Free tier usage limits").
 *
 * Free users get **2 replans per calendar month** — weekly check-ins still
 * happen; the AI just doesn't propose changes more than twice. The counter
 * lives in usage_counters.replans_used with a calendar-1st reset in the
 * user's timezone (usage_counters.period_start). Pro/Max are uncapped.
 *
 * Phase 2 only ENFORCES the cap at check-in selection time (how many goals
 * may trigger a replan proposal); the increment itself ships with Phase 3's
 * checkAndIncrement.
 */
export const FREE_MONTHLY_REPLAN_LIMIT = 2;
