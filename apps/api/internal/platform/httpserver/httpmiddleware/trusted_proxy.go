package httpmiddleware

import (
	"net"
	"net/http"
	"strings"
)

// RealIP rewrites r.RemoteAddr from X-Forwarded-For or X-Real-IP, but only when
// the direct TCP peer is inside one of the configured trusted networks.
//
// Chi's own RealIP middleware trusts those headers unconditionally, which lets
// any client forge the value Mosaic uses for rate-limit bucketing and for the
// remote_ip field in request logs. With no trusted networks configured (the
// default), the forwarded headers are ignored entirely.
func RealIP(trustedCIDRs []string) func(http.Handler) http.Handler {
	networks := parseTrustedNetworks(trustedCIDRs)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if len(networks) > 0 && peerIsTrusted(r.RemoteAddr, networks) {
				if forwarded := forwardedClientIP(r, networks); forwarded != "" {
					r = r.Clone(r.Context())
					r.RemoteAddr = forwarded
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func parseTrustedNetworks(entries []string) []*net.IPNet {
	networks := make([]*net.IPNet, 0, len(entries))
	for _, entry := range entries {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		if _, network, err := net.ParseCIDR(entry); err == nil {
			networks = append(networks, network)
			continue
		}
		if ip := net.ParseIP(entry); ip != nil {
			bits := 32
			if ip.To4() == nil {
				bits = 128
			}
			networks = append(networks, &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)})
		}
	}
	return networks
}

func peerIsTrusted(remoteAddr string, networks []*net.IPNet) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	if ip == nil {
		return false
	}
	return ipIsTrusted(ip, networks)
}

// forwardedClientIP walks X-Forwarded-For right-to-left, discarding entries that
// are themselves trusted infrastructure, and returns the first untrusted address.
// It falls back to X-Real-IP and returns an empty string when neither header
// holds a usable address.
//
// Taking the left-most entry instead would let a client prepend an arbitrary
// address ("X-Forwarded-For: <forged>") and have the real edge proxy append the
// true source behind it, so the forged value would win. Only the right-hand end
// of the chain is written by infrastructure Mosaic actually trusts, so the scan
// must start there and stop at the first hop that is not a trusted proxy.
func forwardedClientIP(r *http.Request, trusted []*net.IPNet) string {
	if value := r.Header.Get("X-Forwarded-For"); value != "" {
		entries := strings.Split(value, ",")
		for index := len(entries) - 1; index >= 0; index-- {
			ip := net.ParseIP(strings.Trim(strings.TrimSpace(entries[index]), "[]"))
			if ip == nil {
				// A malformed hop makes everything to its left unverifiable, so
				// the chain stops being trustworthy here.
				break
			}
			if ipIsTrusted(ip, trusted) {
				continue
			}
			return net.JoinHostPort(ip.String(), "0")
		}
		// Every hop was trusted infrastructure: fall through to X-Real-IP rather
		// than attributing the request to a proxy address.
	}
	if value := strings.TrimSpace(r.Header.Get("X-Real-IP")); value != "" {
		if ip := net.ParseIP(strings.Trim(value, "[]")); ip != nil {
			return net.JoinHostPort(ip.String(), "0")
		}
	}
	return ""
}

func ipIsTrusted(ip net.IP, networks []*net.IPNet) bool {
	for _, network := range networks {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

// ClientIP is the canonical limiter/log key for a request. It always reflects
// the trusted-proxy decision because RealIP has already normalised RemoteAddr.
func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
