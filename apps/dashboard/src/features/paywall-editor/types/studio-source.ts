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
    }

export const LOCAL_STUDIO_SOURCE = Object.freeze({ kind: "local" }) satisfies StudioSource

export function hostedStudioHref(source: Extract<StudioSource, { kind: "hosted" }>) {
  return `/studio-hosted/${encodeURIComponent(source.organizationId)}/${encodeURIComponent(source.projectId)}/${encodeURIComponent(source.environmentId)}/${encodeURIComponent(source.paywallId)}/${encodeURIComponent(source.draftId)}`
}

export function hostedStudioBackHref(source: Extract<StudioSource, { kind: "hosted" }>) {
  return `/organizations/${encodeURIComponent(source.organizationId)}/projects/${encodeURIComponent(source.projectId)}/monetization/${encodeURIComponent(source.environmentId)}/paywalls/${encodeURIComponent(source.paywallId)}`
}
