// Command loadgen measures latency on Mosaic's hot request paths.
//
// It is a measurement harness, not a benchmark suite: it reports what a given
// deployment did under a stated concurrency and duration so results can be
// recorded as evidence. It deliberately publishes no target numbers.
//
//	loadgen -scenario delivery       -url http://localhost:8080 -key <sdk key> -c 16 -d 30s
//	loadgen -scenario delivery-etag  -url http://localhost:8080 -key <sdk key>
//	loadgen -scenario ingest         -url http://localhost:8080 -key <sdk key> -batch 100
//
// Scenarios:
//
//	delivery       GET /v1/sdk/configuration (cold: no validator)
//	delivery-etag  GET /v1/sdk/configuration with If-None-Match, measuring the 304 path
//	ingest         POST /v1/sdk/events/batch with a synthetic batch
//
// Only the Go standard library is used.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

type options struct {
	scenario    string
	baseURL     string
	key         string
	platform    string
	sdkVersion  string
	concurrency int
	duration    time.Duration
	timeout     time.Duration
	batchSize   int
	warmup      time.Duration
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "loadgen: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	var opts options
	flag.StringVar(&opts.scenario, "scenario", "delivery", "delivery, delivery-etag, or ingest")
	flag.StringVar(&opts.baseURL, "url", "http://localhost:8080", "Mosaic API base URL")
	flag.StringVar(&opts.key, "key", "", "public SDK key (required)")
	flag.StringVar(&opts.platform, "platform", "ios", "SDK platform reported in requests")
	flag.StringVar(&opts.sdkVersion, "sdk-version", "1.0.0", "SDK version reported in requests")
	flag.IntVar(&opts.concurrency, "c", 8, "concurrent workers")
	flag.DurationVar(&opts.duration, "d", 30*time.Second, "measurement duration")
	flag.DurationVar(&opts.timeout, "timeout", 30*time.Second, "per-request timeout")
	flag.IntVar(&opts.batchSize, "batch", 100, "events per ingestion batch")
	flag.DurationVar(&opts.warmup, "warmup", 3*time.Second, "unmeasured warm-up period")
	flag.Parse()

	if opts.key == "" {
		return fmt.Errorf("-key is required")
	}
	if opts.concurrency < 1 {
		return fmt.Errorf("-c must be at least 1")
	}
	switch opts.scenario {
	case "delivery", "delivery-etag", "ingest":
	default:
		return fmt.Errorf("unknown scenario %q", opts.scenario)
	}

	client := &http.Client{
		Timeout: opts.timeout,
		Transport: &http.Transport{
			MaxIdleConns:        opts.concurrency * 2,
			MaxIdleConnsPerHost: opts.concurrency * 2,
		},
	}

	etag := ""
	if opts.scenario == "delivery-etag" {
		tag, err := fetchETag(client, opts)
		if err != nil {
			return fmt.Errorf("prime ETag: %w", err)
		}
		if tag == "" {
			return fmt.Errorf("the delivery endpoint returned no ETag; the 304 path cannot be measured")
		}
		etag = tag
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if opts.warmup > 0 {
		warmupContext, cancel := context.WithTimeout(ctx, opts.warmup)
		_ = drive(warmupContext, client, opts, etag, false)
		cancel()
	}

	measureContext, cancel := context.WithTimeout(ctx, opts.duration)
	defer cancel()
	started := time.Now()
	result := drive(measureContext, client, opts, etag, true)
	result.wall = time.Since(started)
	result.report(opts)
	return nil
}

type outcome struct {
	mu        sync.Mutex
	latencies []time.Duration
	errors    atomic.Int64
	notMod    atomic.Int64
	statuses  sync.Map
	wall      time.Duration
}

func (o *outcome) record(latency time.Duration, status int, err error) {
	if err != nil {
		o.errors.Add(1)
		return
	}
	if status == http.StatusNotModified {
		o.notMod.Add(1)
	}
	if status >= 400 {
		o.errors.Add(1)
	}
	counter, _ := o.statuses.LoadOrStore(status, new(atomic.Int64))
	counter.(*atomic.Int64).Add(1)
	o.mu.Lock()
	o.latencies = append(o.latencies, latency)
	o.mu.Unlock()
}

func (o *outcome) report(opts options) {
	o.mu.Lock()
	latencies := append([]time.Duration(nil), o.latencies...)
	o.mu.Unlock()
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })

	total := len(latencies) + int(o.errors.Load())
	fmt.Printf("scenario:      %s\n", opts.scenario)
	fmt.Printf("concurrency:   %d\n", opts.concurrency)
	fmt.Printf("duration:      %s\n", o.wall.Round(time.Millisecond))
	fmt.Printf("requests:      %d\n", total)
	if o.wall > 0 {
		fmt.Printf("throughput:    %.1f req/s\n", float64(total)/o.wall.Seconds())
	}
	fmt.Printf("errors:        %d\n", o.errors.Load())
	if total > 0 {
		fmt.Printf("error rate:    %.4f\n", float64(o.errors.Load())/float64(total))
	}
	if len(latencies) > 0 {
		fmt.Printf("median:        %s\n", percentile(latencies, 0.50).Round(time.Microsecond))
		fmt.Printf("p95:           %s\n", percentile(latencies, 0.95).Round(time.Microsecond))
		fmt.Printf("p99:           %s\n", percentile(latencies, 0.99).Round(time.Microsecond))
		fmt.Printf("max:           %s\n", latencies[len(latencies)-1].Round(time.Microsecond))
	}
	if opts.scenario == "delivery-etag" && total > 0 {
		fmt.Printf("304 ratio:     %.4f\n", float64(o.notMod.Load())/float64(total))
	}
	fmt.Printf("status codes:\n")
	o.statuses.Range(func(status, counter any) bool {
		fmt.Printf("  %d: %d\n", status, counter.(*atomic.Int64).Load())
		return true
	})
}

