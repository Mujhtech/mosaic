package billingwebhook

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"syscall"
	"time"
	"unicode"
	"unicode/utf8"
)

// A destination URL is operator-supplied and Mosaic makes outbound requests to
// it. That is a server-side request forgery primitive unless it is bounded,
// and the bound is ADR-0024 §4. This file is the whole of that policy.

const (
	// maxURLLength matches the column CHECK.
	maxURLLength = 2048
	// defaultConnectTimeout bounds the dial. A destination that cannot be
	// reached in five seconds is not going to answer this attempt.
	defaultConnectTimeout = 5 * time.Second
	// defaultTotalTimeout bounds the whole request. It stays well under the
	// delivery lease so a slow destination never lets a second worker claim a
	// delivery that is still in flight.
	defaultTotalTimeout = 20 * time.Second
	// defaultMaxResponseBytes is the response read ceiling. A webhook
	// receiver's response body is never used for anything except a bounded
	// operator-facing excerpt, so the ceiling can be small.
	defaultMaxResponseBytes = 4 << 10
)

// cgnat is RFC 6598 shared address space (100.64.0.0/10). Go's stdlib has no
// predicate for it, and it is a real internal range on carrier and cloud
// networks.
var cgnat = netip.MustParsePrefix("100.64.0.0/10")

// nat64 is the well-known prefix (64:ff9b::/96). It embeds an IPv4 address in
// an IPv6 one, so without it a private IPv4 destination can be reached through
// an address that passes every IPv6 predicate.
var nat64 = netip.MustParsePrefix("64:ff9b::/96")

// thisNetwork is 0.0.0.0/8. Only 0.0.0.0 itself is `IsUnspecified`, and the
// rest of the block is routed to the local host on several stacks.
var thisNetwork = netip.MustParsePrefix("0.0.0.0/8")

// broadcast is the limited broadcast address.
var broadcast = netip.MustParseAddr("255.255.255.255")

// Policy screens destination URLs and performs the bounded outbound request.
//
// It holds no per-destination state. The self-hosted exception is a field of
// the policy — fed from deployment configuration — and never a per-destination
// column, because a per-destination toggle would let anyone with
// destination-write permission reach Mosaic's internal network.
type Policy struct {
	allowPrivate     bool
	connectTimeout   time.Duration
	totalTimeout     time.Duration
	maxResponseBytes int64

	resolve func(ctx context.Context, host string) ([]netip.Addr, error)
	dial    func(ctx context.Context, network, address string) (net.Conn, error)
}

type PolicyOption func(*Policy)

// WithSelfHostedAllowlist permits private destinations.
//
// This is the deployment-level flag from ADR-0024 §4: an operator running
// Mosaic and their application backend on one private network legitimately
// needs a private destination. It never becomes a request field.
func WithSelfHostedAllowlist(enabled bool) PolicyOption {
	return func(p *Policy) { p.allowPrivate = enabled }
}

// WithTimeouts overrides the connect and total bounds.
func WithTimeouts(connect, total time.Duration) PolicyOption {
	return func(p *Policy) {
		if connect > 0 {
			p.connectTimeout = connect
		}
		if total > 0 {
			p.totalTimeout = total
		}
	}
}

// WithMaxResponseBytes overrides the response read ceiling.
func WithMaxResponseBytes(limit int64) PolicyOption {
	return func(p *Policy) {
		if limit > 0 {
			p.maxResponseBytes = limit
		}
	}
}

// WithResolver replaces DNS resolution. Tests use it to express a rebinding
// host; nothing in production does.
func WithResolver(resolve func(ctx context.Context, host string) ([]netip.Addr, error)) PolicyOption {
	return func(p *Policy) {
		if resolve != nil {
			p.resolve = resolve
		}
	}
}

// WithDialer replaces the raw dial. The address screen still runs around it.
func WithDialer(dial func(ctx context.Context, network, address string) (net.Conn, error)) PolicyOption {
	return func(p *Policy) {
		if dial != nil {
			p.dial = dial
		}
	}
}

