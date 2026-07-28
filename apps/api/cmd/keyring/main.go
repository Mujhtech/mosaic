// Command keyring operates on Mosaic's provider-credential keyring.
//
//	keyring validate    check MOSAIC_PROVIDER_CREDENTIAL_KEYRING is usable
//	keyring inspect     report envelope counts per key ID
//	keyring rotate      re-encrypt every envelope under the active key
//
// The command never prints key material, ciphertext, or decrypted credentials.
// Rotation requires every key that currently seals an envelope to still be
// present in the keyring; removing a key before rotating makes the credentials
// it sealed permanently undecryptable.
package main

import (
	"context"
	"crypto/rand"
	"errors"
	"flag"
	"fmt"
	"os"
	"sort"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/cloudworkspacepostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/config"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/database"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "keyring: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	action, flagArguments := splitArguments(args)
	flags := flag.NewFlagSet("keyring", flag.ContinueOnError)
	batchSize := flags.Int("batch-size", 100, "envelopes re-encrypted per transaction")
	dryRun := flags.Bool("dry-run", false, "report what rotation would do without writing")
	timeout := flags.Duration("timeout", 30*time.Minute, "maximum duration for the whole command")
	if err := flags.Parse(flagArguments); err != nil {
		return err
	}
	if action == "" || len(flags.Args()) != 0 {
		return errors.New("usage: keyring <validate|inspect|rotate> [flags]")
	}
	if *batchSize < 1 {
		return errors.New("--batch-size must be at least 1")
	}

	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}
	if cfg.Providers.CredentialKeyring == "" {
		return errors.New("MOSAIC_PROVIDER_CREDENTIAL_KEYRING is not set")
	}
	cipher, err := providercredential.NewAESGCMCipher(cfg.Providers.CredentialKeyring, rand.Reader)
	if err != nil {
		return fmt.Errorf("the configured keyring is not usable: %w", err)
	}

	if action == "validate" {
		fmt.Printf("keyring is valid\nactive key id: %s\nkey ids:       %v\n", cipher.ActiveKeyID(), cipher.KeyIDs())
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	pool, err := database.Open(ctx, database.Config{
		URL: cfg.Database.URL, MaxConnections: cfg.Database.MaxConnections,
		MinConnections: cfg.Database.MinConnections, ConnectTimeout: cfg.Database.ConnectTimeout,
		StatementTimeout: cfg.Database.StatementTimeout, LockTimeout: cfg.Database.LockTimeout,
	})
	if err != nil {
		return fmt.Errorf("initialize database: %w", err)
	}
	defer pool.Close()
	repository := cloudworkspacepostgres.New(pool)
	// Phase 9A added Store Server Credential and Raw Billing Input envelopes.
	// They are sealed under the same keyring, so rotation has to reach them:
	// a key left sealing billing rows cannot safely be dropped from the keyring.
	billingRepository := billingpostgres.New(pool)

	switch action {
	case "inspect":
		return inspect(ctx, repository, billingRepository, cipher)
	case "rotate":
		if err := rotate(ctx, repository, cipher, *batchSize, *dryRun); err != nil {
			return err
		}
		return rotateBilling(ctx, billingRepository, cipher, *batchSize, *dryRun)
	default:
		return fmt.Errorf("unsupported keyring action %q", action)
	}
}