func percentile(sorted []time.Duration, fraction float64) time.Duration {
	if len(sorted) == 0 {
		return 0
	}
	index := int(float64(len(sorted)-1) * fraction)
	return sorted[index]
}

func drive(ctx context.Context, client *http.Client, opts options, etag string, measure bool) *outcome {
	result := &outcome{}
	var group sync.WaitGroup
	for worker := range opts.concurrency {
		group.Add(1)
		go func(worker int) {
			defer group.Done()
			for ctx.Err() == nil {
				started := time.Now()
				status, err := issue(ctx, client, opts, etag, worker)
				if ctx.Err() != nil {
					return
				}
				if measure {
					result.record(time.Since(started), status, err)
				}
			}
		}(worker)
	}
	group.Wait()
	return result
}

func issue(ctx context.Context, client *http.Client, opts options, etag string, worker int) (int, error) {
	switch opts.scenario {
	case "ingest":
		return postBatch(ctx, client, opts, worker)
	default:
		return getConfiguration(ctx, client, opts, etag)
	}
}

// paywallCapabilities is the full Paywall 0.2 capability vocabulary a current
// SDK advertises. Capability negotiation is a closed contract: a request that
// advertises nothing is answered 406 for every delivery version, so without
// these headers the delivery scenarios measured the refusal path and never
// reached a Configuration Release.
var paywallCapabilities = []string{
	"layout.scrollContainer", "layout.stack", "layout.sizing", "layout.heightSizing", "layout.outerInsets",
	"navigation.screens", "navigation.sheets",
	"component.text", "component.image", "component.icon", "component.featureList", "component.productSelector",
	"component.productCard", "component.productBadge", "component.button", "component.carousel",
	"component.switch", "component.countdown",
	"localization.catalogs", "localization.rtl", "localization.productTemplate", "product.references",
	"asset.bundledImage", "asset.remoteImage", "asset.bundledVideo", "asset.remoteVideo",
	"action.purchase", "action.restore", "action.close", "action.navigateTo", "action.navigateBack",
	"action.openExternalUrl",
	"accessibility.metadata", "fallback.asset", "fallback.product", "outcome.normalized",
	"style.colors", "style.designTokens", "style.gradientBackground", "style.mediaBackground", "style.shadow",
	"style.box", "style.clipping", "style.typography", "style.productCardStates",
	"visibility.static", "condition.switchVisibility",
}

var experimentFeatures = []string{
	"allocation.ranges", "assignment.installation", "assignment.identified_user",
	"assignment.identified_user_or_installation", "fallback.normal_placement",
	"group.mutual_exclusion", "override.qa", "schedule.trusted_server_time",
}

