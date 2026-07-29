package billingcustomer

// SameLineage reports whether two facts belong to one lineage. It exists so
// the rule has one statement: lineages are joined only by provider-stated
// chain identity, never because two purchases share a Product, a customer, a
// price, or a time window.
//
// This file used to also carry `LineageKey`, `WalkChainRoot`, and `ChainLink`:
// a second implementation of "derive the chain root and key a lineage on it".
// It had no production caller. The canonical implementation lives in the
// fact-commit transaction (`billingpostgres.materializeLineage` and
// `chainRootDigest`), which resolves the root by walking supersession edges in
// SQL inside the same transaction as the fact — the only place that can do it
// consistently. Two implementations of a persisted digest domain is one edit
// away from lineages that can never join to the facts they were created for,
// which is exactly the shape of defect D-1, so the duplicate is gone rather
// than kept in sync by hand.
func SameLineage(leftChainDigest, rightChainDigest []byte) bool {
	if len(leftChainDigest) == 0 || len(rightChainDigest) == 0 {
		return false
	}
	return string(leftChainDigest) == string(rightChainDigest)
}
