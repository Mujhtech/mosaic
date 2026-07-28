package billingrestore

// Decision is the answer for one attempt at one restore job.
//
// Its snapshot evidence is unexported and there is exactly one constructor that
// sets it. That is the structural half of the central invariant: a Decision
// assembled anywhere else — including a struct literal that names
// OutcomeRestored — carries no evidence, so SnapshotVersion returns zero and
// Validate refuses it before a row is ever written. The schema's CHECK
// constraint then catches what neither of those did, which is the order the
// defences should be in rather than the reverse.
type Decision struct {
	// Outcome is Mosaic's authoritative answer on the contract's vocabulary.
	Outcome string
	// UncertaintyReason explains every outcome that is not definite. The schema
	// requires it to be something other than `none` for those, and the contract
	// requires the matching `uncertainty` member.
	UncertaintyReason string
	// PendingValidationCount is carried on the decision because the contract
	// requires it whenever the outcome is validation_pending.
	PendingValidationCount int
	// Terminal reports that no further attempt can change this answer. A
	// non-terminal decision is rescheduled with backoff until the attempt
	// budget runs out, at which point the last non-terminal answer becomes the
	// reported one — honestly uncertain rather than falsely definite.
	Terminal bool

	// evidence is the accepted snapshot version that demonstrates a restore. It
	// is set by restoredBy and by nothing else.
	evidence int64
}

// SnapshotVersion is the accepted snapshot that proves the restore. It returns
// zero for every outcome but `restored`, so no other outcome can smuggle a
// version onto its row and no forged `restored` can carry one.
func (d Decision) SnapshotVersion() int64 {
	if d.Outcome != OutcomeRestored {
		return 0
	}
	return d.evidence
}

// Validate refuses a decision that would write a lie.
//
// It is called by the service before every completion, and by the repository
// before every write, because the whole point of the table is that this pairing
// is never wrong.
func (d Decision) Validate() error {
	switch d.Outcome {
	case OutcomeRestored:
		// Never report restored before an authoritative snapshot reflects the
		// source.
		if d.evidence < 1 {
			return ErrUnprovenRestore
		}
		if d.UncertaintyReason != ReasonNone {
			return ErrInvalidOutcome
		}
	case OutcomeNoAdditionalPurchases:
		if d.UncertaintyReason != ReasonNone {
			return ErrInvalidOutcome
		}
	case OutcomeValidationPending, OutcomeIdentityUnresolved, OutcomeProductUnresolved,
		OutcomeProviderUnavailable, OutcomeFailed:
		// Every non-definite outcome stays explainable.
		if d.UncertaintyReason == "" || d.UncertaintyReason == ReasonNone {
			return ErrInvalidOutcome
		}
	default:
		return ErrInvalidOutcome
	}
	return nil
}

// restoredBy is the only constructor that can produce a `restored` decision.
//
// It refuses unless there is a baseline to have moved past, the observed
// version is a real accepted snapshot, and it is strictly greater than the
// baseline. A restore whose customer had version 5 before and still has version
// 5 restored nothing, however successfully the native restore returned.
func restoredBy(baseline *int64, observed int64) (Decision, bool) {
	if baseline == nil || observed < 1 || observed <= *baseline {
		return Decision{}, false
	}
	return Decision{
		Outcome:           OutcomeRestored,
		UncertaintyReason: ReasonNone,
		Terminal:          true,
		evidence:          observed,
	}, true
}

func uncertain(outcome, reason string, pending int, terminal bool) Decision {
	return Decision{
		Outcome:                outcome,
		UncertaintyReason:      reason,
		PendingValidationCount: pending,
		Terminal:               terminal,
	}
}

