import Foundation
import XCTest

@testable import MosaicSDK

final class CustomerEntitlementCodecTests: XCTestCase {

  // Risk: `contentDigest` is the binding and corruption check. If Swift's
  // canonical form disagrees with the other implementations by one byte, every
  // snapshot Mosaic issues is rejected on iOS and every customer sees `unknown`.
  // Foundation's `sortedKeys` is case-insensitive and would fail this table,
  // which is exactly why the serializer is hand-written.
  func testCanonicalSerializationDigestVectorTable() throws {
    let vectors = try entitlementVectorList("entitlement-snapshot-digest-vectors.json")
    XCTAssertGreaterThanOrEqual(vectors.count, 8)

    for vector in vectors {
      let id = vector["id"] as? String ?? "<unnamed>"
      let payload = try XCTUnwrap(vector["payload"] as? [String: Any], "vector \(id)")
      let serialized = try MosaicCustomerCanonicalJSON.data(payload)

      XCTAssertEqual(
        String(data: serialized, encoding: .utf8), vector["canonicalSerialization"] as? String,
        "canonical bytes for vector \(id)")
      XCTAssertEqual(
        serialized.count, vector["canonicalByteLength"] as? Int, "byte length for vector \(id)")
      XCTAssertEqual(
        try MosaicCustomerCanonicalJSON.digest(payload), vector["digest"] as? String,
        "digest for vector \(id)")
    }
  }

  // Risk: a snapshot the server issues must decode here. Every canonical
  // snapshot fixture is decoded and its digest verified, so a contract shape the
  // SDK cannot read is caught in CI rather than in production.
  func testEveryCanonicalSnapshotFixtureDecodesWithAValidDigest() throws {
    let names = try authoritativeEntitlementFixtureNames(in: "snapshots")
    XCTAssertGreaterThanOrEqual(names.count, 13)

    for name in names {
      let data = try authoritativeEntitlementFixtureData("snapshots/\(name)")
      let decoded = try MosaicCustomerEntitlementCodec.decode(data)
      XCTAssertTrue(decoded.contentDigestValid, "digest for \(name)")
      XCTAssertEqual(decoded.binding.contractVersion, "1", "binding for \(name)")
    }
  }

  // Risk: the never-projected answer is version zero, but it is not a snapshot
  // of inactive access. Rejecting it leaves a newly identified customer with no
  // cache; accepting any non-empty version-zero shape would let projected state
  // masquerade as the placeholder reserved by the contract.
  func testVersionZeroIsAcceptedOnlyAsTheNeverProjectedPlaceholder() throws {
    let decoded = try MosaicCustomerEntitlementCodec.decode(
      neverProjectedEntitlementPlaceholderData())
    guard case .snapshot(let snapshot) = decoded.record else {
      return XCTFail("expected a snapshot")
    }
    XCTAssertTrue(decoded.contentDigestValid)
    XCTAssertEqual(snapshot.snapshotVersion, 0)
    XCTAssertEqual(snapshot.projectionStatus.state, .pending)
    XCTAssertTrue(snapshot.entries.isEmpty)
    XCTAssertTrue(snapshot.sources.isEmpty)
    XCTAssertNil(snapshot.previousSnapshotVersion)

    let invalid = try authoritativeEntitlementSnapshotVariant { payload in
      payload["snapshotVersion"] = 0
    }
    XCTAssertThrowsError(try MosaicCustomerEntitlementCodec.decode(invalid)) { error in
      XCTAssertEqual(
        (error as? MosaicCustomerEntitlementDecodingError)?.diagnosticCode,
        "entitlement_invalid_never_projected_placeholder")
    }
  }

  // Risk: version zero is admitted only on the full snapshot record where its
  // pending/empty constraints can be checked. A zero-valued confirmation would
  // slide freshness for a placeholder the contract says must be re-issued.
  func testSnapshotUnchangedStillRejectsVersionZero() throws {
    guard
      var root = try JSONSerialization.jsonObject(
        with: authoritativeEntitlementFixtureData("snapshots/snapshot-unchanged.json"))
        as? [String: Any],
      var payload = root["payload"] as? [String: Any]
    else { throw CanonicalFixtureLookupError.invalidShape }
    payload["snapshotVersion"] = 0
    root["payload"] = payload

    XCTAssertThrowsError(
      try MosaicCustomerEntitlementCodec.decode(JSONSerialization.data(withJSONObject: root)))
  }

  // Risk: the three behavioural fixtures encode product decisions that are easy
  // to get wrong and expensive when wrong: telling a lifetime purchaser their
  // access expires, and treating billing retry as if it granted access.
  func testPermanentSourceReportsNoFiniteExpiry() throws {
    let snapshot = try snapshotFixture("permanent-source-no-finite-expiry.json")
    let entry = try XCTUnwrap(snapshot.entries.first)
    XCTAssertEqual(entry.state, .active)
    XCTAssertTrue(entry.endKnown, "a permanent Entitlement has a known end: there isn't one")
    XCTAssertNil(entry.effectiveEnd, "a permanent Entitlement must not report an expiry")
  }

