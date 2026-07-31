package browserauth

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"
)

type testRepository struct {
	users    map[string]UserRecord
	sessions map[string]Session
	now      func() time.Time
}

func newTestRepository() *testRepository {
	return &testRepository{users: make(map[string]UserRecord), sessions: make(map[string]Session), now: time.Now}
}

func (repository *testRepository) CreateUserAndSession(_ context.Context, user UserRecord, session Session) error {
	if _, exists := repository.users[user.Email]; exists {
		return ErrEmailInUse
	}
	repository.users[user.Email] = user
	repository.sessions[string(session.TokenDigest)] = session
	return nil
}

func (repository *testRepository) UserByEmail(_ context.Context, email string) (UserRecord, bool, error) {
	user, ok := repository.users[email]
	return user, ok, nil
}

func (repository *testRepository) CreateSession(_ context.Context, session Session) error {
	repository.sessions[string(session.TokenDigest)] = session
	return nil
}

func (repository *testRepository) SessionPrincipal(_ context.Context, digest []byte) (SessionPrincipal, bool, error) {
	session, ok := repository.sessions[string(digest)]
	if !ok || session.RevokedAt != nil || !session.ExpiresAt.After(repository.now()) {
		return SessionPrincipal{}, false, nil
	}
	for _, user := range repository.users {
		if user.ID == session.UserID {
			return SessionPrincipal{User: user.User, SessionID: session.ID, AuthenticatedAt: session.AuthenticatedAt}, true, nil
		}
	}
	return SessionPrincipal{}, false, nil
}

func (repository *testRepository) RevokeSession(_ context.Context, digest []byte) error {
	session, ok := repository.sessions[string(digest)]
	if !ok {
		return ErrInvalidSession
	}
	now := time.Now()
	session.RevokedAt = &now
	repository.sessions[string(digest)] = session
	return nil
}

func TestBrowserSessionCredentialsStayOpaqueAndRevocable(t *testing.T) {
	repository := newTestRepository()
	service := NewService(repository, time.Hour)
	service.now = func() time.Time { return time.Date(2026, time.July, 22, 10, 0, 0, 0, time.UTC) }
	repository.now = service.now

	created, err := service.SignUp(context.Background(), " Owner@Example.COM ", "Owner", "correct horse battery")
	if err != nil {
		t.Fatalf("sign up: %v", err)
	}
	stored := repository.users["owner@example.com"]
	if stored.PasswordHash == "correct horse battery" || !bytes.HasPrefix([]byte(stored.PasswordHash), []byte("$2")) {
		t.Fatal("password was not persisted as a bcrypt hash")
	}
	if created.Token == "" || bytes.Contains([]byte(stored.PasswordHash), []byte(created.Token)) {
		t.Fatal("opaque session token was empty or stored in credential material")
	}
	for digest := range repository.sessions {
		if digest == created.Token || len(digest) != 32 {
			t.Fatal("repository did not receive only the 32-byte session-token digest")
		}
	}
	if _, err := service.Authenticate(context.Background(), created.Token); err != nil {
		t.Fatalf("authenticate new session: %v", err)
	}
	if err := service.Logout(context.Background(), created.Token); err != nil {
		t.Fatalf("log out: %v", err)
	}
	if _, err := service.Authenticate(context.Background(), created.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("authenticate revoked session error = %v, want unauthenticated", err)
	}
}

func TestLoginDoesNotDiscloseWhetherCredentialFieldFailed(t *testing.T) {
	repository := newTestRepository()
	service := NewService(repository, time.Hour)
	if _, err := service.SignUp(context.Background(), "owner@example.com", "Owner", "correct horse battery"); err != nil {
		t.Fatalf("sign up: %v", err)
	}
	for _, credentials := range [][2]string{{"owner@example.com", "wrong"}, {"missing@example.com", "wrong"}} {
		if _, err := service.Login(context.Background(), credentials[0], credentials[1]); !errors.Is(err, ErrInvalidLogin) {
			t.Fatalf("login(%q) error = %v, want invalid login", credentials[0], err)
		}
	}
}

func TestMissingAccountStillPerformsPasswordHashWork(t *testing.T) {
	repository := newTestRepository()
	service := NewService(repository, time.Hour)
	original := comparePasswordHash
	t.Cleanup(func() { comparePasswordHash = original })
	calls := 0
	comparePasswordHash = func(hash, password []byte) error {
		calls++
		if !bytes.Equal(hash, dummyPasswordHash) || string(password) != "wrong" {
			t.Fatalf("missing-account comparison used unexpected material")
		}
		return errors.New("mismatch")
	}
	if _, err := service.Login(context.Background(), "missing@example.com", "wrong"); !errors.Is(err, ErrInvalidLogin) {
		t.Fatalf("login error=%v, want invalid login", err)
	}
	if calls != 1 {
		t.Fatalf("password comparisons=%d, want one", calls)
	}
}

var _ Repository = (*testRepository)(nil)
