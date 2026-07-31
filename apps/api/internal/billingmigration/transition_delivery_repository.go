package billingmigration

// This file intentionally contains only the transition-delivery port. Keeping
// it separate from Repository avoids coupling the Stage 2B management service
// and its existing tests to Stage 2E worker-only persistence.