// Decide maps one chain state onto one outcome. It is pure: it reads no clock,
// touches no database, and is the single place the chain-state-to-outcome table
// lives.
//
// The rules are ordered, first match wins, and the order is the order the chain
// itself runs in. Judging identity before validation has settled would report
// `identity_unresolved` for a customer whose facts simply had not landed yet;
// judging the snapshot before identity would compare versions on a customer
// that does not exist.
//
// Only three outcomes are terminal on sight — `restored`,
// `no_additional_purchases`, and `failed` — because only those three cannot
// become something else on a later attempt. The rest describe a chain that is
// still moving, and are reported as the final answer only once the attempt
// budget is spent.
func Decide(job Job, chain ChainState) Decision {
	pending := chain.PendingValidationCount

	switch {
	// A dead-lettered projection is the one failure that is Mosaic's own and
	// cannot clear itself.
	case chain.ProjectionFailed:
		return uncertain(OutcomeFailed, ReasonProjectionFailed, pending, true)

	// A real identity conflict is quarantined: Mosaic grants neither claimant
	// automatically and an operator resolves it (OD-10). It is terminal because
	// no retry resolves it, and the row keeps no customer when none was ever
	// resolved — which is what the schema's identity CHECK requires.
	case chain.IdentityConflict && chain.CustomerID == "":
		return uncertain(OutcomeIdentityUnresolved, ReasonConflictingFacts, pending, true)
	case chain.IdentityConflict:
		return uncertain(OutcomeFailed, ReasonConflictingFacts, pending, true)

	// The purchase is real and validated but names a Product Mosaic cannot map,
	// so no Entitlement can be granted for it. An operator mapping the Product
	// clears this, so it is not terminal while attempts remain.
	case chain.ProductUnresolved:
		return uncertain(OutcomeProductUnresolved, ReasonProductUnresolved, pending, false)

	// Validation is still running. Whether the wait is on the store or on
	// Mosaic is the difference between provider_unavailable and
	// validation_pending, and it is a difference a caller acts on.
	case pending > 0 && chain.ProviderUnavailable:
		return uncertain(OutcomeProviderUnavailable, ReasonProviderUnavailable, pending, false)
	case pending > 0:
		return uncertain(OutcomeValidationPending, ReasonMissingFact, pending, false)

	// Validation settled and something in it permanently failed.
	case chain.PermanentFailure:
		return uncertain(OutcomeFailed, ReasonUnsupportedProviderState, pending, true)

	// Validation settled with no customer. Now — and only now — the absence of
	// an identity is an answer rather than a race.
	case chain.CustomerID == "":
		if chain.FactCount == 0 && job.ObservedTransactionCount == 0 {
			// The native restore found nothing and submitted nothing. There is
			// no identity to resolve because there is nothing to attach.
			return Decision{Outcome: OutcomeNoAdditionalPurchases, UncertaintyReason: ReasonNone, Terminal: true}
		}
		return uncertain(OutcomeIdentityUnresolved, ReasonIdentityUnresolved, pending, false)

	// Nothing was submitted, so nothing can have changed.
	case job.ObservedTransactionCount == 0:
		return Decision{Outcome: OutcomeNoAdditionalPurchases, UncertaintyReason: ReasonNone, Terminal: true}
	}

	// The facts are in and attached. The only question left is whether the
	// authoritative snapshot has moved.
	if decision, ok := restoredBy(job.BaselineSnapshotVersion, chain.SnapshotVersion); ok {
		return decision
	}
	if !chain.ProjectionSettled || job.BaselineSnapshotVersion == nil {
		// Facts exist but the projection that would reflect them has not
		// finished. This is the state a naive implementation reports as
		// restored; it is stale, not restored.
		return uncertain(OutcomeValidationPending, ReasonStaleValidation, pending, false)
	}
	// The projection ran and the customer's version did not move: the restored
	// purchases were ones Mosaic already held. That is a definite, correct
	// answer, and it is not `restored`.
	return Decision{Outcome: OutcomeNoAdditionalPurchases, UncertaintyReason: ReasonNone, Terminal: true}
}

// TerminalStatus maps a decision onto the job status it is stored under.
func TerminalStatus(decision Decision) string {
	if decision.Outcome == OutcomeFailed {
		return StatusFailed
	}
	return StatusCompleted
}
