export type StudioSource =
  | { readonly kind: "local" }
  | {
      readonly kind: "hosted"
      readonly organizationId: string
      readonly projectId: string
      readonly environmentId: string
      readonly environmentName?: string
      readonly paywallId: string
      readonly draftId: string
      readonly initialReview?: "publish"
    }

export const LOCAL_STUDIO_SOURCE = Object.freeze({ kind: "local" }) satisfies StudioSource

export function hostedStudioHref(source: Extract<StudioSource, { kind: "hosted" }>) {
  return `/studio/${encodeURIComponent(source.organizationId)}/${encodeURIComponent(source.projectId)}/${encodeURIComponent(source.environmentId)}/${encodeURIComponent(source.paywallId)}/${encodeURIComponent(source.draftId)}`
}

export function hostedStudioBackHref(source: Extract<StudioSource, { kind: "hosted" }>) {
  return `/orgs/${encodeURIComponent(source.organizationId)}/projects/${encodeURIComponent(source.projectId)}/env/${encodeURIComponent(source.environmentId)}/monetization/paywalls/${encodeURIComponent(source.paywallId)}`
}

export function hostedStudioPublishReviewHref(source: Extract<StudioSource, { kind: "hosted" }>) {
  return `${hostedStudioHref(source)}?review=publish`
}
