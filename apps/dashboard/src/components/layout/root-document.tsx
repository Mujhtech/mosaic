import { HeadContent, Scripts } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { runtimeConfigScript } from "@/config/environment"

export function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        {/* Runtime configuration is assigned before the application modules at
            the end of the body execute, so the same image works against any
            API host. The value is resolved identically on the server and the
            client, so hydration stays stable. */}
        <script
          dangerouslySetInnerHTML={{ __html: runtimeConfigScript() }}
          suppressHydrationWarning
        />
        <div className="app-root">{children}</div>
        <Scripts />
      </body>
    </html>
  )
}
