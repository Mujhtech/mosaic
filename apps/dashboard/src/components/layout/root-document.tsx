import { HeadContent, Scripts } from "@tanstack/react-router"
import type { ReactNode } from "react"

export function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <div className="app-root">{children}</div>
        <Scripts />
      </body>
    </html>
  )
}
