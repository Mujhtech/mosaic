package response

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/render"
	"github.com/rs/zerolog"
)

const (
	RequestIDHeader = "X-Request-ID"

	internalErrorCode     = "internal_error"
	internalErrorMessage  = "An unexpected error occurred."
	requestErrorCode      = "request_failed"
	requestErrorMessage   = "The request could not be completed."
	requestTimeoutCode    = "request_timeout"
	requestTimeoutMessage = "The request timed out."
)

type APIError struct {
	Status  int
	Code    string
	Message string
	Fields  map[string][]string
	Details map[string]any
	Cause   error
}

type successEnvelope struct {
	Data any `json:"data"`
}

type errorEnvelope struct {
	Error errorPayload `json:"error"`
}

type errorPayload struct {
	Code      string              `json:"code"`
	Message   string              `json:"message"`
	Fields    map[string][]string `json:"fields,omitempty"`
	Details   map[string]any      `json:"details,omitempty"`
	RequestID string              `json:"requestId,omitempty"`
}

func (err *APIError) Error() string {
	if err.Cause != nil {
		return err.Cause.Error()
	}
	if err.Code != "" {
		return err.Code
	}
	return requestErrorCode
}

func (err *APIError) Unwrap() error {
	return err.Cause
}

func NewAPIError(status int, code string, message string) *APIError {
	return &APIError{
		Status:  status,
		Code:    code,
		Message: message,
	}
}

func ValidationFailed(fields map[string][]string) *APIError {
	return &APIError{
		Status:  http.StatusUnprocessableEntity,
		Code:    "validation_failed",
		Message: "The request contains invalid fields.",
		Fields:  cloneFields(fields),
	}
}

func OK(w http.ResponseWriter, r *http.Request, data any) {
	writeJSON(w, r, http.StatusOK, successEnvelope{Data: data})
}

func Created(w http.ResponseWriter, r *http.Request, data any) {
	writeJSON(w, r, http.StatusCreated, successEnvelope{Data: data})
}

func Accepted(w http.ResponseWriter, r *http.Request, data any) {
	writeJSON(w, r, http.StatusAccepted, successEnvelope{Data: data})
}

func NoContent(w http.ResponseWriter, r *http.Request) {
	render.NoContent(w, r)
}

// Representation writes an already validated representation. It is used by
// protocol endpoints whose wire contract is not the dashboard data envelope.
func Representation(w http.ResponseWriter, status int, contentType string, body []byte) {
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(status)
	if status != http.StatusNotModified {
		_, _ = w.Write(body)
	}
}

func Error(w http.ResponseWriter, r *http.Request, err error) {
	status, payload := errorDetails(err)
	payload.RequestID = chimiddleware.GetReqID(r.Context())
	if status >= http.StatusInternalServerError {
		logUnexpectedError(r, status, payload.RequestID, err)
	}
	writeJSON(w, r, status, errorEnvelope{Error: payload})
}

// logUnexpectedError records the cause behind a 5xx response. The response body
// deliberately carries only `internal_error` and a request ID, so without this
// the cause was discarded entirely: an operator following any "the API returned
// 500" runbook saw nothing but an access-log line with http_status 500 and had
// no way to reach the underlying error. The cause is written to the operator log
// only — never to the response — and the request ID ties the two together.
func logUnexpectedError(r *http.Request, status int, requestID string, err error) {
	event := zerolog.Ctx(r.Context()).Error().
		Int("http_status", status).
		Str("http_method", r.Method)
	if route := chi.RouteContext(r.Context()); route != nil && route.RoutePattern() != "" {
		event = event.Str("http_route", route.RoutePattern())
	}
	if requestID != "" {
		event = event.Str("request_id", requestID)
	}
	event.Err(err).Msg("request failed with an unexpected error")
}

func RequestTimeout(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, r, http.StatusGatewayTimeout, errorEnvelope{Error: errorPayload{
		Code:      requestTimeoutCode,
		Message:   requestTimeoutMessage,
		RequestID: chimiddleware.GetReqID(r.Context()),
	}})
}

func ServiceUnavailable(w http.ResponseWriter, r *http.Request, code, message string) {
	ServiceUnavailableWithDetails(w, r, code, message, nil)
}

// ServiceUnavailableWithDetails adds safe machine-readable diagnostics such as
// per-dependency readiness codes. Details must never contain credentials,
// connection strings, or internal topology.
func ServiceUnavailableWithDetails(w http.ResponseWriter, r *http.Request, code, message string, details map[string]any) {
	writeJSON(w, r, http.StatusServiceUnavailable, errorEnvelope{Error: errorPayload{
		Code: code, Message: message, Details: cloneDetails(details), RequestID: chimiddleware.GetReqID(r.Context()),
	}})
}

