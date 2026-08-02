/**
 * Shared document head construction for file routes.
 *
 * Every route repeats the same title suffix and description shape, so the
 * boilerplate is centralised here and each route supplies only what makes it
 * distinct. TanStack merges head output from the root down the matched route
 * tree, deduping `title` and same-`name` meta tags, so a leaf route's values
 * replace the root defaults without the route having to restate them.
 */

import type { AnyRouteMatch } from "@tanstack/react-router";

/** Product name appended to every page title. */
export const APP_NAME = "Mosaic Studio";

/** Description used when a route does not describe itself. */
export const APP_DESCRIPTION =
  "Build and operate native monetization experiences with Mosaic.";

/** Separator between the page title and the product name. */
const TITLE_SEPARATOR = " · ";

export interface RouteHeadOptions {
  /** Overrides the inherited description. Omit to keep the parent's. */
  description?: string;
  /**
   * Page title without the product suffix, for example `"Paywalls"`. Omit to
   * fall back to the bare product name.
   */
  title?: string;
}

export interface RouteHead {
  meta: NonNullable<AnyRouteMatch["meta"]>;
}

/**
 * Builds the `head` payload for a route.
 *
 * ```ts
 * export const Route = createFileRoute("/login")({
 *   head: () => routeHead({ title: "Sign in" }),
 * })
 * ```
 */
export function routeHead({
  description,
  title,
}: RouteHeadOptions = {}): RouteHead {
  const meta: NonNullable<AnyRouteMatch["meta"]> = [
    { title: pageTitle(title) },
  ];

  if (description) {
    meta.push({ content: description, name: "description" });
  }

  return { meta };
}

/** Suffixes a page title with the product name. */
export function pageTitle(title?: string): string {
  return title ? `${title}${TITLE_SEPARATOR}${APP_NAME}` : APP_NAME;
}