// setCapabilityHeaders makes the request look like a current SDK that supports
// every delivery contract, so negotiation selects the highest representation
// the Environment actually serves.
func setCapabilityHeaders(request *http.Request, opts options) {
	request.Header.Set("Authorization", "Bearer "+opts.key)
	request.Header.Set("Mosaic-SDK-Platform", opts.platform)
	request.Header.Set("Mosaic-SDK-Version", opts.sdkVersion)
	request.Header.Set("Mosaic-Configuration-Versions", "3,2,1")
	request.Header.Set("Mosaic-Paywall-Protocol-Versions", "0.2")
	capabilities := make([]string, 0, len(paywallCapabilities))
	for _, name := range paywallCapabilities {
		capabilities = append(capabilities, name+"@0.2")
	}
	request.Header.Set("Mosaic-Paywall-Capabilities", strings.Join(capabilities, ","))
	request.Header.Set("Mosaic-Placement-Decision-Versions", "1")
	request.Header.Set("Mosaic-Decision-Features", "source.device.platform,source.identity.user_present,outcome.paywall,outcome.no_paywall,outcome.fallback")
	request.Header.Set("Mosaic-Bucketing-Algorithms", "sha256_length_prefixed_v1")
	request.Header.Set("Mosaic-Experiment-Assignment-Versions", "1")
	request.Header.Set("Mosaic-Experiment-Features", strings.Join(experimentFeatures, ","))
	request.Header.Set("Mosaic-Experiment-Bucketing-Algorithms", "experiment_sha256_length_prefixed_v1")
	request.Header.Set("Mosaic-Experiment-Schedule-Policies", "trusted_server_time_v1")
}

func getConfiguration(ctx context.Context, client *http.Client, opts options, etag string) (int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet,
		opts.baseURL+"/v1/sdk/configuration", nil)
	if err != nil {
		return 0, err
	}
	setCapabilityHeaders(request, opts)
	if etag != "" {
		request.Header.Set("If-None-Match", etag)
	}
	response, err := client.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, response.Body)
	return response.StatusCode, nil
}

func fetchETag(client *http.Client, opts options) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), opts.timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, opts.baseURL+"/v1/sdk/configuration", nil)
	if err != nil {
		return "", err
	}
	setCapabilityHeaders(request, opts)
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, response.Body)
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("delivery returned HTTP %d", response.StatusCode)
	}
	return response.Header.Get("ETag"), nil
}

func postBatch(ctx context.Context, client *http.Client, opts options, worker int) (int, error) {
	body, err := syntheticBatch(opts, worker)
	if err != nil {
		return 0, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		opts.baseURL+"/v1/sdk/events/batch", bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	request.Header.Set("Authorization", "Bearer "+opts.key)
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, response.Body)
	return response.StatusCode, nil
}

// syntheticBatch builds a schema-valid placement_requested batch. Identifiers
// are random so events are never deduplicated as replays, and no field carries
// anything resembling personal data.
func syntheticBatch(opts options, worker int) ([]byte, error) {
	now := time.Now().UTC()
	timestamp := now.Format("2006-01-02T15:04:05.000Z")
	events := make([]map[string]any, 0, opts.batchSize)
	for range opts.batchSize {
		id, err := randomID()
		if err != nil {
			return nil, err
		}
		events = append(events, map[string]any{
			"eventId":            "loadgen_" + id,
			"eventSchemaVersion": "1",
			"eventName":          "placement_requested",
			"occurredAt":         timestamp,
			"queuedAt":           timestamp,
			"authority":          "client_observed",
			"identity":           map[string]any{"installationId": fmt.Sprintf("loadgen_installation_%d", worker), "generation": 1},
			"sessionId":          fmt.Sprintf("loadgen_session_%d", worker),
			"context": map[string]any{
				"platform": opts.platform, "sdkFamily": opts.platform,
				"sdkVersion": opts.sdkVersion, "applicationVersion": "1.0.0", "locale": "en-US",
			},
			"correlation": map[string]any{"placementRequestId": "loadgen_request_" + id},
			"attribution": map[string]any{"placementId": "loadgen_placement"},
			"payload":     map[string]any{"decisionContractVersion": "1"},
		})
	}
	batchID, err := randomID()
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{
		"analyticsEventContractVersion": "1",
		"batchId":                       "loadgen_batch_" + batchID,
		"sentAt":                        timestamp,
		"events":                        events,
	})
}

func randomID() (string, error) {
	buffer := make([]byte, 12)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return hex.EncodeToString(buffer), nil
}
