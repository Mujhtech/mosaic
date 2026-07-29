package billingcustomer

import "github.com/Mujhtech/mosaic/apps/api/internal/billing"

// LineageKey is the digest that identifies one provider purchase chain inside
// one Environment.
//
// Apple's key is the original transaction id: it survives reinstall, clear
// data, and device change, which is what lets a restoring customer resolve
// back to the same purchase-anchored customer rather than a new one.
//
// Google's key is the *root* of the purchase-token chain, walked backwards
// through linkedPurchaseToken. Using the current token instead would mint a
// new lineage on every plan change, and the subscription's whole history
// would fragment into unconnected pieces.
//
// The digest domain is deliberately not this package's own (defect D-1). It
// used to hash under `mosaic-billing-lineage-v1`, while every fact carries a
// `purchase_chain_digest` computed by `billing.AppleTransactionKey` (domain
// `mosaic-billing-apple-transaction-v1`) or `billing.TokenDigest` (plain
// SHA-256) — and every fact-to-lineage join in the codebase compares those two
// values. A lineage keyed with the package's own helper could therefore never
// join to any fact it was created for: the read model was reachable only by
// bypassing this function. The fact's digest domain is the canonical one
// because the facts are the append-only record; the lineage is derived from
// them.
func LineageKey(provider, storeEnvironment string, rootValue string) []byte {
	if provider == billing.ProviderGooglePlay {
		return billing.TokenDigest(rootValue)
	}
	return billing.AppleTransactionKey(storeEnvironment, rootValue)
}

// ChainLink is one observed supersession edge: a successor purchase chain
// digest and the predecessor it linked to.
type ChainLink struct {
	ChainDigest      []byte
	SupersedesDigest []byte
}

// WalkChainRoot resolves the root of a Google purchase-token chain from the
// supersession edges recorded on its facts.
//
// It is bounded and cycle-safe. A cycle cannot occur in provider data, so
// reaching the bound means the data is already wrong, and the safe answer is
// the deepest node reached rather than a hang or a guess at which edge to
// ignore.
func WalkChainRoot(start []byte, links []ChainLink) []byte {
	predecessor := map[string][]byte{}
	for _, link := range links {
		if len(link.ChainDigest) > 0 && len(link.SupersedesDigest) > 0 {
			predecessor[string(link.ChainDigest)] = link.SupersedesDigest
		}
	}
	current := start
	seen := map[string]struct{}{string(start): {}}
	for range 32 {
		next, ok := predecessor[string(current)]
		if !ok {
			return current
		}
		if _, cycled := seen[string(next)]; cycled {
			return current
		}
		seen[string(next)] = struct{}{}
		current = next
	}
	return current
}

// SameLineage reports whether two facts belong to one lineage. It exists so
// the rule has one statement: lineages are joined only by provider-stated
// chain identity, never because two purchases share a Product, a customer, a
// price, or a time window.
func SameLineage(leftChainDigest, rightChainDigest []byte) bool {
	if len(leftChainDigest) == 0 || len(rightChainDigest) == 0 {
		return false
	}
	return string(leftChainDigest) == string(rightChainDigest)
}
