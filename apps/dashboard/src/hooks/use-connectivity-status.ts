import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ApiNetworkError } from "@/lib/api/errors";

/** Consecutive transport failures before Mosaic calls itself degraded. */
const DEGRADED_FAILURE_THRESHOLD = 2;

export interface ConnectivityStatus {
  /** The browser is online but Mosaic cannot reach the API. */
  isDegraded: boolean;
  /** The browser reports no network connection. */
  isOffline: boolean;
}

function readOnline() {
  if (typeof navigator === "undefined") {
    return true;
  }
  return navigator.onLine !== false;
}

/**
 * Distinguishes "this browser is offline" from "the Mosaic API is unreachable".
 * Both are recoverable and both need to be visible outside the failing panel,
 * because a stale-but-rendered dashboard otherwise looks healthy.
 */
export function useConnectivityStatus(): ConnectivityStatus {
  const queryClient = useQueryClient();
  const [isOffline, setIsOffline] = useState(() => !readOnline());
  const [isDegraded, setIsDegraded] = useState(false);

  useEffect(() => {
    const update = () => setIsOffline(!readOnline());
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const evaluate = () => {
      setIsDegraded(
        cache
          .getAll()
          .some(
            (query) =>
              query.state.error instanceof ApiNetworkError &&
              query.state.fetchFailureCount >= DEGRADED_FAILURE_THRESHOLD
          )
      );
    };
    evaluate();
    return cache.subscribe(evaluate);
  }, [queryClient]);

  return { isDegraded: isDegraded && !isOffline, isOffline };
}
