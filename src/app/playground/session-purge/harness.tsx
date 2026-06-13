"use client";

/**
 * PurgeHarness — drives the REAL purgeClientCaches through a real button in a
 * real browser. After the purge settles it snapshots `caches.keys()` and
 * renders the count, so the e2e spec asserts an in-page observation taken
 * immediately after the purge resolved (not a racy out-of-band poll).
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { purgeClientCaches } from "@/lib/sw/purge";

export function PurgeHarness() {
  const [result, setResult] = useState<string>("idle");

  const handlePurge = async () => {
    try {
      await purgeClientCaches();
      const remaining = await caches.keys();
      setResult(`purged: ${remaining.length} caches remain`);
    } catch (error: unknown) {
      setResult(`purge failed: ${String(error)}`);
    }
  };

  return (
    <div className="flex flex-col items-start gap-3">
      <Button className="h-11 px-4" onClick={handlePurge}>
        Purge all caches
      </Button>
      <p data-testid="purge-result" className="text-sm text-muted-foreground">
        {result}
      </p>
    </div>
  );
}
