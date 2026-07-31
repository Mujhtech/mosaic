package billingmigration

import (
	"context"
	"time"
)

type CutoverRepository interface {
	PromoteReady(context.Context, string, string, int64, string, time.Time) (AuthoritativeReadiness, error)
	CreateProposal(context.Context, ProposalWrite) (CutoverProposal, bool, error)
	Proposal(context.Context, string, string, string) (CutoverProposal, error)
	ApproveProposal(context.Context, ApprovalWrite) (MigrationApproval, bool, error)
	CreateCheckpoint(context.Context, CheckpointWrite) (MigrationCheckpoint, bool, error)
	ExecuteCutover(context.Context, ExecuteCutoverWrite) (AuthorityExecution, bool, error)
	ExecuteRollback(context.Context, ExecuteRollbackWrite) (AuthorityExecution, bool, error)
}