  func testBillingRetryWithheldAccessIsNotActive() throws {
    let snapshot = try snapshotFixture("billing-retry-access-withheld.json")
    let entry = try XCTUnwrap(snapshot.entries.first)
    XCTAssertNotEqual(entry.state, .active)
  }

  func testMultipleActiveSourcesAreAllCarried() throws {
    let snapshot = try snapshotFixture("multiple-active-sources.json")
    let entry = try XCTUnwrap(snapshot.entries.first)
    XCTAssertGreaterThan(entry.sourceCount, 1)
    XCTAssertEqual(entry.sourceCount, entry.sourceIDs.count)
    for id in entry.sourceIDs { XCTAssertNotNil(snapshot.source(id: id)) }
  }

  // Risk: a Google license-tester purchase arrives as an ordinary production
  // transaction and is distinguishable only by this flag. Losing it in the
  // decoder makes a test grant indistinguishable from a paid one.
  func testTestSourceFlagSurvivesToTheCheckResult() throws {
    let snapshot = try snapshotFixture("test-source-sandbox-grant.json")
    let key = try XCTUnwrap(snapshot.entries.first?.entitlementKey)
    XCTAssertTrue(snapshot.check(key: key, cacheState: .fresh).isTestSource)
  }

  // Risk: absence is not a statement Mosaic made. A snapshot can omit a key
  // because the Project does not define it, because the projection could not
  // resolve it, or because the request narrowed the response with
  // `requestedEntitlementKeys`. Reading any of those as `inactive` would deny
  // access Mosaic never denied — and would do it silently, because the snapshot
  // itself looks perfectly healthy.
  func testEntitlementKeyAbsentFromASnapshotReadsUnknownNeverInactive() throws {
    let snapshot = try snapshotFixture("active-subscription.json")
    XCTAssertNil(snapshot.entry(forKey: "pro_lifetime"), "the fixture carries only `pro`")

    let check = snapshot.check(key: "pro_lifetime", cacheState: .fresh)

    guard case .unknown(let uncertainty) = check.state else {
      return XCTFail("an absent key must read unknown, got \(check.state)")
    }
    XCTAssertNotEqual(check.state, .inactive)
    XCTAssertNotEqual(
      uncertainty.reason, .none, "an unknown state must stay explainable")
    // A present key on the same snapshot still answers definitely, so this is not
    // a blanket downgrade of every answer.
    XCTAssertEqual(snapshot.check(key: "pro", cacheState: .fresh).state, .active)
  }

  // Risk: an entry that *is* present and says inactive is the one case where
  // inactive is legitimate — Mosaic looked, found no qualifying source, and is
  // confident. Losing this would make the state unreachable and every paywall
  // decision fall back to unknown.
  func testPresentInactiveEntryStillReadsInactive() throws {
    let snapshot = try snapshotFixture("inactive-expired-subscription.json")
    let key = try XCTUnwrap(snapshot.entries.first?.entitlementKey)
    XCTAssertEqual(snapshot.check(key: key, cacheState: .fresh).state, .inactive)
  }

  // Risk: the whole point of a closed reader. Each invalid fixture is a shape
  // the SDK must refuse; accepting one means acting on a document the contract
  // says is meaningless.
  func testEveryInvalidSnapshotShapedFixtureIsRejected() throws {
    // Fixtures for record types this SDK never reads on its sync surface
    // (subscription snapshots, check results, restore results are server and
    // backend surfaces). They are still rejected here, but by the record-type
    // gate rather than by the rule each one is named for, so asserting the
    // specific reason would be misleading.
    let otherRecordTypes: Set<String> = [
      "check-result-unknown-without-uncertainty.json",
      "paused-on-apple-app-store.json",
      "restore-restored-without-snapshot-version.json",
      "revoked-subscription-missing-revocation-time.json",
      "revoked-subscription-reports-active-access.json",
      "subscription-carries-provider-status-string.json",
      "subscription-checksum-mismatch.json",
      "unknown-access-state-without-uncertainty.json",
    ]
    let names = try authoritativeEntitlementFixtureNames(in: "invalid")
      .filter { $0 != "rejection-layers.json" }
    XCTAssertGreaterThanOrEqual(names.count, 26)

    for name in names {
      let data = try authoritativeEntitlementFixtureData("invalid/\(name)")
      if otherRecordTypes.contains(name) {
        // Still refused, just by the envelope gate.
        XCTAssertThrowsError(try MosaicCustomerEntitlementCodec.decode(data), name)
        continue
      }
      if name == "snapshot-carries-signed-payload-value.json" {
        // A producer-side rule, not a reader obligation. The offending value is
        // a correlationId shaped like a JWS; it satisfies the identifier
        // pattern, so refusing it would mean the SDK guessing at whether an
        // opaque handle "looks signed". The contract's reader sequence rejects
        // unknown versions, record types, fields, and enumeration members —
        // this is none of those, and the semantic validator that owns the rule
        // runs against the producer.
        XCTAssertNoThrow(try MosaicCustomerEntitlementCodec.decode(data), name)
        continue
      }
      if name == "different-customer-rejected.json"
        || name == "older-snapshot-version-rejected.json"
      {
        // Both are semantic rejections that the *acceptance gate* owns, not the
        // decoder: one is a digest computed over a different customer, the other
        // a version that regresses against a cached predecessor. They must
        // decode so the gate can diagnose them precisely.
        let decoded = try MosaicCustomerEntitlementCodec.decode(data)
        if name == "different-customer-rejected.json" {
          XCTAssertFalse(
            decoded.contentDigestValid,
            "a digest over a different billingCustomerId must not verify")
        }
        continue
      }
      XCTAssertThrowsError(try MosaicCustomerEntitlementCodec.decode(data), name)
    }
  }

