import { afterEach, describe, expect, it, vi } from "vitest";

import { createGeneratedDashboardClient } from "@/lib/api/generated-dashboard-client";
import { createGeneratedAnalyticsAdapter } from "./rest-analytics-adapter";

afterEach(() => vi.unstubAllGlobals());

describe("privacy REST requests", () => {
  it("keeps identity values in POST bodies and out of URLs", async () => {
    const identity = "private-user-value";
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              requestDigest: "preview_01",
              kind: "application_user",
              affectedEnvironmentIds: [],
              affectedEvents: 0,
              affectedSessions: 0,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );
    const adapter = createGeneratedAnalyticsAdapter(
      createGeneratedDashboardClient(fetchMock)
    );

    await adapter.previewIdentity(
      {
        organizationId: "org_01",
        projectId: "project_01",
        environmentId: "environment_01",
      },
      { scope: "application_user", value: identity }
    );

    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) {
      throw new Error("Expected one privacy request");
    }
    const request = call[0] as Request;
    expect(request.url).not.toContain(identity);
    expect(request.method).toBe("POST");
    expect(await request.clone().text()).toContain(identity);
    expect(JSON.stringify(analyticsKeysForInspection())).not.toContain(
      identity
    );
  });

  it("requires a fresh preview digest and explicit deletion confirmation without leaking identity", async () => {
    const identity = {
      scope: "installation" as const,
      value: "private-installation-value",
    };
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              id: "job_01",
              kind: "deletion",
              status: "queued",
              createdAt: "2026-07-26T12:00:00.000Z",
              updatedAt: "2026-07-26T12:00:00.000Z",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );
    const adapter = createGeneratedAnalyticsAdapter(
      createGeneratedDashboardClient(fetchMock)
    );

    await adapter.confirmDeletion(
      {
        organizationId: "org_01",
        projectId: "project_01",
        environmentId: "environment_01",
      },
      identity,
      "fresh-request-digest"
    );

    const call = fetchMock.mock.calls[0];
    if (!call) {
      throw new Error("Expected one deletion request");
    }
    const request = call[0] as Request;
    expect(request.url).not.toContain(identity.value);
    expect(await request.clone().json()).toEqual({
      kind: "installation",
      identity: identity.value,
      requestDigest: "fresh-request-digest",
      confirm: true,
    });
  });
});

