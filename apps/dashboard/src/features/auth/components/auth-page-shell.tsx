import type { ReactNode } from "react";

interface AuthPageShellProps {
  children: ReactNode;
}

export function AuthPageShell({ children }: AuthPageShellProps) {
  return (
    <main className="grid min-h-svh place-items-center bg-muted/35 px-5 py-10">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
