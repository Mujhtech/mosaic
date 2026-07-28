package billingwebhook

import (
	"context"
	"errors"
	"net/netip"
	"testing"
)

// A destination URL is operator-supplied and Mosaic makes outbound requests to
// it. Every case below is a way that turns into a request Mosaic should never
// have made: reading cloud instance credentials off the link-local metadata
// address, probing an internal service on an RFC1918 address, or reaching a
// private host through an address form that passes the naive check.
//
// The policy is the only thing preventing any of it, so it is tested directly
// rather than through the service: the failure being protected against is a
// missing branch in the screen, and a test that had to construct a destination
// and a delivery to reach that branch would be harder to read and no more
// conclusive.

func TestScreenDeniesEveryReservedClass(t *testing.T) {
	cases := []struct {
		name    string
		address string
	}{
		{"rfc1918 ten", "10.0.0.1"},
		{"rfc1918 172.16", "172.16.5.4"},
		{"rfc1918 192.168", "192.168.1.1"},
		{"loopback v4", "127.0.0.1"},
		{"loopback v6", "::1"},
		{"link local v4", "169.254.1.1"},
		// The cloud metadata address. Reaching it from a webhook destination
		// hands out instance credentials, which is the single highest-value
		// target this policy exists to refuse.
		{"cloud metadata", "169.254.169.254"},
		{"link local v6", "fe80::1"},
		{"cgnat", "100.64.0.1"},
		{"cgnat upper", "100.127.255.254"},
		{"ipv6 unique local", "fd00::1"},
		{"ipv6 unique local fc", "fc00::1"},
		// An IPv4-mapped IPv6 address is a private IPv4 destination wearing an
		// IPv6 costume: it satisfies no IPv6 private predicate at all.
		{"ipv4-mapped private", "::ffff:10.0.0.1"},
		{"ipv4-mapped public", "::ffff:93.184.216.34"},
		{"unspecified v4", "0.0.0.0"},
		{"unspecified v6", "::"},
		{"this network", "0.1.2.3"},
		{"broadcast", "255.255.255.255"},
		{"multicast", "224.0.0.1"},
		// NAT64 embeds an IPv4 address inside an IPv6 one, so without an
		// explicit rule a private IPv4 host is reachable through it.
		{"nat64", "64:ff9b::a00:1"},
	}

	policy := NewPolicy()
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			address := netip.MustParseAddr(testCase.address)
			if err := policy.screen(address); !errors.Is(err, ErrDestinationRefused) {
				t.Fatalf("screen(%s) = %v, want ErrDestinationRefused", testCase.address, err)
			}
		})
	}

	// A genuinely public address must pass, or the policy would refuse every
	// legitimate destination and the failure would look like an outage.
	if err := policy.screen(netip.MustParseAddr("93.184.216.34")); err != nil {
		t.Fatalf("screen(public v4) = %v, want nil", err)
	}
	if err := policy.screen(netip.MustParseAddr("2606:2800:220:1:248:1893:25c8:1946")); err != nil {
		t.Fatalf("screen(public v6) = %v, want nil", err)
	}
}

// The self-hosted allowlist is a deployment flag, not a per-destination field.
// It has to actually permit a private destination — an operator running Mosaic
// and their backend on one network has no other supported option — while still
// refusing the addresses that are not destinations at all.
func TestSelfHostedAllowlistPermitsPrivateOnly(t *testing.T) {
	policy := NewPolicy(WithSelfHostedAllowlist(true))

	for _, address := range []string{"10.0.0.1", "127.0.0.1", "169.254.169.254", "fd00::1", "100.64.0.1"} {
		if err := policy.screen(netip.MustParseAddr(address)); err != nil {
			t.Fatalf("allowlisted screen(%s) = %v, want nil", address, err)
		}
	}
	// Never permitted, flag or not: none of these is a destination, and a
	// broadcast or multicast target turns one entitlement change into an
	// amplified send.
	for _, address := range []string{"0.0.0.0", "255.255.255.255", "224.0.0.1", "::ffff:10.0.0.1"} {
		if err := policy.screen(netip.MustParseAddr(address)); !errors.Is(err, ErrDestinationRefused) {
			t.Fatalf("allowlisted screen(%s) = %v, want ErrDestinationRefused", address, err)
		}
	}
}

