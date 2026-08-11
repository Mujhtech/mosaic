import type { AnalyticsFreshness } from "@/generated/api";

import type { Freshness } from "./analytics";

/**
 * Turns the wire freshness record into the state the banner reads.
 *
 * The API reports watermarks, not a verdict: "aggregated up to here" and
 * "received up to here". The verdict is derived here, in one place, so every
 * surface that shows freshness — the analytics workspace and the Project
 * overview alike — agrees on when a number is merely late rather than wrong.
 */
export function deriveFreshness(freshness: AnalyticsFreshness): Freshness {
  const latestReceived = freshness.latestReceivedAt
    ? new Date(freshness.latestReceivedAt).getTime()
    : undefined;
  const latestAggregated = freshness.latestAggregatedAt
    ? new Date(freshness.latestAggregatedAt).getTime()
    : undefined;

  return {
    latestReceivedAt: freshness.latestReceivedAt,
    latestAggregatedAt: freshness.latestAggregatedAt,
    lateEventPolicy: freshness.lateEventPolicy,
    aggregateState: (() => {
      if (latestAggregated === undefined) {
        return "unavailable";
      }
      if (latestReceived !== undefined && latestReceived > latestAggregated) {
        return "delayed";
      }
      return "current";
    })(),
  };
}
