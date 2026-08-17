import { createFileRoute } from "@tanstack/react-router";

import { AuthPageShell } from "@/features/auth/components/auth-page-shell";
import { SignupForm } from "@/features/auth/components/signup-form";
import { safeInternalReturnTo } from "@/features/auth/types/hosted-access";
import { routeHead } from "@/lib/routing/route-head";

interface AuthRouteSearch {
  returnTo?: string;
}

export const Route = createFileRoute("/signup")({
  validateSearch: (search: Record<string, unknown>): AuthRouteSearch => {
    const returnTo = safeInternalReturnTo(search.returnTo, "");
    return returnTo ? { returnTo } : {};
  },
  component: SignupRoute,
  head: () =>
    routeHead({
      description: "Create your Mosaic Studio account.",
      title: "Sign up",
    }),
});

function SignupRoute() {
  const { returnTo } = Route.useSearch();
  return (
    <AuthPageShell>
      <SignupForm returnTo={returnTo} />
    </AuthPageShell>
  );
}