func TestCheckRequiresHTTPS(t *testing.T) {
	policy := NewPolicy(WithResolver(func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
	}))
	ctx := context.Background()

	if _, err := policy.Check(ctx, "http://example.com/hook"); !errors.Is(err, ErrDestinationRefused) {
		t.Fatalf("plaintext destination accepted: %v", err)
	}
	// The allowlist permits a private address, never a plaintext scheme.
	relaxed := NewPolicy(WithSelfHostedAllowlist(true),
		WithResolver(func(context.Context, string) ([]netip.Addr, error) {
			return []netip.Addr{netip.MustParseAddr("10.0.0.5")}, nil
		}))
	if _, err := relaxed.Check(ctx, "http://internal.example/hook"); !errors.Is(err, ErrDestinationRefused) {
		t.Fatalf("allowlist accepted a plaintext destination: %v", err)
	}
	if _, err := policy.Check(ctx, "https://user:pass@example.com/hook"); err == nil {
		t.Fatal("credentials in the destination URL were accepted")
	}
	if _, err := policy.Check(ctx, "https://example.com/hook"); err != nil {
		t.Fatalf("public https destination refused: %v", err)
	}
}

// TestCheckRefusesDNSRebinding is the case the whole "resolve and pin per
// attempt" rule exists for.
//
// A hostname that resolved to a public address when the operator registered it
// can resolve to a private one an hour later. Screening only at registration
// would approve that host forever, and every subsequent delivery would carry a
// signed request into Mosaic's own network. Because the screen runs again on
// every attempt, the second resolution is refused.
func TestCheckRefusesDNSRebinding(t *testing.T) {
	resolutions := 0
	policy := NewPolicy(WithResolver(func(context.Context, string) ([]netip.Addr, error) {
		resolutions++
		if resolutions == 1 {
			// Registration time: a perfectly ordinary public address.
			return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
		}
		// Delivery time: the same hostname, now pointing inside.
		return []netip.Addr{netip.MustParseAddr("169.254.169.254")}, nil
	}))
	ctx := context.Background()

	target, err := policy.Check(ctx, "https://rebind.example/hook")
	if err != nil {
		t.Fatalf("registration screen refused a public address: %v", err)
	}
	if target.Address != netip.MustParseAddr("93.184.216.34") {
		t.Fatalf("pinned address = %s, want the address that was screened", target.Address)
	}

	if _, err := policy.Check(ctx, "https://rebind.example/hook"); !errors.Is(err, ErrDestinationRefused) {
		t.Fatalf("delivery-time screen accepted a rebound address: %v", err)
	}
	if resolutions != 2 {
		t.Fatalf("resolver called %d times; the screen is not re-running per attempt", resolutions)
	}
}

// A host that answers with one public and one private address is a rebinding
// attempt dressed as a multi-homed service. Picking the address that happens to
// pass would honour it.
func TestCheckRefusesMixedResolution(t *testing.T) {
	policy := NewPolicy(WithResolver(func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{
			netip.MustParseAddr("93.184.216.34"),
			netip.MustParseAddr("10.1.2.3"),
		}, nil
	}))
	if _, err := policy.Check(context.Background(), "https://mixed.example/hook"); !errors.Is(err, ErrDestinationRefused) {
		t.Fatalf("mixed resolution accepted: %v", err)
	}
}

// The dial-time control hook is the last line: it screens the address the
// kernel is about to connect to, so a second resolution reintroduced anywhere
// below the pin refuses instead of connecting.
func TestScreenDialAddressRefusesPrivateTarget(t *testing.T) {
	policy := NewPolicy()
	if err := policy.screenDialAddress("10.0.0.9:443"); !errors.Is(err, ErrDestinationRefused) {
		t.Fatalf("dial screen accepted a private target: %v", err)
	}
	// The kernel is handed the unmapped IPv4 form, so an ordinary public dial
	// must still pass: a rule that refused it would break every delivery.
	if err := policy.screenDialAddress("93.184.216.34:443"); err != nil {
		t.Fatalf("dial screen refused a public target: %v", err)
	}
}

// The excerpt is written to a column whose CHECK refuses control characters and
// bounds the length, and it is displayed in operator tooling. An endpoint that
// answers with a terminal escape sequence must not reach either.
func TestSafeExcerptIsBoundedAndPrintable(t *testing.T) {
	hostile := "\x1b[2Jerased\nline\ttab\x00null"
	excerpt := SafeExcerpt(hostile)
	for _, character := range excerpt {
		if character < 0x20 || character == 0x7f {
			t.Fatalf("excerpt retained control character %q: %q", character, excerpt)
		}
	}
	long := make([]rune, 0, 600)
	for index := 0; index < 600; index++ {
		long = append(long, 'a')
	}
	if got := len([]rune(SafeExcerpt(string(long)))); got != MaxResponseExcerpt {
		t.Fatalf("excerpt length = %d, want %d", got, MaxResponseExcerpt)
	}
}
