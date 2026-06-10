"use client";

/**
 * /playground/completion — DEMO-ONLY surface for the sunrise completion moment.
 *
 * Throwaway, like /playground/dashboard: it exists so the ONE signature motion
 * beat (DESIGN.md §4.3 — goal completion rendered as a sunrise + "Well done.")
 * can be played, reviewed, and captured in a browser without standing up a real
 * goal flow. It is intentionally a SEPARATE route from /playground/dashboard so
 * the dashboard's screenshot baselines stay byte-identical (this page carries
 * the only moving pixels). The /playground(.*) Clerk matcher (src/proxy.ts)
 * already makes it reachable without auth.
 *
 * It inherits the GLOBAL dusk chrome (root layout + globals.css); it does NOT
 * use the dashboard's playground.css variant wrappers. One goal scene (mountain
 * variant), a "Mark complete" button that triggers the sunrise, and a reset.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CompletionScene } from "@/components/completion-scene";

export default function PlaygroundCompletionPage() {
  const [complete, setComplete] = useState(false);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium tracking-tight text-foreground">
          Completion moment
        </h1>
        <p className="text-sm text-muted-foreground">
          Demo-only. The sunrise that plays when a goal is completed
          (DESIGN.md §4.3) — sky brightens, the sun rises, then a quiet line.
        </p>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b">
          <CardTitle>Climb a mountain</CardTitle>
          <CardDescription>
            {complete ? "Completed" : "In progress"}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {/* Reserved aspect keeps height stable → no CLS while it animates. */}
          <CompletionScene
            variant="mountain"
            complete={complete}
            className="aspect-[16/10] w-full"
            title="Climb a mountain — sunrise on completion"
          />
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={() => setComplete(true)} disabled={complete}>
          Mark complete
        </Button>
        <Button
          variant="outline"
          onClick={() => setComplete(false)}
          disabled={!complete}
        >
          Reset
        </Button>
      </div>
    </main>
  );
}
