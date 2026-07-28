package billingpostgres

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

// T-2 — `keyring rotate` must reach every envelope-bearing table.
//
// The failure this guards is data destruction via a correct runbook: a table
// with an envelope that the rotation source set does not know about reports
// zero envelopes under a retired key, the operator follows the documented
// rotation procedure and removes that key, and those rows become permanently
// undecryptable. The schema half of the test is the durable half — it fails
// when a *future* envelope table is added and not registered, which is exactly
// the case a round-trip over today's two tables cannot catch.
func TestKeyringRotationCoversEveryEnvelopeTable(t *testing.T) {
	pool, ctx := testPool(t)

	// Every table that stores both a key id and a ciphertext is an envelope
	// table and must be rotatable.
	rows, err := pool.Query(ctx,
		`SELECT c.table_name FROM information_schema.columns c
		 WHERE c.table_schema='public' AND c.column_name='key_id'
		   AND EXISTS (SELECT 1 FROM information_schema.columns d
		               WHERE d.table_schema='public' AND d.table_name=c.table_name
		                 AND d.column_name='ciphertext')
		 ORDER BY c.table_name`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	found := map[string]bool{}
	for rows.Next() {
		var table string
		if err := rows.Scan(&table); err != nil {
			t.Fatal(err)
		}
		found[table] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}

	// provider_connection_credentials is rotated by the Provider Connection
	// path in cloudworkspacepostgres; the two billing tables are rotated here.
	rotatable := map[string]bool{
		"provider_connection_credentials": true,
		"store_server_credentials":        true,
		"billing_raw_inputs":              true,
	}
	for table := range found {
		if !rotatable[table] {
			t.Fatalf("table %q stores an encryption envelope but no keyring rotation path covers it; "+
				"add it to billingpostgres.EnvelopesNotUnderKey/ReplaceEnvelopes (or the cloudworkspace "+
				"equivalent) before shipping, or a retired key will silently strand its rows", table)
		}
	}
	for _, required := range []string{"store_server_credentials", "billing_raw_inputs"} {
		if !found[required] {
			t.Fatalf("expected %q to carry an encryption envelope; the schema assertion above is no longer guarding anything", required)
		}
	}
}

// The round-trip half: a credential and a raw body sealed under one key must
// still decrypt after being resealed under another.
func TestKeyringRotationResealsBothBillingTables(t *testing.T) {
	pool, ctx := testPool(t)
	repository := New(pool)
	projectID, environmentID, applicationID := seed(t, ctx, pool, "rotate")
	now := time.Now().UTC()

	var organizationID string
	if err := pool.QueryRow(ctx, `SELECT organization_id FROM projects WHERE id=$1`, projectID).
		Scan(&organizationID); err != nil {
		t.Fatal(err)
	}

	keyA := "3q2-7wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	keyB := "7v7-3QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	underA, err := providercredential.NewAESGCMCipher(
		`{"version":1,"activeKeyId":"key-a","keys":{"key-a":"`+keyA+`","key-b":"`+keyB+`"}}`, randomReader{})
	if err != nil {
		t.Fatal(err)
	}
	underB, err := providercredential.NewAESGCMCipher(
		`{"version":1,"activeKeyId":"key-b","keys":{"key-a":"`+keyA+`","key-b":"`+keyB+`"}}`, randomReader{})
	if err != nil {
		t.Fatal(err)
	}

	credentialID := "ssc_rotate_fixture"
	credentialSecret := []byte("-----BEGIN PRIVATE KEY-----fixture-----END PRIVATE KEY-----")
	credentialScope := providercredential.SubjectScope{
		OrganizationID: organizationID, ProjectID: projectID,
		SubjectKind: providercredential.SubjectStoreServerCredential, SubjectID: credentialID,
		CredentialClass: billing.ClassAppleInAppPurchaseKey,
	}
	sealed, err := underA.EncryptSubject(credentialSecret, credentialScope)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO store_server_credentials(
			id, project_id, organization_id, environment_id, environment_mode, provider, store_environment,
			name, status, health_status, credential_class, envelope_version, algorithm, key_id, nonce,
			ciphertext, fingerprint, apple_issuer_id, apple_key_id, intake_token_digest,
			created_by_actor_id, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,'production','app_store','production','Rotate','active','untested',$5,
			$6,$7,$8,$9::bytea,$10::bytea,$11::bytea,'fixture-issuer','fixture-key',$12::bytea,'actor',$13,$13)`,
		credentialID, projectID, organizationID, environmentID, billing.ClassAppleInAppPurchaseKey,
		sealed.Version, sealed.Algorithm, sealed.KeyID, sealed.Nonce, sealed.Ciphertext, sealed.Fingerprint,
		billing.TokenDigest("fixture-rotate-intake"), now); err != nil {
		t.Fatal(err)
	}

	// A raw input with a retained, sealed body.
	input := sampleInput(projectID, environmentID, applicationID, "fixture-uuid-rotate")
	body := []byte(`{"signedPayload":"fixture-rotate-body"}`)
	bodyEnvelope, err := underA.EncryptSubject(body, providercredential.SubjectScope{
		OrganizationID: organizationID, ProjectID: projectID,
		SubjectKind: providercredential.SubjectBillingRawInput, SubjectID: "bri_rotate_fixture",
		CredentialClass: billing.ClassBillingRawPayload,
	})
	if err != nil {
		t.Fatal(err)
	}
	input.ID = "bri_rotate_fixture"
	input.OrganizationID = organizationID
	input.BodyState = "stored"
	input.Envelope = &billing.Envelope{
		Version: bodyEnvelope.Version, Algorithm: bodyEnvelope.Algorithm, KeyID: bodyEnvelope.KeyID,
		Nonce: bodyEnvelope.Nonce, Ciphertext: bodyEnvelope.Ciphertext, Fingerprint: bodyEnvelope.Fingerprint,
	}
	if _, err := repository.PersistRawInput(ctx, input, false, now); err != nil {
		t.Fatal(err)
	}

	// inspect must see both under the retired key.
	counts, err := repository.EnvelopeCountsByKeyID(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if counts["key-a"] < 2 {
		t.Fatalf("keyring inspect reports %d envelope(s) under the retired key, want at least 2 "+
			"(a credential and a raw body); an under-report is what makes a documented rotation destructive", counts["key-a"])
	}

	// rotate: page, reseal under key B, write back.
	envelopes, err := repository.EnvelopesNotUnderKey(ctx, "key-b", 100)
	if err != nil {
		t.Fatal(err)
	}
	tables := map[string]bool{}
	resealed := make([]BillingEnvelope, 0, len(envelopes))
	for _, envelope := range envelopes {
		tables[envelope.Table] = true
		plaintext, err := underB.DecryptSubject(providercredential.Envelope{
			Version: envelope.Version, Algorithm: envelope.Algorithm, KeyID: envelope.KeyID,
			Nonce: envelope.Nonce, Ciphertext: envelope.Ciphertext,
			CredentialClass: envelope.CredentialClass, Fingerprint: envelope.Fingerprint,
		}, envelope.Scope())
		if err != nil {
			t.Fatalf("%s/%s could not be decrypted during rotation: %v", envelope.Table, envelope.RowID, err)
		}
		sealed, err := underB.EncryptSubject(plaintext, envelope.Scope())
		if err != nil {
			t.Fatal(err)
		}
		envelope.Version, envelope.Algorithm, envelope.KeyID = sealed.Version, sealed.Algorithm, sealed.KeyID
		envelope.Nonce, envelope.Ciphertext, envelope.Fingerprint = sealed.Nonce, sealed.Ciphertext, sealed.Fingerprint
		resealed = append(resealed, envelope)
	}
	if !tables["store_server_credentials"] || !tables["billing_raw_inputs"] {
		t.Fatalf("rotation paged over %v; both billing envelope tables must appear", tables)
	}
	if err := repository.ReplaceEnvelopes(ctx, resealed, now); err != nil {
		t.Fatal(err)
	}

	// Both must still open, now under the new key.
	credential, envelope, class, orgID, _, err := repository.CredentialSecretFor(ctx, projectID, credentialID)
	if err != nil {
		t.Fatal(err)
	}
	if envelope.KeyID != "key-b" {
		t.Fatalf("credential still sealed under %q after rotation", envelope.KeyID)
	}
	opened, err := underB.DecryptSubject(providercredential.Envelope{
		Version: envelope.Version, Algorithm: envelope.Algorithm, KeyID: envelope.KeyID,
		Nonce: envelope.Nonce, Ciphertext: envelope.Ciphertext,
		CredentialClass: class, Fingerprint: envelope.Fingerprint,
	}, providercredential.SubjectScope{
		OrganizationID: orgID, ProjectID: projectID,
		SubjectKind: providercredential.SubjectStoreServerCredential, SubjectID: credential.ID,
		CredentialClass: class,
	})
	if err != nil || string(opened) != string(credentialSecret) {
		t.Fatalf("credential did not survive rotation: %v", err)
	}

	stored, err := repository.RawInput(ctx, projectID, input.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Envelope == nil || stored.Envelope.KeyID != "key-b" {
		t.Fatal("raw body was not resealed under the new key")
	}
	openedBody, err := underB.DecryptSubject(providercredential.Envelope{
		Version: stored.Envelope.Version, Algorithm: stored.Envelope.Algorithm, KeyID: stored.Envelope.KeyID,
		Nonce: stored.Envelope.Nonce, Ciphertext: stored.Envelope.Ciphertext,
		CredentialClass: billing.ClassBillingRawPayload, Fingerprint: stored.Envelope.Fingerprint,
	}, providercredential.SubjectScope{
		OrganizationID: organizationID, ProjectID: projectID,
		SubjectKind: providercredential.SubjectBillingRawInput, SubjectID: input.ID,
		CredentialClass: billing.ClassBillingRawPayload,
	})
	if err != nil || string(openedBody) != string(body) {
		t.Fatalf("raw body did not survive rotation: %v", err)
	}
}

// randomReader is a deterministic nonce source. Nonce uniqueness is not what
// these tests are about, and a fixed source keeps them reproducible.
type randomReader struct{}

func (randomReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = byte(i*7 + 3)
	}
	return len(p), nil
}

// BL-2 — a live lease must never be stolen.
//
// Without the guard, an operator's quarantine retry could take the lease while
// ProcessNextValidation was mid-flight inside a provider call. Both paths would
// then read the same NextAttemptNumber, one CompleteAttempt would abort on
// UNIQUE (raw_input_id, attempt_number), and the losing side would discard its
// attempt, fact, resolution snapshot and ledger entries while reporting a
// failure it did not cause.
func TestLeaseValidationJobForDoesNotStealALiveLease(t *testing.T) {
	pool, ctx := testPool(t)
	repository := New(pool)
	projectID, environmentID, applicationID := seed(t, ctx, pool, "lease")
	now := time.Now().UTC()

	input := sampleInput(projectID, environmentID, applicationID, "fixture-uuid-lease")
	// ReplayInputs only returns inputs whose body is retained, because an
	// expired body cannot be revalidated.
	input.BodyState = "stored"
	input.Envelope = &billing.Envelope{
		Version: 1, Algorithm: "AES-256-GCM", KeyID: "key-a",
		Nonce: make([]byte, 12), Ciphertext: make([]byte, 32), Fingerprint: make([]byte, 32),
	}
	if _, err := repository.PersistRawInput(ctx, input, true, now); err != nil {
		t.Fatal(err)
	}
	stored, err := repository.ReplayInputsForTest(ctx, projectID, environmentID)
	if err != nil || len(stored) != 1 {
		t.Fatalf("expected one stored input, got %d (%v)", len(stored), err)
	}
	held := stored[0]

	// The ordinary worker takes the lease first.
	leased, ok, err := repository.LeaseValidationJob(ctx, "worker-a", now, now.Add(2*time.Minute))
	if err != nil || !ok {
		t.Fatalf("worker-a could not lease: ok=%v err=%v", ok, err)
	}

	// A replay or quarantine retry now asks for the same input while the lease
	// is live. It must be refused.
	if _, err := repository.LeaseValidationJobFor(ctx, "worker-b", held, now, now.Add(2*time.Minute)); err != billing.ErrValidationBusy {
		t.Fatalf("a live lease was stolen: err=%v", err)
	}

	// The original lease is untouched.
	var owner string
	if err := pool.QueryRow(ctx, `SELECT lease_owner FROM billing_validation_jobs WHERE id=$1`, leased.ID).
		Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if owner != "worker-a" {
		t.Fatalf("lease owner is %q, want worker-a", owner)
	}

	// Once the lease has expired, takeover is correct: a worker that died must
	// not strand the input forever.
	afterExpiry := now.Add(3 * time.Minute)
	if _, err := repository.LeaseValidationJobFor(ctx, "worker-b", held, afterExpiry, afterExpiry.Add(2*time.Minute)); err != nil {
		t.Fatalf("an expired lease was not taken over: %v", err)
	}
}

// BL-3 — reconciliation discovery must persist in a staging Environment.
//
// The mode was previously derived from the Store Environment, which yields only
// "production" or "development", so every discovery in a staging Environment
// failed the composite FK onto environments(id, project_id, mode), incremented
// a failure counter silently, and left the run reporting `partial` with no
// diagnostic — the recovery path failing in exactly the outage it exists to
// repair.
func TestReconciliationDiscoveryPersistsInStagingEnvironment(t *testing.T) {
	pool, ctx := testPool(t)
	repository := New(pool)
	projectID, _, applicationID := seed(t, ctx, pool, "staging")
	now := time.Now().UTC()

	stagingID := "env_billing_staging_extra"
	if _, err := pool.Exec(ctx,
		`INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at)
		 VALUES ($1,$2,'staging','Staging','staging',$3,$3) ON CONFLICT (id) DO NOTHING`,
		stagingID, projectID, now); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupContext, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_, _ = pool.Exec(cleanupContext, `DELETE FROM billing_validation_jobs WHERE environment_id=$1`, stagingID)
		_, _ = pool.Exec(cleanupContext, `DELETE FROM billing_ledger_entries WHERE environment_id=$1`, stagingID)
		_, _ = pool.Exec(cleanupContext, `DELETE FROM billing_raw_inputs WHERE environment_id=$1`, stagingID)
		_, _ = pool.Exec(cleanupContext, `DELETE FROM environments WHERE id=$1`, stagingID)
	})

	mode, organizationID, err := repository.EnvironmentScope(ctx, projectID, stagingID)
	if err != nil {
		t.Fatal(err)
	}
	if mode != "staging" {
		t.Fatalf("EnvironmentScope reported mode %q, want staging", mode)
	}

	// A sandbox-classified discovery inside a staging Environment: the exact
	// combination the derived mode could not express.
	input := sampleInput(projectID, stagingID, applicationID, "fixture-uuid-staging")
	input.EnvironmentMode = mode
	input.OrganizationID = organizationID
	input.StoreEnvironment = billing.StoreSandbox
	input.Source = billing.SourceAppleNotificationHistory
	input.SourceAuthority = billing.AuthorityStoreReconciliation
	result, err := repository.PersistRawInput(ctx, input, true, now)
	if err != nil {
		t.Fatalf("a staging reconciliation discovery could not be persisted: %v", err)
	}
	if result.Status != billing.IngestAccepted {
		t.Fatalf("discovery status %q, want accepted", result.Status)
	}
}

// BL-4 — a window larger than one batch must be walked to the end.
//
// Reporting `completed` over a silently partial scan is worse than a failure in
// an evidence system: the operator concludes the window is verified. The cursor
// is a keyset over (received_at, id), so this also pins that resuming neither
// skips nor repeats a row.
func TestReplayInputsWalkTheWholeWindowByCursor(t *testing.T) {
	pool, ctx := testPool(t)
	repository := New(pool)
	projectID, environmentID, applicationID := seed(t, ctx, pool, "cursor")
	base := time.Now().UTC().Add(-time.Hour)

	const total = 7
	for index := range total {
		input := sampleInput(projectID, environmentID, applicationID,
			"fixture-uuid-cursor-"+strings.Repeat("x", index+1))
		input.ReceivedAt = base.Add(time.Duration(index) * time.Second)
		input.ExpiresAt = input.ReceivedAt.Add(90 * 24 * time.Hour)
		input.BodyState = "stored"
		input.Envelope = &billing.Envelope{
			Version: 1, Algorithm: "AES-256-GCM", KeyID: "key-a",
			Nonce: make([]byte, 12), Ciphertext: make([]byte, 32), Fingerprint: make([]byte, 32),
		}
		if _, err := repository.PersistRawInput(ctx, input, false, input.ReceivedAt); err != nil {
			t.Fatal(err)
		}
	}

	windowStart := base.Add(-time.Minute)
	windowEnd := base.Add(time.Hour)
	job := billing.ReplayJob{
		ProjectID: projectID, EnvironmentID: environmentID,
		WindowStart: &windowStart, WindowEnd: &windowEnd,
	}

	// Page through with a batch smaller than the window, as the worker does.
	const pageSize = 3
	seen := map[string]int{}
	cursor := billing.InputCursor{}
	passes := 0
	for {
		passes++
		if passes > 10 {
			t.Fatal("the cursor never reached the end of the window")
		}
		inputs, next, err := repository.ReplayInputs(ctx, job, billing.InputFilter{}, cursor, pageSize)
		if err != nil {
			t.Fatal(err)
		}
		for _, input := range inputs {
			seen[input.ID]++
		}
		if len(inputs) < pageSize {
			break
		}
		if !next.Set() {
			t.Fatal("a full page returned no cursor, so the next pass would restart from the beginning")
		}
		cursor = next
	}

	if len(seen) != total {
		t.Fatalf("walked %d input(s) of %d; a window larger than one batch was truncated", len(seen), total)
	}
	for id, count := range seen {
		if count != 1 {
			t.Fatalf("input %s was examined %d times; the keyset cursor repeated a row", id, count)
		}
	}
}

// P1 — disabling Mosaic Billing must be refused while a credential is live.
//
// Without the rule the switch does not mean what it says: Apple keeps posting
// to an endpoint whose intake token still resolves, and every refusal spends
// one of five non-renewable delivery attempts.
func TestBillingCannotBeDisabledWhileCredentialsAreActive(t *testing.T) {
	pool, ctx := testPool(t)
	repository := New(pool)
	projectID, environmentID, _ := seed(t, ctx, pool, "disable")
	now := time.Now().UTC()

	var organizationID string
	if err := pool.QueryRow(ctx, `SELECT organization_id FROM projects WHERE id=$1`, projectID).
		Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at)
		 VALUES ($1,'actor_owner_disable','owner',$2,$2)
		 ON CONFLICT (organization_id,actor_id) DO UPDATE SET role=EXCLUDED.role`,
		organizationID, now); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupContext, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_, _ = pool.Exec(cleanupContext,
			`DELETE FROM organization_members WHERE organization_id=$1 AND actor_id='actor_owner_disable'`, organizationID)
	})
	actor := billing.Actor{ID: "actor_owner_disable"}

	if err := repository.SetBillingEnabled(ctx, actor, projectID, true, now); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO store_server_credentials(
			id, project_id, organization_id, environment_id, environment_mode, provider, store_environment,
			name, status, health_status, credential_class, envelope_version, algorithm, key_id, nonce,
			ciphertext, fingerprint, apple_issuer_id, apple_key_id, intake_token_digest,
			created_by_actor_id, created_at, updated_at)
		 VALUES ('ssc_disable_fixture',$1,$2,$3,'production','app_store','production','Live','active','untested',
			$4,1,'AES-256-GCM','key-a',$5::bytea,$6::bytea,$7::bytea,'fixture-issuer','fixture-key',$8::bytea,'actor',$9,$9)`,
		projectID, organizationID, environmentID, billing.ClassAppleInAppPurchaseKey,
		make([]byte, 12), make([]byte, 32), make([]byte, 32),
		billing.TokenDigest("fixture-disable-intake"), now); err != nil {
		t.Fatal(err)
	}

	if err := repository.SetBillingEnabled(ctx, actor, projectID, false, now); err != billing.ErrCredentialsStillActive {
		t.Fatalf("billing was disabled with a live credential: %v", err)
	}
	enabled, err := repository.BillingEnabled(ctx, projectID)
	if err != nil || !enabled {
		t.Fatal("the refused disable still changed the setting")
	}

	// Revoking the credential is what actually stops the store, and it unblocks
	// the switch.
	if _, err := pool.Exec(ctx,
		`UPDATE store_server_credentials SET status='revoked', health_status='revoked',
		 revoked_at=$1, intake_token_digest=NULL, updated_at=$1 WHERE id='ssc_disable_fixture'`, now); err != nil {
		t.Fatal(err)
	}
	if err := repository.SetBillingEnabled(ctx, actor, projectID, false, now); err != nil {
		t.Fatalf("billing could not be disabled after revocation: %v", err)
	}
	enabled, err = repository.BillingEnabled(ctx, projectID)
	if err != nil || enabled {
		t.Fatal("billing remained enabled after a permitted disable")
	}
}

// Revoking an Apple credential must clear its intake token.
//
// Clearing the digest is what actually stops the notification endpoint
// resolving, and it is the whole point of revoking after a suspected
// compromise. The Apple shape CHECK originally required the digest on every
// app_store row regardless of status, so the revoke UPDATE failed outright and
// an operator responding to a leaked intake token had no way to close it. This
// exercises the real repository path rather than a hand-written UPDATE.
func TestRevokingAnAppleCredentialClearsItsIntakeToken(t *testing.T) {
	pool, ctx := testPool(t)
	repository := New(pool)
	projectID, environmentID, _ := seed(t, ctx, pool, "revoke")
	now := time.Now().UTC()

	var organizationID string
	if err := pool.QueryRow(ctx, `SELECT organization_id FROM projects WHERE id=$1`, projectID).
		Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at)
		 VALUES ($1,'actor_owner_revoke','owner',$2,$2)
		 ON CONFLICT (organization_id,actor_id) DO UPDATE SET role=EXCLUDED.role`,
		organizationID, now); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupContext, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_, _ = pool.Exec(cleanupContext,
			`DELETE FROM organization_members WHERE organization_id=$1 AND actor_id='actor_owner_revoke'`, organizationID)
	})

	digest := billing.TokenDigest("fixture-revoke-intake")
	if _, err := pool.Exec(ctx,
		`INSERT INTO store_server_credentials(
			id, project_id, organization_id, environment_id, environment_mode, provider, store_environment,
			name, status, health_status, credential_class, envelope_version, algorithm, key_id, nonce,
			ciphertext, fingerprint, apple_issuer_id, apple_key_id, intake_token_digest,
			created_by_actor_id, created_at, updated_at)
		 VALUES ('ssc_revoke_fixture',$1,$2,$3,'production','app_store','production','Live','active','untested',
			$4,1,'AES-256-GCM','key-a',$5::bytea,$6::bytea,$7::bytea,'fixture-issuer','fixture-key',$8::bytea,'actor',$9,$9)`,
		projectID, organizationID, environmentID, billing.ClassAppleInAppPurchaseKey,
		make([]byte, 12), make([]byte, 32), make([]byte, 32), digest, now); err != nil {
		t.Fatal(err)
	}

	// The token resolves while the credential is live.
	if _, err := repository.ResolveIntakeToken(ctx, digest); err != nil {
		t.Fatalf("a live intake token did not resolve: %v", err)
	}

	actor := billing.Actor{ID: "actor_owner_revoke"}
	revoked, err := repository.RevokeCredential(ctx, actor, projectID, "ssc_revoke_fixture", now)
	if err != nil {
		t.Fatalf("an Apple credential could not be revoked: %v", err)
	}
	if revoked.Status != "revoked" {
		t.Fatalf("credential status is %q after revocation", revoked.Status)
	}

	// The endpoint must stop resolving: that is what revocation buys.
	if _, err := repository.ResolveIntakeToken(ctx, digest); err != billing.ErrNotFound {
		t.Fatalf("the intake token still resolves after revocation: %v", err)
	}
}
