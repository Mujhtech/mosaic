package httpmiddleware

import "net/http"

// hstsMaxAge is one year, the value browsers require for preload eligibility.
const hstsMaxAge = "max-age=31536000; includeSubDomains"

// permissionsPolicy denies every powerful browser capability. The Mosaic API
// serves JSON and immutable Assets and needs none of them; an explicit denial
// limits the blast radius of anything injected into an API response.
const permissionsPolicy = "accelerometer=(), autoplay=(), camera=(), display-capture=(), " +
	"encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), " +
	"microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), " +
	"usb=(), xr-spatial-tracking=()"

// SecurityHeaders sets Mosaic's baseline response headers.
//
// enableHSTS must only be true for a deployment reached over TLS. A
// Strict-Transport-Security header emitted from a plaintext development origin
// pins that host to HTTPS in the operator's browser for a year, so the decision
// is made once from configuration rather than from a forgeable request header.
func SecurityHeaders(enableHSTS bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := w.Header()
			header.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
			header.Set("Referrer-Policy", "no-referrer")
			header.Set("X-Content-Type-Options", "nosniff")
			header.Set("X-Frame-Options", "DENY")
			header.Set("Permissions-Policy", permissionsPolicy)
			if enableHSTS {
				header.Set("Strict-Transport-Security", hstsMaxAge)
			}
			next.ServeHTTP(w, r)
		})
	}
}