  // Risk: keys are Project data. Rejecting an unrecognized one would make
  // defining a new Entitlement a breaking change for every shipped SDK.
  func testUnrecognizedEntitlementKeyIsAcceptedAsProjectData() throws {
    let mutated = try mutatedSnapshot("active-subscription.json") { payload in
      var entries = payload["entries"] as! [[String: Any]]
      entries[0]["entitlementKey"] = "some_key_this_sdk_has_never_heard_of"
      payload["entries"] = entries
    }
    let decoded = try MosaicCustomerEntitlementCodec.decode(mutated)
    guard case .snapshot(let snapshot) = decoded.record else { return XCTFail("expected snapshot") }
    XCTAssertEqual(snapshot.entries.first?.entitlementKey, "some_key_this_sdk_has_never_heard_of")
    // The digest was recomputed over mutated bytes, so it must now fail: this
    // also proves the digest actually covers entry content.
    XCTAssertFalse(decoded.contentDigestValid)
  }

  // Risk: an unknown enumeration member means the document was written by a
  // producer this reader does not understand. Silently mapping it to a default
  // would act on a state the SDK cannot reason about.
  func testUnknownEnumerationMemberRejectsTheWholeRecord() throws {
    let mutated = try mutatedSnapshot("active-subscription.json") { payload in
      payload["changeReason"] = "some_future_reason"
    }
    XCTAssertThrowsError(try MosaicCustomerEntitlementCodec.decode(mutated))
  }

  func testUnknownFieldRejectsTheWholeRecord() throws {
    let mutated = try mutatedSnapshot("active-subscription.json") { payload in
      payload["somethingNew"] = "value"
    }
    XCTAssertThrowsError(try MosaicCustomerEntitlementCodec.decode(mutated))
  }

  // Risk: a device that accepted a 60-day offline horizon would serve access
  // Mosaic never confirmed for two months. The bound is on the composition, not
  // on either field alone, and it is enforced on the unchanged response too.
  func testCombinedCacheHorizonIsBounded() throws {
    let mutated = try mutatedSnapshot("bounded-offline-cache.json") { payload in
      payload["validUntil"] = "2026-08-27T12:00:00.000Z"
      payload["staleGraceSeconds"] = 2_592_000
    }
    XCTAssertThrowsError(try MosaicCustomerEntitlementCodec.decode(mutated)) { error in
      XCTAssertEqual(
        (error as? MosaicCustomerEntitlementDecodingError)?.diagnosticCode,
        "entitlement_cache_horizon_exceeds_maximum")
    }
  }

  func testSnapshotUnchangedDecodes() throws {
    let decoded = try MosaicCustomerEntitlementCodec.decode(
      try authoritativeEntitlementFixtureData("snapshots/snapshot-unchanged.json"))
    guard case .unchanged(let confirmation) = decoded.record else {
      return XCTFail("expected an unchanged confirmation")
    }
    XCTAssertEqual(confirmation.snapshotVersion, 4)
    XCTAssertEqual(confirmation.billingCustomerID, "fixture-customer-0001")
  }

  // MARK: Helpers

  private func snapshotFixture(_ name: String) throws -> MosaicCustomerEntitlementSnapshot {
    let decoded = try MosaicCustomerEntitlementCodec.decode(
      try authoritativeEntitlementFixtureData("snapshots/\(name)"))
    guard case .snapshot(let snapshot) = decoded.record else {
      throw CanonicalFixtureLookupError.invalidShape
    }
    return snapshot
  }

  private func mutatedSnapshot(
    _ name: String, _ mutation: (inout [String: Any]) -> Void
  ) throws -> Data {
    guard
      var root = try JSONSerialization.jsonObject(
        with: try authoritativeEntitlementFixtureData("snapshots/\(name)")) as? [String: Any],
      var payload = root["payload"] as? [String: Any]
    else { throw CanonicalFixtureLookupError.invalidShape }
    mutation(&payload)
    root["payload"] = payload
    return try JSONSerialization.data(withJSONObject: root)
  }
}