func NewPolicy(options ...PolicyOption) *Policy {
	policy := &Policy{
		connectTimeout:   defaultConnectTimeout,
		totalTimeout:     defaultTotalTimeout,
		maxResponseBytes: defaultMaxResponseBytes,
	}
	policy.resolve = defaultResolve
	for _, option := range options {
		option(policy)
	}
	if policy.dial == nil {
		dialer := &net.Dialer{
			Timeout: policy.connectTimeout,
			// Control is the last line: it screens the address the kernel is
			// actually about to connect to. Pinning below already decides the
			// address, so this hook should never fire — and that is exactly why
			// it is here, because the day something reintroduces a second
			// resolution this refuses instead of connecting.
			Control: func(network, address string, _ syscall.RawConn) error {
				return policy.screenDialAddress(address)
			},
		}
		policy.dial = func(ctx context.Context, network, address string) (net.Conn, error) {
			return dialer.DialContext(ctx, network, address)
		}
	}
	return policy
}

func defaultResolve(ctx context.Context, host string) ([]netip.Addr, error) {
	return net.DefaultResolver.LookupNetIP(ctx, "ip", host)
}

// Target is a screened destination: the URL, and the one address delivery is
// pinned to.
type Target struct {
	URL     *url.URL
	Address netip.Addr
	Port    string
}

// Check validates a destination URL and resolves it to a permitted address.
//
// It runs at registration *and* at every delivery attempt, and both are
// necessary for different reasons. At registration it is what refuses a bad
// destination while an operator is still looking at the screen. At delivery it
// is what closes DNS rebinding: a hostname that resolved to a public address
// when it was registered can resolve to a private one an hour later, and a
// check that ran only once would have approved that forever.
func (p *Policy) Check(ctx context.Context, raw string) (Target, error) {
	parsed, err := parseDestinationURL(raw)
	if err != nil {
		return Target{}, err
	}
	host := parsed.Hostname()
	port := parsed.Port()
	if port == "" {
		port = "443"
	}

	// A literal address needs no resolution, and resolving one would be a way
	// to reach a resolver with attacker-controlled input for no benefit.
	if literal, parseErr := netip.ParseAddr(host); parseErr == nil {
		if err := p.screen(literal); err != nil {
			return Target{}, err
		}
		return Target{URL: parsed, Address: literal.Unmap(), Port: port}, nil
	}

	addresses, err := p.resolve(ctx, host)
	if err != nil {
		return Target{}, fmt.Errorf("%w: destination host could not be resolved", ErrDestinationRefused)
	}
	if len(addresses) == 0 {
		return Target{}, ErrDestinationRefused
	}
	// Every resolved address must pass, not merely one of them. A host that
	// answers with one public and one private address is a rebinding attempt
	// dressed as a multi-homed service, and picking the address that happens to
	// pass would honour it.
	for _, address := range addresses {
		if err := p.screen(address); err != nil {
			return Target{}, err
		}
	}
	return Target{URL: parsed, Address: addresses[0].Unmap(), Port: port}, nil
}

// parseDestinationURL enforces the shape rules that need no network.
func parseDestinationURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > maxURLLength {
		return nil, ErrInvalid
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, ErrInvalid
	}
	// HTTPS only. Plaintext delivery of entitlement state is not offered at any
	// tier, including to the self-hosted allowlist: the flag exists to permit a
	// private *address*, not to remove transport security.
	if parsed.Scheme != "https" {
		return nil, fmt.Errorf("%w: destinations must use https", ErrDestinationRefused)
	}
	if parsed.User != nil {
		// Credentials in a URL leak through proxy logs and error reports, and
		// Mosaic already has a signing secret for authentication.
		return nil, ErrInvalid
	}
	if parsed.Hostname() == "" {
		return nil, ErrInvalid
	}
	return parsed, nil
}

// screen applies the denied-address policy.
func (p *Policy) screen(address netip.Addr) error {
	if !address.IsValid() {
		return ErrDestinationRefused
	}
	// An IPv4-mapped IPv6 address is refused before anything else. Unmapping
	// first and screening the IPv4 form would be equally safe, but refusing
	// outright removes a whole class of "which form was screened?" questions,
	// and no legitimate destination is published in that notation.
	if address.Is4In6() {
		return fmt.Errorf("%w: ipv4-mapped address", ErrDestinationRefused)
	}
	// Never permitted, allowlist or not. None of these is an internal
	// destination an operator could plausibly want; they are nonsense targets
	// or amplification vectors.
	switch {
	case address.IsUnspecified(),
		address.IsMulticast(),
		address.IsInterfaceLocalMulticast(),
		address.IsLinkLocalMulticast(),
		address == broadcast,
		thisNetwork.Contains(address),
		nat64.Contains(address):
		return fmt.Errorf("%w: reserved address", ErrDestinationRefused)
	}
	if p.allowPrivate {
		return nil
	}
	switch {
	case address.IsLoopback():
		return fmt.Errorf("%w: loopback address", ErrDestinationRefused)
	case address.IsLinkLocalUnicast():
		// 169.254.0.0/16 and fe80::/10. This is the range the cloud metadata
		// address 169.254.169.254 lives in, and reaching it from a webhook
		// destination hands out instance credentials.
		return fmt.Errorf("%w: link-local address", ErrDestinationRefused)
	case address.IsPrivate():
		// RFC1918 for IPv4 and fc00::/7 unique-local for IPv6.
		return fmt.Errorf("%w: private address", ErrDestinationRefused)
	case cgnat.Contains(address):
		return fmt.Errorf("%w: shared address space", ErrDestinationRefused)
	}
	return nil
}

