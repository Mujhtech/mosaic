package response

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"strings"

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

func Error(w http.ResponseWriter, r *http.Request, err error) {
	status, payload := errorDetails(err)
	payload.RequestID = chimiddleware.GetReqID(r.Context())
	writeJSON(w, r, status, errorEnvelope{Error: payload})
}

func RequestTimeout(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, r, http.StatusGatewayTimeout, errorEnvelope{Error: errorPayload{
		Code:      requestTimeoutCode,
		Message:   requestTimeoutMessage,
		RequestID: chimiddleware.GetReqID(r.Context()),
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
	if apiError.Status >= http.StatusInternalServerError {
		return internalError()
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
	}
}

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
