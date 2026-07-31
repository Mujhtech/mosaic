package browserauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const (
	passwordHashCost = 12
	sessionTokenSize = 32
)

var dummyPasswordHash = func() []byte {
	hash, err := bcrypt.GenerateFromPassword([]byte("mosaic-invalid-login-padding"), passwordHashCost)
	if err != nil {
		panic("initialize browser authentication password padding: " + err.Error())
	}
	return hash
}()

var comparePasswordHash = bcrypt.CompareHashAndPassword

type Service struct {
	repository Repository
	now        func() time.Time
	lifetime   time.Duration
}

func NewService(repository Repository, lifetime time.Duration) *Service {
	return &Service{repository: repository, now: func() time.Time { return time.Now().UTC() }, lifetime: lifetime}
}

func (s *Service) SignUp(ctx context.Context, email, name, password string) (SignInResult, error) {
	normalizedEmail := normalizeEmail(email)
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), passwordHashCost)
	if err != nil {
		return SignInResult{}, err
	}
	now := s.now()
	token, digest, err := newToken()
	if err != nil {
		return SignInResult{}, err
	}
	userID, err := newID("user")
	if err != nil {
		return SignInResult{}, err
	}
	sessionID, err := newID("session")
	if err != nil {
		return SignInResult{}, err
	}
	user := User{ID: userID, Email: normalizedEmail, Name: strings.TrimSpace(name), CreatedAt: now}
	session := Session{ID: sessionID, UserID: user.ID, TokenDigest: digest, AuthenticatedAt: now, ExpiresAt: now.Add(s.lifetime), LastSeenAt: now, CreatedAt: now}
	if err := s.repository.CreateUserAndSession(ctx, UserRecord{User: user, PasswordHash: string(passwordHash)}, session); err != nil {
		return SignInResult{}, err
	}
	return SignInResult{User: user, Token: token, ExpiresAt: session.ExpiresAt}, nil
}

func (s *Service) Login(ctx context.Context, email, password string) (SignInResult, error) {
	user, ok, err := s.repository.UserByEmail(ctx, normalizeEmail(email))
	if err != nil {
		return SignInResult{}, err
	}
	passwordHash := dummyPasswordHash
	if ok {
		passwordHash = []byte(user.PasswordHash)
	}
	passwordMatches := comparePasswordHash(passwordHash, []byte(password)) == nil
	if !ok || !passwordMatches {
		return SignInResult{}, ErrInvalidLogin
	}
	now := s.now()
	token, digest, err := newToken()
	if err != nil {
		return SignInResult{}, err
	}
	sessionID, err := newID("session")
	if err != nil {
		return SignInResult{}, err
	}
	session := Session{ID: sessionID, UserID: user.ID, TokenDigest: digest, AuthenticatedAt: now, ExpiresAt: now.Add(s.lifetime), LastSeenAt: now, CreatedAt: now}
	if err := s.repository.CreateSession(ctx, session); err != nil {
		return SignInResult{}, err
	}
	return SignInResult{User: user.User, Token: token, ExpiresAt: session.ExpiresAt}, nil
}

func (s *Service) Authenticate(ctx context.Context, token string) (SessionPrincipal, error) {
	if strings.TrimSpace(token) == "" {
		return SessionPrincipal{}, ErrUnauthenticated
	}
	digest := sha256.Sum256([]byte(token))
	principal, ok, err := s.repository.SessionPrincipal(ctx, digest[:])
	if err != nil {
		return SessionPrincipal{}, err
	}
	if !ok {
		return SessionPrincipal{}, ErrUnauthenticated
	}
	return principal, nil
}

func (s *Service) Logout(ctx context.Context, token string) error {
	if strings.TrimSpace(token) == "" {
		return nil
	}
	digest := sha256.Sum256([]byte(token))
	err := s.repository.RevokeSession(ctx, digest[:])
	if errors.Is(err, ErrInvalidSession) {
		return nil
	}
	return err
}

func normalizeEmail(value string) string { return strings.ToLower(strings.TrimSpace(value)) }

func newToken() (string, []byte, error) {
	raw := make([]byte, sessionTokenSize)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	digest := sha256.Sum256([]byte(token))
	return token, digest[:], nil
}

func newID(prefix string) (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return prefix + "_" + hex.EncodeToString(raw), nil
}
