import { useCallback, useEffect, useRef, useState } from "react";

import type { DraftAutosaveController } from "@/features/paywall-editor/hooks/use-draft-autosave";
import type { MosaicDocument } from "@/features/paywall-editor/types/editor";
import {
  clearHostedDraftRecovery,
  type HostedDraftRecoveryRecord,
  type HostedDraftRecoveryScope,
  readHostedDraftRecovery,
  writeHostedDraftRecovery,
} from "@/features/paywalls/mutations/hosted-draft-recovery";

function recoveryReason(
  status: DraftAutosaveController["status"]
): HostedDraftRecoveryRecord["reason"] {
  if (status === "conflict") {
    return "conflict";
  }
  if (status === "offline" || status === "failed") {
    return "offline";
  }
  return "unsaved";
}

export function useHostedDraftRecovery({
  document,
  expectedRevision,
  scope,
  status,
}: {
  document: MosaicDocument | null;
  /**
   * The Draft revision this local copy diverged from. `null` means there is no
   * hosted session, so nothing can be persisted: a record has to name the
   * revision it will be restored against, and `0` is a real revision number
   * rather than a stand-in for "unknown".
   */
  expectedRevision: number | null;
  scope: HostedDraftRecoveryScope | null;
  status: DraftAutosaveController["status"];
}) {
  const [record, setRecord] = useState<HostedDraftRecoveryRecord | null>(() =>
    scope ? readHostedDraftRecovery(scope) : null
  );
  /**
   * Set when a write was attempted and the browser refused it — a full or
   * disabled localStorage, private-browsing quota, or a document too large.
   * The editor renders this: an operator who believes their work is backed up
   * locally, and is not, loses it on the next reload with no warning at all.
   */
  const [persistenceFailed, setPersistenceFailed] = useState(false);
  const wroteThisSessionRef = useRef(false);
  const persist = useCallback(
    (reason = recoveryReason(status)) => {
      if (!(scope && document) || expectedRevision === null) {
        return true;
      }
      const didPersist = writeHostedDraftRecovery(scope, {
        document,
        expectedRevision,
        reason,
      });
      setPersistenceFailed(!didPersist);
      if (didPersist) {
        wroteThisSessionRef.current = true;
        setRecord(readHostedDraftRecovery(scope));
      }
      return didPersist;
    },
    [document, expectedRevision, scope, status]
  );
  const clear = useCallback(() => {
    if (!scope) {
      return;
    }
    clearHostedDraftRecovery(scope);
    setRecord(null);
    setPersistenceFailed(false);
  }, [scope]);

  useEffect(() => {
    if (!scope) {
      return;
    }
    if (status === "saved" && wroteThisSessionRef.current) {
      clear();
      return;
    }
    if (status === "idle") {
      return;
    }
    const timer = window.setTimeout(() => persist(), 250);
    return () => window.clearTimeout(timer);
  }, [clear, persist, scope, status]);

  useEffect(() => {
    if (!scope) {
      return;
    }
    const preserve = () => {
      if (status !== "idle" && status !== "saved") {
        persist();
      }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (status === "idle" || status === "saved" || persist()) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("pagehide", preserve);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("pagehide", preserve);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [persist, scope, status]);

  return {
    clear,
    persist,
    persistenceFailed,
    prepareNavigation: () =>
      status === "idle" || status === "saved" || persist(),
    record,
  };
}
