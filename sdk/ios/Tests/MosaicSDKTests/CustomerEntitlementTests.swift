import Foundation
import XCTest

@testable import MosaicSDK

// Conformance to the shared cross-implementation reference vectors.
//
// These two tables are the contract between Swift, Kotlin, Dart, and Go. Every
// case below is driven by the file in `packages/test-fixtures/src/`, so a
// disagreement about offline access or cache acceptance fails here rather than
// on a paying customer's device.
final class CustomerEntitlementVectorTests: XCTestCase {

  // Risk: an offline-access policy that disagrees across platforms grants a
  // customer access on one device and withholds it on another, and a naive
  // clock comparison hands unlimited offline access to anyone who moves their
  // device time backwards.
  func testFreshnessVectorTable() throws {
    let root = try entitlementReferenceVectors("entitlement-freshness-vectors.json")
    XCTAssertEqual(
      root["contractVersion"] as? String, mosaicAuthoritativeEntitlementContractVersion)
    let vectors = try entitlementVectorList("entitlement-freshness-vectors.json")
    XCTAssertGreaterThanOrEqual(vectors.count, 12)

    for vector in vectors {
      let id = vector["id"] as? String ?? "<unnamed>"
      guard let snapshot = vector["snapshot"] as? [String: Any],
        let expected = vector["state"] as? String,
        let deviceNow = vector["deviceNow"] as? String,
        let tolerance = vector["clockSkewToleranceSeconds"] as? Int
      else { return XCTFail("malformed freshness vector \(id)") }

      let state = MosaicCustomerEntitlementFreshness.evaluate(
        issuedAt: try contractTimestamp(XCTUnwrap(snapshot["issuedAt"] as? String)),
        refreshAfter: try contractTimestamp(XCTUnwrap(snapshot["refreshAfter"] as? String)),
        validUntil: try contractTimestamp(XCTUnwrap(snapshot["validUntil"] as? String)),
        staleGraceSeconds: snapshot["staleGraceSeconds"] as? Int ?? 0,
        deviceNow: try contractTimestamp(deviceNow),
        tolerance: TimeInterval(tolerance))

      XCTAssertEqual(vectorName(for: state), expected, "freshness vector \(id)")
    }
  }

  // Risk: the acceptance order is normative. Checking version before binding, or
  // binding after monotonicity, either preserves one customer's cache under
  // another customer's identity or misdiagnoses a legitimate per-Environment
  // version restart as a rollback attack.
  func testCacheDecisionVectorTable() throws {
    let root = try entitlementReferenceVectors("entitlement-cache-decision-vectors.json")
    XCTAssertEqual(
      root["evaluationOrder"] as? [String],
      [
        "unsupportedContractVersion", "customerBindingMismatch", "contentDigestMismatch",
        "snapshotVersionNotNewer", "asOfRegression", "accept",
      ])
    let vectors = try entitlementVectorList("entitlement-cache-decision-vectors.json")
    XCTAssertGreaterThanOrEqual(vectors.count, 10)

    for vector in vectors {
      let id = vector["id"] as? String ?? "<unnamed>"
      guard let incoming = vector["incoming"] as? [String: Any],
        let expectedDecision = vector["decision"] as? String,
        let expectedReason = vector["reason"] as? String,
        let expectedAction = vector["cacheAction"] as? String
      else { return XCTFail("malformed cache-decision vector \(id)") }

      let acceptance = MosaicCustomerEntitlementCacheDecision.evaluate(
        cached: try binding(vector["cached"] as? [String: Any]),
        incoming: try XCTUnwrap(binding(incoming)))

      switch acceptance {
      case .accepted(let reason):
        XCTAssertEqual(expectedDecision, "accept", "vector \(id)")
        XCTAssertEqual(reason.rawValue, expectedReason, "vector \(id)")
      case .rejected(let reason):
        XCTAssertEqual(expectedDecision, "reject", "vector \(id)")
        XCTAssertEqual(reason.rawValue, expectedReason, "vector \(id)")
      }
      XCTAssertEqual(acceptance.cacheAction.rawValue, expectedAction, "vector \(id)")
    }
  }

  // Risk: the vector file states the rule the whole contract exists to protect.
  // A refactor that let any rejection resolve to `inactive` would turn a Mosaic
  // outage into a mass revocation experienced by paying customers.
  func testNoRejectionEverResolvesToInactive() throws {
    for vector in try entitlementVectorList("entitlement-cache-decision-vectors.json") {
      guard vector["decision"] as? String == "reject" else { continue }
      let resulting = vector["resultingAccessState"] as? String
      XCTAssertNotEqual(resulting, "inactive", "vector \(vector["id"] as? String ?? "")")
    }
  }

  private func binding(_ value: [String: Any]?) throws -> MosaicCustomerSnapshotBinding? {
    guard let value else { return nil }
    return MosaicCustomerSnapshotBinding(
      contractVersion: try XCTUnwrap(value["contractVersion"] as? String),
      billingCustomerID: try XCTUnwrap(value["billingCustomerId"] as? String),
      projectID: try XCTUnwrap(value["projectId"] as? String),
      environmentID: try XCTUnwrap(value["environmentId"] as? String),
      snapshotVersion: Int64(try XCTUnwrap(value["snapshotVersion"] as? Int)),
      asOf: try contractTimestamp(XCTUnwrap(value["asOf"] as? String)),
      contentDigestValid: try XCTUnwrap(value["contentDigestValid"] as? Bool))
  }

  private func vectorName(for state: MosaicCustomerEntitlementCacheState) -> String {
    switch state {
    case .fresh: "fresh"
    case .refreshRecommended: "refresh_recommended"
    case .staleWithinGrace: "stale_within_grace"
    case .expired: "expired"
    case .missing: "missing"
    case .invalid: "invalid"
    case .differentCustomer: "different_customer"
    case .authorityUnknown: "authority_unknown"
    }
  }
}
