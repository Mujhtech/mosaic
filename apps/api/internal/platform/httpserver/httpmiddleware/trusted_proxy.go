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
				if forwarded := forwardedClientIP(r); forwarded != "" {
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
	for _, network := range networks {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

// forwardedClientIP returns the left-most X-Forwarded-For entry, falling back to
// X-Real-IP. It returns an empty string when neither header holds a valid IP.
func forwardedClientIP(r *http.Request) string {
	if value := r.Header.Get("X-Forwarded-For"); value != "" {
		candidate, _, _ := strings.Cut(value, ",")
		if ip := net.ParseIP(strings.TrimSpace(candidate)); ip != nil {
			return net.JoinHostPort(ip.String(), "0")
		}
	}
	if value := strings.TrimSpace(r.Header.Get("X-Real-IP")); value != "" {
		if ip := net.ParseIP(value); ip != nil {
			return net.JoinHostPort(ip.String(), "0")
		}
	}
	return ""
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
