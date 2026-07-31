import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { AnalyticsAdapter } from "../api/analytics-adapter";
import { jobQueryOptions } from "../queries/analytics-queries";
import type { AnalyticsFilters, AnalyticsScope } from "../types/analytics";

export function EventExportAction({
  adapter,
  filters,
  role,
  scope,
}: {
  adapter: AnalyticsAdapter;
  filters: AnalyticsFilters;
  role?: string;
  scope: AnalyticsScope;
}) {
  const [jobId, setJobId] = useState<string>();
  const mutation = useMutation({
    mutationFn: () => adapter.createEventExport(scope, filters),
    onSuccess: (job) => setJobId(job.id),
  });
  const downloadMutation = useMutation({
    mutationFn: async () => {
      if (!jobId) {
        throw new Error("The export job is unavailable.");
      }
      return adapter.downloadJob(scope, jobId);
    },
    onSuccess: (blob) => downloadBlob(blob, "mosaic-event-export.ndjson"),
  });
  const job = useQuery({
    ...jobQueryOptions(scope, jobId ?? "", adapter),
    enabled: Boolean(jobId),
  });
  const allowed = role === "owner" || role === "admin";

  if (!allowed) {
    return null;
  }
  return (
    <div className="flex items-center gap-2">
      {job.data?.state === "completed" && job.data.downloadAvailable ? (
        <Button
          disabled={downloadMutation.isPending}
          onClick={() => downloadMutation.mutate()}
          type="button"
          variant="outline"
        >
          <DownloadSimpleIcon aria-hidden size={16} /> Download export
        </Button>
      ) : (
        <Button
          disabled={
            mutation.isPending ||
            job.data?.state === "queued" ||
            job.data?.state === "leased"
          }
          onClick={() => mutation.mutate()}
          type="button"
          variant="outline"
        >
          <DownloadSimpleIcon aria-hidden size={16} />
          {mutation.isPending ||
          job.data?.state === "queued" ||
          job.data?.state === "leased"
            ? "Preparing export…"
            : "Export events"}
        </Button>
      )}
      {job.data?.state === "failed" ? (
        <Button
          onClick={() => mutation.mutate()}
          type="button"
          variant="outline"
        >
          Retry export
        </Button>
      ) : null}
      {mutation.error ? (
        <span className="text-destructive text-xs" role="alert">
          {mutation.error.message}
        </span>
      ) : null}
      {downloadMutation.error ? (
        <span className="text-destructive text-xs" role="alert">
          {downloadMutation.error.message}
        </span>
      ) : null}
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
