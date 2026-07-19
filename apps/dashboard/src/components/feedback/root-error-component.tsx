import type { ErrorComponentProps } from "@tanstack/react-router"

import { RouteErrorState } from "@/components/feedback/route-feedback"
import { RootDocument } from "@/components/layout/root-document"

export function RootErrorComponent(props: ErrorComponentProps) {
  return (
    <RootDocument>
      <main id="main-content">
        <RouteErrorState {...props} />
      </main>
    </RootDocument>
  )
}
