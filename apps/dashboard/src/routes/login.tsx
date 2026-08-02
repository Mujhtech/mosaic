import { createFileRoute } from "@tanstack/react-router";

import { AuthPageShell } from "@/features/auth/components/auth-page-shell";
import { LoginForm } from "@/features/auth/components/login-form";
import { safeInternalReturnTo } from "@/features/auth/types/hosted-access";
import { routeHead } from "@/lib/routing/route-head";

interface AuthRouteSearch {
  returnTo?: string;
}

export const Route = createFileRoute("/login")({
  component: LoginRoute,
  head: () =>
    routeHead({
      description: "Sign in to your Mosaic Studio workspace.",
      title: "Sign in",
    }),
  validateSearch: (search: Record<string, unknown>): AuthRouteSearch => {
    const returnTo = safeInternalReturnTo(search.returnTo, "");
    return returnTo ? { returnTo } : {};
  },
});

function LoginRoute() {
  const { returnTo } = Route.useSearch();
  return (
    <AuthPageShell>
      <LoginForm returnTo={returnTo} />
    </AuthPageShell>
  );
}
