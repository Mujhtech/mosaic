package billingprojection

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// Canonical ordering, version 1 (plan §8). There is exactly one
// implementation, because two orderings that agree today would eventually
// disagree, and a projection that disagrees with its own replay is
// indistinguishable from data loss.
//
// The tuple is:
//
//	(effective_at, fact_kind_precedence, provider_transaction_id,
//	 occurred_at, recorded_at, fact_id)
//
// `effective_at` is the provider-stated instant at which the fact takes
// effect, which is not always `occurred_at`: a refund is effective at the
// provider's refund time, an expiration at the period end. Received and
// recorded times are late tie-breakers only — sorting by them would make
// arrival order the truth, which is exactly what the failure model forbids.
//
// Google's compensation: every fact in a Google lineage shares
// occurred_at = startTime, so `occurred_at` alone ties for the whole lineage.
// The recovered provider event time (fact-shape v2) is used as the effective
// time wherever the fact kind has no more specific one, which is what breaks
// the tie with a provider statement rather than with arrival order.

// factKindPrecedence orders facts that share an effective instant.
//
// The ranking answers one question: if two provider statements take effect at
// the same instant, which one describes the later state? Terminal statements
// (revocation, refund, expiration) rank last so a purchase and its revocation
// stamped with the same timestamp do not project as active. Intent-only
// changes rank before state changes because they never move access on their
// own.
func factKindPrecedence(kind string) int {
	switch kind {
	case "initial_purchase":
		return 10
	case "offer_redeemed":
		return 20
	case "renewal":
		return 30
	case "one_time_purchase":
		return 35
	case "plan_change":
		return 40
	case "auto_renew_enabled":
		return 50
	case "auto_renew_disabled":
		return 55
	case "cancellation_scheduled":
		return 60
	case "resumed":
		return 65
	case "paused":
		return 70
	case "grace_period_start":
		return 75
	case "billing_retry_start":
		return 80
	case "purchase_superseded":
		return 85
	case "expiration":
		return 90
	case "refund":
		return 95
	case "revocation":
		return 100
	default:
		// An unrecognized kind sorts last within its instant rather than
		// first: an unknown statement must not be able to precede — and so
		// mask — a known terminal one.
		return 110
	}
}

// EffectiveAt is the instant a fact takes effect (plan §8). It is a total
// function: every fact has an effective time, because a fact that could not be
// placed on the timeline could not be ordered deterministically.
func EffectiveAt(fact Fact) time.Time {
	switch fact.FactKind {
	case "revocation":
		if fact.RevokedAt != nil {
			return fact.RevokedAt.UTC()
		}
	case "refund":
		if fact.RefundedAt != nil {
			return fact.RefundedAt.UTC()
		}
		if fact.RevokedAt != nil {
			return fact.RevokedAt.UTC()
		}
	case "expiration":
		// An expiration takes effect when the period ended, not when the
		// provider got around to saying so.
		if fact.PeriodEndAt != nil {
			return fact.PeriodEndAt.UTC()
		}
	case "grace_period_start":
		if fact.PeriodEndAt != nil {
			// Grace begins where the paid period ended.
			return fact.PeriodEndAt.UTC()
		}
	case "renewal", "initial_purchase", "one_time_purchase", "offer_redeemed":
		if fact.PeriodStartAt != nil {
			return fact.PeriodStartAt.UTC()
		}
	case "cancellation_scheduled", "auto_renew_disabled", "auto_renew_enabled", "plan_change":
		// Intent changes take effect when the provider observed them, which
		// for Google is the RTDN event time rather than the lineage-constant
		// startTime.
		if fact.ProviderEventOccurredAt != nil {
			return fact.ProviderEventOccurredAt.UTC()
		}
	case "paused", "resumed", "billing_retry_start", "purchase_superseded":
		if fact.ProviderEventOccurredAt != nil {
			return fact.ProviderEventOccurredAt.UTC()
		}
	}
	if fact.ProviderEventOccurredAt != nil && fact.Provider == "google_play" {
		// Google facts share occurred_at across a lineage; the recovered event
		// time is the only provider statement that distinguishes them.
		return fact.ProviderEventOccurredAt.UTC()
	}
	return fact.OccurredAt.UTC()
}

