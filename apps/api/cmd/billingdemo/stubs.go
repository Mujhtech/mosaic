//go:build billingdemo

// This command is excluded from every ordinary build.
//
// It constructs the real Mosaic router and the real billing service but injects
// a locally generated trust anchor through appstorejws.WithRoot, which is a
// verification seam that must never exist in a deployed image. cmd/api and
// cmd/worker call NewVerifier() with no options, so the seam is unreachable
// from the deployed path — but a buildable binary in the same module is one
// stray Dockerfile COPY away from being shipped. The tag makes that impossible
// rather than improbable:
//
//	DATABASE_URL=postgres://... go run -tags billingdemo ./cmd/billingdemo
package main

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"time"
)

// The servers below stand in for Apple's App Store Server API, Google's Play
// Developer API, and Google Cloud Pub/Sub. They are LOCAL STUBS: they speak the
// documented request and response shapes over loopback HTTP, and nothing in
// them is a recording of a real provider response. Mosaic's own provider
// clients — appstoreserver.Client and googleplay.Client — are the real ones and
// are pointed at these hosts through their existing base-URL configuration.

// ---------------------------------------------------------------------------
// Apple App Store Server API stub
// ---------------------------------------------------------------------------

type appleStub struct {
	mutex sync.Mutex
	// transactions maps a transaction id to the signed transaction the API
	// returns for it.
	transactions map[string]string
	// history is what Get Notification History returns.
	history []string
	// failWith, when non-zero, makes every transaction lookup answer that status
	// until it is cleared. This is how the retry demonstration simulates an
	// Apple outage.
	failWith int
	// calls records every path the real client actually requested.
	calls []string

	server *httptest.Server
}

func newAppleStub() *appleStub {
	stub := &appleStub{transactions: map[string]string{}}
	mux := http.NewServeMux()
	mux.HandleFunc("/inApps/v1/transactions/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/inApps/v1/transactions/")
		stub.mutex.Lock()
		stub.calls = append(stub.calls, r.Method+" "+r.URL.Path)
		failWith, signed := stub.failWith, stub.transactions[id]
		stub.mutex.Unlock()

		if failWith != 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(failWith)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"errorCode": 5000000, "errorMessage": "General internal error.",
			})
			return
		}
		if signed == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"errorCode": 4040010, "errorMessage": "Transaction id not found.",
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"signedTransactionInfo": signed})
	})
	mux.HandleFunc("/inApps/v1/notifications/history", func(w http.ResponseWriter, r *http.Request) {
		stub.mutex.Lock()
		stub.calls = append(stub.calls, r.Method+" "+r.URL.Path)
		history := append([]string(nil), stub.history...)
		stub.mutex.Unlock()

		items := make([]map[string]any, 0, len(history))
		for _, signedPayload := range history {
			items = append(items, map[string]any{
				"signedPayload": signedPayload,
				"sendAttempts": []map[string]any{{
					"attemptDate": time.Now().Add(-time.Hour).UnixMilli(), "sendAttemptResult": "TIMED_OUT",
				}},
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{"notificationHistory": items, "hasMore": false})
	})
	stub.server = httptest.NewServer(mux)
	return stub
}

func (s *appleStub) addTransaction(id, signed string) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.transactions[id] = signed
}

func (s *appleStub) setHistory(signedPayloads ...string) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.history = append([]string(nil), signedPayloads...)
}

func (s *appleStub) setFailure(status int) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.failWith = status
}

func (s *appleStub) callLog() []string {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return append([]string(nil), s.calls...)
}

// ---------------------------------------------------------------------------
// Google Play Developer API stub
// ---------------------------------------------------------------------------

type playStub struct {
	mutex         sync.Mutex
	subscriptions map[string]map[string]any
	products      map[string]map[string]any
	orders        map[string]map[string]any
	failWith      int
	calls         []string
	server        *httptest.Server
}

func newPlayStub() *playStub {
	stub := &playStub{
		subscriptions: map[string]map[string]any{},
		products:      map[string]map[string]any{},
		orders:        map[string]map[string]any{},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/androidpublisher/v3/applications/", func(w http.ResponseWriter, r *http.Request) {
		stub.mutex.Lock()
		stub.calls = append(stub.calls, r.Method+" "+r.URL.Path)
		failWith := stub.failWith
		stub.mutex.Unlock()

		if failWith != 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(failWith)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": map[string]any{"code": failWith, "status": "UNAVAILABLE", "message": "backend unavailable"},
			})
			return
		}

		path := r.URL.Path
		switch {
		case strings.Contains(path, "/purchases/subscriptionsv2/tokens/"):
			token := path[strings.LastIndex(path, "/")+1:]
			stub.mutex.Lock()
			purchase := stub.subscriptions[token]
			stub.mutex.Unlock()
			if purchase == nil {
				writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]any{"code": 404, "status": "NOT_FOUND"}})
				return
			}
			writeJSON(w, http.StatusOK, purchase)
		case strings.Contains(path, "/purchases/products/"):
			token := path[strings.LastIndex(path, "/")+1:]
			stub.mutex.Lock()
			purchase := stub.products[token]
			stub.mutex.Unlock()
			if purchase == nil {
				writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]any{"code": 404, "status": "NOT_FOUND"}})
				return
			}
			writeJSON(w, http.StatusOK, purchase)
		case strings.Contains(path, "/orders/"):
			orderID := path[strings.LastIndex(path, "/")+1:]
			stub.mutex.Lock()
			order := stub.orders[orderID]
			stub.mutex.Unlock()
			if order == nil {
				writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]any{"code": 404, "status": "NOT_FOUND"}})
				return
			}
			writeJSON(w, http.StatusOK, order)
		default:
			writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]any{"code": 404, "status": "NOT_FOUND"}})
		}
	})
	stub.server = httptest.NewServer(mux)
	return stub
}

