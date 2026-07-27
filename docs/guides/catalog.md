# Catalog: Products and Entitlements

The Catalog is the project-level model of what you sell and what customers get.
It deliberately separates two concepts:

- A **Product** is something a customer can buy: a subscription or a one-time
  non-consumable purchase. Products carry no store identifiers themselves;
  store identifiers live in provider mappings (see below).
- An **Entitlement** is a capability a customer holds, such as `pro` access.
  Entitlements are granted by Products. One Product can grant several
  Entitlements, and one Entitlement can be granted by several Products.

Keeping them separate lets you change what you sell (new Products, price
migrations, replacement Products) without changing what the app checks
(Entitlements).

## Where

Dashboard: `/organizations/{organizationId}/projects/{projectId}/catalog/products`
and `.../catalog/entitlements`. API: `POST /v1/projects/{projectId}/products`,
`POST /v1/projects/{projectId}/entitlements`, and the resource routes under
`/v1/products/{productId}` and `/v1/entitlements/{entitlementId}`.

## Creating a Product

A Product has a stable `key`, an internal name, an optional description, and a
`type`: `subscription` or `one_time_non_consumable`. The key is what paywall
configuration and SDKs reference; choose it once and keep it stable.

Products move through statuses: `draft`, `connected`, `attention_required`, and
`archived`. A Product's readiness panel (dashboard Product detail page, or
`GET /v1/products/{productId}/readiness`) explains what is missing before the
Product can be published in a paywall.

Archived Products can be restored, and a Product can name a replacement
Product (`PUT /v1/products/{productId}/replacement`) so existing configuration
has a documented successor.

## Creating an Entitlement

An Entitlement has a stable `key`, a name, and an optional description. There
is no server-side "active" flag: whether a given customer currently holds an
Entitlement is runtime state, resolved through the commerce provider on the
device.

## Granting Entitlements to Products

On the Product detail page, or via
`POST /v1/products/{productId}/entitlements` with `{"entitlementId": "..."}`,
attach the Entitlements a purchase of that Product grants. Remove a grant with
`DELETE /v1/products/{productId}/entitlements/{entitlementId}`.

Plans (`.../catalog/plans`) optionally group Products for organizational
purposes.

## Mapping Products to providers

A Product becomes purchasable by mapping it to a provider identifier. Mappings
are separate records, scoped to an Application (and, for native stores, a
platform), so one Product can map to different store identifiers per platform
and per environment:

- RevenueCat and custom providers use mappings created against a provider
  connection, usually via catalog import.
- StoreKit 2 and Google Play Billing use native-store mappings entered in the
  dashboard (product identifier; for Google Play subscriptions also a base
  plan and optionally a specific offer).

Publishing a paywall requires each referenced Product to have exactly one
active, available mapping with a current metadata snapshot for the target
Application. See the [providers guide](providers.md) for connections,
credentials, and native-store activation.

## How SDKs interpret Entitlement state

SDK Entitlement lookups return exactly one of four results: available (with
the active set), unknown, provider unavailable, or failed. A provider failure
is never interpreted as "no Entitlements": the SDKs never silently render a
customer as unentitled because a lookup failed. Placement rules that target
Entitlement state receive the distinct unknown/unavailable/failed states and
can branch on them explicitly (see the [targeting guide](targeting.md)).

## Verification status

Catalog CRUD, grants, mappings, readiness, and publishing gates are exercised
by the backend test suites and the GA drills. Live store metadata for StoreKit
and Google Play mappings is entered and verified by operators; Mosaic does not
connect to the store consoles (see the [providers guide](providers.md)).