describe("analytics dimension mapping", () => {
  it("preserves unavailable provider authority and warnings in funnel steps", async () => {
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              metrics: [
                {
                  id: "client_completed_purchases",
                  value: 3,
                  numerator: 3,
                  basis: "event_count",
                  authority: "client_observed",
                  attributionWindow: "24h",
                  timezone: "UTC",
                  definition: "Client-observed purchased outcomes.",
                },
                {
                  id: "provider_confirmed_purchases",
                  numerator: 0,
                  basis: "event_count",
                  authority: "provider_confirmed",
                  attributionWindow: "24h",
                  timezone: "UTC",
                  definition: "Provider-confirmed purchases.",
                  warnings: ["provider_confirmed_unavailable"],
                },
              ],
              freshness: { lateEventPolicy: "Seven-day event-time window." },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );
    const adapter = createGeneratedAnalyticsAdapter(
      createGeneratedDashboardClient(fetchMock)
    );

    const report = await adapter.getFunnel(
      {
        organizationId: "org_01",
        projectId: "project_01",
        environmentId: "environment_01",
      },
      "purchases",
      {
        from: "2026-07-26",
        to: "2026-07-26",
        timezone: "UTC",
        basis: "event_count",
      }
    );

    expect(report.steps[1]).toMatchObject({
      available: false,
      authority: "provider_confirmed",
      count: 0,
      dropOff: undefined,
      warnings: ["provider_confirmed_unavailable"],
    });
    expect(report.warnings).toEqual(["provider_confirmed_unavailable"]);
  });

  it("maps backend dimension keys into Paywall comparison and issue rows", async () => {
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      const metrics = url.includes("paywall-version-comparison")
        ? [
            {
              id: "paywall_presentations",
              value: 2,
              numerator: 2,
              basis: "event_count",
              authority: "client_observed",
              attributionWindow: "24h",
              timezone: "UTC",
              definition: "Presentations",
              dimensions: { paywall_version_id: "version_01" },
            },
          ]
        : url.includes("provider-errors")
          ? [
              {
                id: "provider_errors",
                value: 1,
                numerator: 1,
                basis: "event_count",
                authority: "client_observed",
                attributionWindow: "24h",
                timezone: "UTC",
                definition: "Provider errors",
                dimensions: { provider: "app_store" },
              },
            ]
          : [];
      return new Response(
        JSON.stringify({ data: { metrics, freshness: {} } }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    });
    const adapter = createGeneratedAnalyticsAdapter(
      createGeneratedDashboardClient(fetchMock)
    );
    const scope = {
      organizationId: "org_01",
      projectId: "project_01",
      environmentId: "environment_01",
    };
    const filters = {
      from: "2026-07-26",
      to: "2026-07-26",
      timezone: "UTC",
      basis: "event_count" as const,
      platform: "ios" as const,
      locale: "en-NG",
      applicationVersion: "6.0.0",
    };

    await expect(
      adapter.getPaywallComparison(scope, filters)
    ).resolves.toMatchObject([
      { paywallVersionId: "version_01", presentations: 2 },
    ]);
    await expect(adapter.getIssues(scope, filters)).resolves.toEqual([
      expect.objectContaining({ kind: "provider", label: "app_store" }),
    ]);

    const urls = fetchMock.mock.calls.map(([input]) =>
      input instanceof Request ? input.url : String(input)
    );
    expect(urls).toHaveLength(3);
    for (const url of urls) {
      expect(url).toContain("from=2026-07-26T00%3A00%3A00.000Z");
      expect(url).toContain("to=2026-07-27T00%3A00%3A00.000Z");
      expect(url).toContain("platform=ios");
      expect(url).toContain("locale=en-NG");
      expect(url).toContain("applicationVersion=6.0.0");
    }
  });

  it("maps the supported platform and locale breakdowns without inventing dimensions", async () => {
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      const isPlatform = url.includes("/breakdowns/platforms");
      return new Response(
        JSON.stringify({
          data: {
            metrics: [
              {
                id: "events",
                value: isPlatform ? 9 : 7,
                numerator: isPlatform ? 9 : 7,
                basis: "event_count",
                authority: "client_observed",
                attributionWindow: "24h",
                timezone: "UTC",
                definition: "Accepted events",
                dimensions: isPlatform
                  ? { platform: "ios" }
                  : { locale: "en-NG" },
              },
            ],
            freshness: {},
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    const adapter = createGeneratedAnalyticsAdapter(
      createGeneratedDashboardClient(fetchMock)
    );

    await expect(
      adapter.getBreakdowns(
        {
          organizationId: "org_01",
          projectId: "project_01",
          environmentId: "environment_01",
        },
        {
          from: "2026-07-26",
          to: "2026-07-26",
          timezone: "UTC",
          basis: "event_count",
        }
      )
    ).resolves.toEqual([
      { dimension: "platform", rows: [{ label: "ios", count: 9 }] },
      { dimension: "locale", rows: [{ label: "en-NG", count: 7 }] },
    ]);
  });

  it("uses an exclusive next-day boundary for event exports", async () => {
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              id: "job_01",
              kind: "events",
              status: "queued",
              createdAt: "2026-07-26T12:00:00.000Z",
              updatedAt: "2026-07-26T12:00:00.000Z",
              format: "ndjson",
            },
          }),
          { status: 202, headers: { "Content-Type": "application/json" } }
        )
    );
    const adapter = createGeneratedAnalyticsAdapter(
      createGeneratedDashboardClient(fetchMock)
    );

    await adapter.createEventExport(
      {
        organizationId: "org_01",
        projectId: "project_01",
        environmentId: "environment_01",
      },
      {
        from: "2026-07-26",
        to: "2026-07-26",
        timezone: "UTC",
        basis: "event_count",
      }
    );

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(await request.clone().json()).toMatchObject({
      from: "2026-07-26T00:00:00.000Z",
      to: "2026-07-27T00:00:00.000Z",
    });
  });
});

function analyticsKeysForInspection() {
  return ["analytics", "project_01", "environment_01", "privacy-preview"];
}
