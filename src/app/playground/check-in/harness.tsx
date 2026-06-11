"use client";

/**
 * CheckInHarness — client wrapper for the playground check-in surface.
 * Provides the REAL <CheckInForm /> deterministic local handlers (always ok,
 * no server action, no DB) so the whole interaction surface — feeling cards,
 * the dynamic capacity cap, the upgrade modal, skip, the quiet confirmation
 * states — is exercisable without auth.
 */
import { CheckInForm } from "../../(check-in)/check-in/check-in-form";
import type { CheckInModel } from "../../(check-in)/check-in/check-in-model";

export function CheckInHarness({ model }: { model: CheckInModel }) {
  return (
    <CheckInForm
      model={model}
      onSubmit={async () => ({ ok: true as const })}
      onSkip={async () => ({ ok: true as const })}
    />
  );
}