// Sort orders facts canonically in place and returns the same slice. Sorting
// is stable under the full tuple, so equal inputs order identically on every
// run and on every machine.
func Sort(facts []Fact) []Fact {
	sort.SliceStable(facts, func(i, j int) bool {
		return less(facts[i], facts[j])
	})
	return facts
}

func less(a, b Fact) bool {
	if effectiveA, effectiveB := EffectiveAt(a), EffectiveAt(b); !effectiveA.Equal(effectiveB) {
		return effectiveA.Before(effectiveB)
	}
	if precedenceA, precedenceB := factKindPrecedence(a.FactKind), factKindPrecedence(b.FactKind); precedenceA != precedenceB {
		return precedenceA < precedenceB
	}
	if a.ProviderTransactionID != b.ProviderTransactionID {
		return a.ProviderTransactionID < b.ProviderTransactionID
	}
	if !a.OccurredAt.Equal(b.OccurredAt) {
		return a.OccurredAt.Before(b.OccurredAt)
	}
	if !a.RecordedAt.Equal(b.RecordedAt) {
		return a.RecordedAt.Before(b.RecordedAt)
	}
	return a.ID < b.ID
}

// Position is the canonical ordering position of one fact, encoded so it can
// be stored in a checkpoint and compared later without reloading the fact.
//
// The ordering version is part of the encoding: a checkpoint written under one
// ordering is not comparable with a position computed under another, and
// silently comparing them would make an ordering change look like an
// out-of-order fact for every lineage at once.
func Position(fact Fact) string {
	return fmt.Sprintf("v%d|%020d|%03d|%s|%020d|%s",
		OrderingVersion,
		EffectiveAt(fact).UnixMilli(),
		factKindPrecedence(fact.FactKind),
		fact.ProviderTransactionID,
		fact.OccurredAt.UnixMilli(),
		fact.ID)
}

// HighWatermark is the position of the last fact in a canonically ordered
// slice. An empty slice has an empty watermark, which sorts before every real
// position and so makes a first projection indistinguishable from a full
// replay — the property that lets replay ignore checkpoints safely.
func HighWatermark(ordered []Fact) string {
	if len(ordered) == 0 {
		return ""
	}
	return Position(ordered[len(ordered)-1])
}

// OutOfOrder reports whether any fact in the (canonically ordered) slice
// belongs at or before the checkpoint's high watermark. Such a fact means the
// checkpoint no longer describes a prefix of the timeline, so it must be
// invalidated and the lineage reprojected from zero rather than resumed.
//
// It returns the earliest offending position so the caller can name the fact
// in a diagnostic instead of reporting only that something was late.
func OutOfOrder(ordered []Fact, watermark string) (string, bool) {
	if watermark == "" {
		return "", false
	}
	if !strings.HasPrefix(watermark, fmt.Sprintf("v%d|", OrderingVersion)) {
		// A watermark from another ordering version cannot be compared. It is
		// reported as out-of-order so the lineage reprojects from zero, which
		// is the conservative and correct response to an ordering change.
		return watermark, true
	}
	for _, fact := range ordered {
		if position := Position(fact); position <= watermark {
			return position, true
		}
	}
	return "", false
}

// After returns the facts strictly after the watermark, preserving canonical
// order. Callers that have detected out-of-order arrival must not use it: the
// checkpoint is invalid and the whole lineage is reprojected instead.
func After(ordered []Fact, watermark string) []Fact {
	if watermark == "" {
		return ordered
	}
	for index, fact := range ordered {
		if Position(fact) > watermark {
			return ordered[index:]
		}
	}
	return nil
}