func errorDetails(err error) (int, errorPayload) {
	var apiError *APIError
	if !errors.As(err, &apiError) || apiError == nil {
		return internalError()
	}

	if apiError.Status < http.StatusBadRequest || apiError.Status > 599 {
		return internalError()
	}
	// A 500 is by definition the unexpected bucket: never trust whatever code
	// or message reached it, and never let a cause escape.
	//
	// Statuses above 500 are different. A handler that answers 503
	// `providerUnavailable` or 502 `providerInvalidResponse` chose a safe,
	// documented, machine-readable outcome that an SDK uses to decide whether
	// to retry. Collapsing every 5xx into 500 `internal_error` erased all of
	// them: every deliberate upstream-failure code in the OpenAPI contract was
	// unreachable, and clients could not tell "the provider is down, retry"
	// from "Mosaic is broken". A code is still required, so an APIError that
	// forgot to set one degrades to internal_error rather than leaking.
	if apiError.Status == http.StatusInternalServerError || apiError.Code == "" {
		return internalError()
	}
	// Above 500 the status and code are preserved but the message is replaced.
	// Codes are Mosaic-owned constants and safe by construction; messages are
	// free text and are where internal topology leaks (a readiness message
	// naming a database host, for example). Clients need the code, not the
	// prose.
	if apiError.Status > http.StatusInternalServerError {
		return apiError.Status, errorPayload{
			Code:    apiError.Code,
			Message: upstreamFailureMessage,
			Details: cloneDetails(apiError.Details),
		}
	}

	code := apiError.Code
	if code == "" {
		code = requestErrorCode
	}
	message := apiError.Message
	if message == "" {
		message = requestErrorMessage
	}

	return apiError.Status, errorPayload{
		Code:    code,
		Message: message,
		Fields:  cloneFields(apiError.Fields),
		Details: cloneDetails(apiError.Details),
	}
}

// upstreamFailureMessage is the fixed human text for a deliberate 5xx above
// 500. The machine-readable code carries the meaning.
const upstreamFailureMessage = "The request could not be completed because a dependency failed. Retry may succeed."

func internalError() (int, errorPayload) {
	return http.StatusInternalServerError, errorPayload{
		Code:    internalErrorCode,
		Message: internalErrorMessage,
	}
}

func writeJSON(w http.ResponseWriter, r *http.Request, status int, payload any) {
	render.Status(r, status)

	buffer := newBufferedResponseWriter()
	render.JSON(buffer, r, payload)
	if buffer.status != status || !strings.HasPrefix(
		buffer.Header().Get("Content-Type"),
		"application/json",
	) {
		logSerializationFailure(r, status, payload)
		writeInternalError(w, r)
		return
	}

	copyHeaders(w.Header(), buffer.Header())
	w.WriteHeader(buffer.status)
	_, _ = w.Write(buffer.body.Bytes())
}

func writeInternalError(w http.ResponseWriter, r *http.Request) {
	status, payload := internalError()
	payload.RequestID = chimiddleware.GetReqID(r.Context())

	render.Status(r, status)
	render.JSON(w, r, errorEnvelope{Error: payload})
}

func logSerializationFailure(r *http.Request, status int, payload any) {
	zerolog.Ctx(r.Context()).Error().
		Int("intended_http_status", status).
		Str("response_payload_type", payloadType(payload)).
		Msg("http response serialization failed")
}

func payloadType(payload any) string {
	if envelope, ok := payload.(successEnvelope); ok {
		return fmt.Sprintf("%T", envelope.Data)
	}
	return fmt.Sprintf("%T", payload)
}

func copyHeaders(destination http.Header, source http.Header) {
	for key, values := range source {
		destination[key] = append([]string(nil), values...)
	}
}

type bufferedResponseWriter struct {
	header http.Header
	body   bytes.Buffer
	status int
}

func newBufferedResponseWriter() *bufferedResponseWriter {
	return &bufferedResponseWriter{header: make(http.Header)}
}

func (w *bufferedResponseWriter) Header() http.Header {
	return w.header
}

func (w *bufferedResponseWriter) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
}

func (w *bufferedResponseWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.body.Write(data)
}

func cloneFields(fields map[string][]string) map[string][]string {
	if len(fields) == 0 {
		return nil
	}

	cloned := make(map[string][]string, len(fields))
	for field, messages := range fields {
		cloned[field] = append([]string(nil), messages...)
	}

	return cloned
}

func cloneDetails(details map[string]any) map[string]any {
	if len(details) == 0 {
		return nil
	}
	cloned := make(map[string]any, len(details))
	for key, value := range details {
		cloned[key] = value
	}
	return cloned
}