// screenDialAddress screens a host:port about to be dialled.
func (p *Policy) screenDialAddress(address string) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return ErrDestinationRefused
	}
	parsed, err := netip.ParseAddr(host)
	if err != nil {
		return ErrDestinationRefused
	}
	// The kernel is handed the unmapped form, so re-screening the mapped-form
	// rule here would refuse every legitimate IPv4 dial. Everything else in the
	// policy applies unchanged.
	return p.screen(parsed.Unmap())
}

// Result is the bounded record of one outbound request.
type Result struct {
	StatusCode int
	// Excerpt is at most MaxResponseExcerpt characters and contains no control
	// characters. It exists so an integrator can see why their own endpoint
	// refused, and is never parsed.
	Excerpt string
	Latency time.Duration
}

// errRedirectRefused marks a refused redirect distinctly from a transport
// failure: it is the destination's own doing and retrying will not fix it.
var errRedirectRefused = errors.New("redirects are not followed")

// Send performs the delivery request against the pinned address.
//
// The connection goes to the address Check screened, not to a fresh resolution
// of the hostname. Checking the hostname and then letting the HTTP client
// resolve again is the classic rebinding hole: the second resolution can
// return an address the first check would have refused.
func (p *Policy) Send(ctx context.Context, target Target, header http.Header, body []byte) (Result, error) {
	ctx, cancel := context.WithTimeout(ctx, p.totalTimeout)
	defer cancel()

	pinned := net.JoinHostPort(target.Address.String(), target.Port)
	transport := &http.Transport{
		DialContext: func(dialContext context.Context, network, _ string) (net.Conn, error) {
			return p.dial(dialContext, network, pinned)
		},
		// Connections are not reused across deliveries. A pooled connection
		// outlives the screen that approved it, so the next delivery to the
		// same host would travel over an address nothing re-checked.
		DisableKeepAlives:     true,
		TLSHandshakeTimeout:   p.connectTimeout,
		ResponseHeaderTimeout: p.totalTimeout,
	}
	client := &http.Client{
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			// A redirect is a second destination the operator never approved,
			// and following one would carry the signed body to it.
			return errRedirectRefused
		},
	}
	defer transport.CloseIdleConnections()

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, target.URL.String(), strings.NewReader(string(body)))
	if err != nil {
		return Result{}, ErrInvalid
	}
	for key, values := range header {
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}
	request.ContentLength = int64(len(body))

	started := time.Now()
	response, err := client.Do(request)
	if err != nil {
		if errors.Is(err, errRedirectRefused) {
			return Result{Latency: time.Since(started)}, errRedirectRefused
		}
		return Result{Latency: time.Since(started)}, err
	}
	defer func() {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, p.maxResponseBytes))
		_ = response.Body.Close()
	}()

	excerpt, _ := io.ReadAll(io.LimitReader(response.Body, p.maxResponseBytes))
	return Result{
		StatusCode: response.StatusCode,
		Excerpt:    SafeExcerpt(string(excerpt)),
		Latency:    time.Since(started),
	}, nil
}

// SafeExcerpt bounds and sanitizes a destination's response body.
//
// Control characters are dropped rather than escaped: the excerpt is displayed
// in operator tooling and written to a database column whose CHECK refuses
// them, and an endpoint that answers with a terminal escape sequence should not
// get to move an operator's cursor. Invalid UTF-8 is dropped for the same
// reason — the value is decoration, so there is nothing to preserve.
func SafeExcerpt(value string) string {
	var builder strings.Builder
	count := 0
	for _, character := range value {
		if count >= MaxResponseExcerpt {
			break
		}
		if character == utf8.RuneError || unicode.IsControl(character) || !utf8.ValidRune(character) {
			continue
		}
		builder.WriteRune(character)
		count++
	}
	return strings.TrimSpace(builder.String())
}