func (s *playStub) setSubscription(token string, purchase map[string]any) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.subscriptions[token] = purchase
}

func (s *playStub) setFailure(status int) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.failWith = status
}

func (s *playStub) callLog() []string {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return append([]string(nil), s.calls...)
}

// ---------------------------------------------------------------------------
// Pub/Sub stub
// ---------------------------------------------------------------------------

type pubsubStub struct {
	mutex        sync.Mutex
	pending      []map[string]any
	acknowledged []string
	pulls        int
	server       *httptest.Server
}

func newPubSubStub() *pubsubStub {
	stub := &pubsubStub{}
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/projects/", func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, ":pull"):
			stub.mutex.Lock()
			stub.pulls++
			messages := stub.pending
			stub.pending = nil
			stub.mutex.Unlock()
			if messages == nil {
				messages = []map[string]any{}
			}
			writeJSON(w, http.StatusOK, map[string]any{"receivedMessages": messages})
		case strings.HasSuffix(r.URL.Path, ":acknowledge"):
			var request struct {
				AckIDs []string `json:"ackIds"`
			}
			_ = json.NewDecoder(r.Body).Decode(&request)
			stub.mutex.Lock()
			stub.acknowledged = append(stub.acknowledged, request.AckIDs...)
			stub.mutex.Unlock()
			writeJSON(w, http.StatusOK, map[string]any{})
		default:
			writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]any{"code": 404}})
		}
	})
	stub.server = httptest.NewServer(mux)
	return stub
}

// enqueue makes one RTDN available on the next pull. ackID and messageID are
// separate on purpose: Pub/Sub redelivers the same messageId under a new ackId,
// which is exactly what the duplicate demonstration replays.
func (s *pubsubStub) enqueue(ackID, messageID, data string, publishTime time.Time) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.pending = append(s.pending, map[string]any{
		"ackId": ackID,
		"message": map[string]any{
			"data":        data,
			"messageId":   messageID,
			"publishTime": publishTime.UTC().Format(time.RFC3339Nano),
		},
	})
}

func (s *pubsubStub) state() (pulls int, acknowledged []string) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return s.pulls, append([]string(nil), s.acknowledged...)
}

// ---------------------------------------------------------------------------
// Google OAuth token endpoint
// ---------------------------------------------------------------------------

// googleplay.ParseServiceAccount pins token_uri to Google's real endpoint, so
// the token exchange cannot be redirected through the key file. Rather than
// weaken that control, the demo runs a TLS stub and a loopback CONNECT proxy,
// and installs the proxy on http.DefaultTransport before the real
// googleplay.Client is constructed (the client clones DefaultTransport). The
// real client therefore performs the real RS256 JWT-bearer assertion and a real
// HTTPS token exchange; only the host it lands on is local.
type oauthStub struct {
	mutex     sync.Mutex
	exchanges int
	server    *httptest.Server
	proxy     net.Listener
	proxyURL  *url.URL
}

func newOAuthStub() (*oauthStub, error) {
	stub := &oauthStub{}
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		stub.mutex.Lock()
		stub.exchanges++
		stub.mutex.Unlock()
		if r.PostForm.Get("assertion") == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_grant"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"access_token": "demo-access-token-redacted", "expires_in": 3600, "token_type": "Bearer",
		})
	})
	stub.server = httptest.NewTLSServer(mux)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	stub.proxy = listener
	stub.proxyURL, err = url.Parse("http://" + listener.Addr().String())
	if err != nil {
		return nil, err
	}
	target := strings.TrimPrefix(stub.server.URL, "https://")
	go func() {
		for {
			connection, err := listener.Accept()
			if err != nil {
				return
			}
			go serveConnect(connection, target)
		}
	}()
	return stub, nil
}

// serveConnect answers a single CONNECT request by dialling the local TLS stub
// regardless of the host asked for, then piping bytes both ways.
func serveConnect(client net.Conn, target string) {
	defer func() { _ = client.Close() }()
	buffer := make([]byte, 4096)
	read, err := client.Read(buffer)
	if err != nil || !strings.HasPrefix(string(buffer[:read]), "CONNECT ") {
		return
	}
	upstream, err := net.Dial("tcp", target)
	if err != nil {
		_, _ = client.Write([]byte("HTTP/1.1 502 Bad Gateway\r\n\r\n"))
		return
	}
	defer func() { _ = upstream.Close() }()
	if _, err := client.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n")); err != nil {
		return
	}
	done := make(chan struct{})
	go func() { _, _ = io.Copy(upstream, client); close(done) }()
	_, _ = io.Copy(client, upstream)
	<-done
}

// install points http.DefaultTransport's proxy at the CONNECT listener for
// Google's token host only, and trusts the TLS stub's certificate.
func (s *oauthStub) install() {
	transport := http.DefaultTransport.(*http.Transport)
	transport.Proxy = func(request *http.Request) (*url.URL, error) {
		if request.URL.Host == "oauth2.googleapis.com" {
			return s.proxyURL, nil
		}
		return nil, nil
	}
	pool := s.server.Client().Transport.(*http.Transport).TLSClientConfig
	// httptest's TLS certificate names example.com, so the handshake is verified
	// against that rather than skipped.
	transport.TLSClientConfig = &tls.Config{RootCAs: pool.RootCAs, ServerName: "example.com"}
}

func (s *oauthStub) exchangeCount() int {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return s.exchanges
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		fmt.Println("stub encode failure:", err)
	}
}
