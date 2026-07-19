import { HeadContent, Scripts } from "@tanstack/react-router"
import type { ReactNode } from "react"

export function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="app-root">{children}</div>
        <Scripts />
      </body>
    </html>
  )
}