func inspect(ctx context.Context, repository *cloudworkspacepostgres.Repository, billingRepository *billingpostgres.Repository, cipher *providercredential.AESGCMCipher) error {
	counts, err := repository.CredentialCountsByKeyID(ctx)
	if err != nil {
		return err
	}
	billingCounts, err := billingRepository.EnvelopeCountsByKeyID(ctx)
	if err != nil {
		return err
	}
	for keyID, count := range billingCounts {
		counts[keyID] += count
	}
	known := make(map[string]struct{}, len(cipher.KeyIDs()))
	for _, id := range cipher.KeyIDs() {
		known[id] = struct{}{}
	}
	ids := make([]string, 0, len(counts))
	for id := range counts {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	fmt.Printf("active key id: %s\n\n", cipher.ActiveKeyID())
	fmt.Printf("%-32s %-10s %s\n", "KEY ID", "ENVELOPES", "STATUS")
	missing := 0
	stale := int64(0)
	for _, id := range ids {
		status := "retired (still in keyring)"
		switch {
		case id == cipher.ActiveKeyID():
			status = "active"
		default:
			if _, ok := known[id]; !ok {
				status = "MISSING FROM KEYRING"
				missing++
			}
			stale += counts[id]
		}
		fmt.Printf("%-32s %-10d %s\n", id, counts[id], status)
	}
	for _, id := range cipher.KeyIDs() {
		if _, ok := counts[id]; !ok {
			fmt.Printf("%-32s %-10d %s\n", id, 0, "unused")
		}
	}
	fmt.Printf("\n%d envelope(s) not under the active key\n", stale)
	if missing > 0 {
		return fmt.Errorf("%d key id(s) sealing envelopes are absent from the keyring; those credentials cannot be decrypted or rotated", missing)
	}
	return nil
}

func rotate(ctx context.Context, repository *cloudworkspacepostgres.Repository, cipher *providercredential.AESGCMCipher, batchSize int, dryRun bool) error {
	activeKeyID := cipher.ActiveKeyID()
	rotated := 0
	for {
		records, err := repository.CredentialsNotUnderKey(ctx, activeKeyID, batchSize)
		if err != nil {
			return err
		}
		if len(records) == 0 {
			break
		}
		if dryRun {
			fmt.Printf("would rotate %d envelope(s) in this batch\n", len(records))
			rotated += len(records)
			// A dry run cannot page: nothing is written, so the same batch would
			// be returned forever.
			break
		}
		resealed := make([]cloudworkspace.ProviderCredentialRecord, 0, len(records))
		for _, record := range records {
			scope := providercredential.Scope{
				OrganizationID:  record.OrganizationID,
				ProjectID:       record.ProjectID,
				ConnectionID:    record.ConnectionID,
				CredentialClass: record.Class,
			}
			plaintext, err := cipher.Decrypt(providercredential.Envelope{
				Version: record.Version, Algorithm: record.Algorithm, KeyID: record.KeyID,
				Nonce: record.Nonce, Ciphertext: record.Ciphertext,
				CredentialClass: record.Class, Fingerprint: record.Fingerprint,
			}, scope)
			if err != nil {
				return fmt.Errorf("connection %s cannot be decrypted with the configured keyring; keep key %q in the keyring and retry: %w",
					record.ConnectionID, record.KeyID, err)
			}
			envelope, err := cipher.Encrypt(plaintext, scope)
			zero(plaintext)
			if err != nil {
				return fmt.Errorf("re-encrypt credential for connection %s: %w", record.ConnectionID, err)
			}
			record.Version = envelope.Version
			record.Algorithm = envelope.Algorithm
			record.KeyID = envelope.KeyID
			record.Nonce = envelope.Nonce
			record.Ciphertext = envelope.Ciphertext
			record.Fingerprint = envelope.Fingerprint
			resealed = append(resealed, record)
		}
		if err := repository.ReplaceCredentialEnvelopes(ctx, resealed, time.Now().UTC()); err != nil {
			return err
		}
		rotated += len(resealed)
		fmt.Printf("rotated %d envelope(s)\n", rotated)
	}
	if dryRun {
		fmt.Printf("dry run complete: at least %d envelope(s) need rotation to key %s\n", rotated, activeKeyID)
		return nil
	}
	fmt.Printf("rotation complete: %d envelope(s) now sealed under %s\n", rotated, activeKeyID)
	return nil
}

// rotateBilling reseals Phase 9A envelopes under the active key.
//
// The scope is rebuilt from the row itself rather than assumed, because the v2
// additional data binds the ciphertext to the organization, Project, subject
// kind, subject id, and class; resealing under a reconstructed-but-wrong scope
// would produce a row that decrypts nowhere.
func rotateBilling(ctx context.Context, repository *billingpostgres.Repository, cipher *providercredential.AESGCMCipher, batchSize int, dryRun bool) error {
	activeKeyID := cipher.ActiveKeyID()
	rotated := 0
	for {
		envelopes, err := repository.EnvelopesNotUnderKey(ctx, activeKeyID, batchSize)
		if err != nil {
			return err
		}
		if len(envelopes) == 0 {
			break
		}
		if dryRun {
			fmt.Printf("would rotate %d billing envelope(s) in this batch\n", len(envelopes))
			rotated += len(envelopes)
			break
		}
		resealed := make([]billingpostgres.BillingEnvelope, 0, len(envelopes))
		for _, envelope := range envelopes {
			scope := envelope.Scope()
			plaintext, err := cipher.DecryptSubject(providercredential.Envelope{
				Version: envelope.Version, Algorithm: envelope.Algorithm, KeyID: envelope.KeyID,
				Nonce: envelope.Nonce, Ciphertext: envelope.Ciphertext,
				CredentialClass: envelope.CredentialClass, Fingerprint: envelope.Fingerprint,
			}, scope)
			if err != nil {
				return fmt.Errorf("billing envelope %s/%s cannot be decrypted with the configured keyring; keep key %q in the keyring and retry: %w",
					envelope.Table, envelope.RowID, envelope.KeyID, err)
			}
			sealed, err := cipher.EncryptSubject(plaintext, scope)
			zero(plaintext)
			if err != nil {
				return fmt.Errorf("re-encrypt billing envelope %s/%s: %w", envelope.Table, envelope.RowID, err)
			}
			envelope.Version = sealed.Version
			envelope.Algorithm = sealed.Algorithm
			envelope.KeyID = sealed.KeyID
			envelope.Nonce = sealed.Nonce
			envelope.Ciphertext = sealed.Ciphertext
			envelope.Fingerprint = sealed.Fingerprint
			resealed = append(resealed, envelope)
		}
		if err := repository.ReplaceEnvelopes(ctx, resealed, time.Now().UTC()); err != nil {
			return err
		}
		rotated += len(resealed)
		fmt.Printf("rotated %d billing envelope(s)\n", rotated)
	}
	if dryRun {
		fmt.Printf("dry run complete: at least %d billing envelope(s) need rotation to key %s\n", rotated, activeKeyID)
		return nil
	}
	fmt.Printf("billing rotation complete: %d envelope(s) now sealed under %s\n", rotated, activeKeyID)
	return nil
}

// zero clears decrypted credential bytes as soon as they are no longer needed.
func zero(value []byte) {
	for i := range value {
		value[i] = 0
	}
}

// splitArguments separates the subcommand from its flags so both orders work:
// `migrate down --confirm` and `migrate --confirm down`. Go's flag package stops
// parsing at the first positional argument, which would otherwise reject the
// natural form.
func splitArguments(args []string) (string, []string) {
	action := ""
	flags := make([]string, 0, len(args))
	for _, argument := range args {
		if action == "" && argument != "" && argument[0] != '-' {
			action = argument
			continue
		}
		flags = append(flags, argument)
	}
	return action, flags
}
