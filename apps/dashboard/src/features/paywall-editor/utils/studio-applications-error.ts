import { ApiError } from "@/lib/api/errors";

export function studioApplicationsErrorMessage(error: Error) {
  return error instanceof ApiError && error.status === 403
    ? "You can edit this Draft, but you do not have permission to inspect its Applications."
    : "Applications could not be loaded. Provider readiness remains unavailable.";
}
