// Command healthcheck performs a single HTTP probe and exits 0 on success.
//
// The Mosaic runtime image is distroless and contains no shell, curl, or wget,
// so container healthchecks need a probe binary that ships inside the image.
//
//	healthcheck http://127.0.0.1:8080/health/ready
package main

import (
	"fmt"
	"net/http"
	"os"
	"time"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: healthcheck <url>")
		os.Exit(2)
	}
	client := &http.Client{Timeout: 5 * time.Second}
	response, err := client.Get(os.Args[1])
	if err != nil {
		fmt.Fprintf(os.Stderr, "probe failed: %v\n", err)
		os.Exit(1)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		fmt.Fprintf(os.Stderr, "probe returned HTTP %d\n", response.StatusCode)
		os.Exit(1)
	}
}
