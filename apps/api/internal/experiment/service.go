package experiment

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

type Service struct {
	repository Repository
	now        func() time.Time
	random     func([]byte) error
}

func NewService(repository Repository) *Service {
	return &Service{repository: repository, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, random: func(b []byte) error { _, e := rand.Read(b); return e }}
}

func permissions(role string) []string {
	if role == "owner" || role == "admin" {
		return []string{"read", "write", "publish", "lifecycle", "qa", "export"}
	}
	return []string{"read"}
}
func writeScope(scope Scope) error {
	if scope.Role != "owner" && scope.Role != "admin" {
		return ErrForbidden
	}
	return nil
}
func canonical(document DraftDocument) ([]byte, []byte) {
	raw, _ := json.Marshal(document)
	sum := sha256.Sum256(raw)
	return raw, sum[:]
}
func draftETag(id string, revision int64) string {
	return fmt.Sprintf("\"experiment-draft:%s:%d\"", id, revision)
}
func parseMetricVersion(value string) (string, int, bool) {
	parts := strings.Split(value, "@")
	if len(parts) != 2 || parts[0] == "" || parts[1] != "1" {
		return "", 0, false
	}
	return parts[0], 1, true
}

func CompileSchedule(schedule Schedule, publicationTime time.Time) (Schedule, error) {
	if schedule.StartsAt == nil {
		return Schedule{}, ErrInvalid
	}
	compiled := schedule
	if !compiled.StartsAt.After(publicationTime) {
		start := publicationTime
		compiled.StartsAt = &start
	}
	if compiled.EndsAt != nil && !compiled.EndsAt.After(*compiled.StartsAt) {
		return Schedule{}, ErrInvalid
	}
	return compiled, nil
}

func (s *Service) validate(ctx context.Context, scope Scope, document DraftDocument) ValidationResult {
	issues := make([]ValidationIssue, 0)
	add := func(code, severity, message, id, recovery string) {
		issues = append(issues, ValidationIssue{code, severity, message, id, recovery})
	}
	if document.AssignmentKeyPolicy != "installation" && document.AssignmentKeyPolicy != "identified_user" && document.AssignmentKeyPolicy != "identified_user_or_installation" {
		add("assignment_policy_invalid", "error", "Choose a supported assignment identity.", "", "choose_assignment_policy")
	}
	if len(document.Variants) < 2 || len(document.Variants) > 4 {
		add("variant_count_invalid", "error", "Experiments require one Control and one to three Treatments.", "", "add_control_and_treatments")
	}
	control, total := 0, 0
	names := map[string]bool{}
	versions := map[string]bool{}
	for _, v := range document.Variants {
		total += v.AllocationBasisPoints
		if v.Role == "control" {
			control++
		} else if v.Role != "treatment" {
			add("variant_role_invalid", "error", "Variant role must be Control or Treatment.", v.ID, "choose_variant_role")
		}
		if v.Name == "" || names[v.Name] {
			add("variant_name_invalid", "error", "Variant names must be non-empty and unique.", v.ID, "rename_variant")
		}
		names[v.Name] = true
		if v.PaywallID == "" || v.PaywallVersionID == "" || versions[v.PaywallVersionID] {
			add("paywall_version_invalid", "error", "Choose a unique immutable Paywall Version for every Variant.", v.ID, "select_immutable_paywall_version")
		}
		versions[v.PaywallVersionID] = true
		if v.AllocationBasisPoints <= 0 {
			add("allocation_invalid", "error", "Every Variant needs a positive allocation.", v.ID, "set_allocation")
		}
	}
	if control != 1 {
		add("control_count_invalid", "error", "Exactly one Control is required.", "", "choose_one_control")
	}
	if total != 10000 {
		add("allocation_total_invalid", "error", "Allocation must cover exactly 10,000 basis points.", "", "rebalance_allocation")
	}
	if _, _, ok := parseMetricVersion(document.PrimaryMetricVersionID); !ok {
		add("primary_metric_invalid", "error", "Choose an immutable primary metric Version.", "", "select_primary_metric")
	}
	if document.Schedule.EndsAt != nil && (document.Schedule.StartsAt == nil || !document.Schedule.EndsAt.After(*document.Schedule.StartsAt)) {
		add("schedule_invalid", "error", "Schedule end must be after its start.", "", "fix_schedule")
	}
	if document.Schedule.StartsAt == nil {
		add("schedule_required", "error", "A UTC start time is required for offline assignment.", "", "set_schedule")
	}
	if scope.EnvironmentMode == "production" && document.QAPolicy.Enabled {
		add("qa_policy_production", "error", "QA overrides cannot be delivered to production.", "", "disable_qa_policy")
	}
	sort.Slice(issues, func(i, j int) bool { return issues[i].Code < issues[j].Code })
	return ValidationResult{Valid: len(issues) == 0, Issues: issues}
}

func (s *Service) Create(ctx context.Context, actor Actor, projectID, environmentID, placementID, name, hypothesis, key string) (ExperimentResponse, error) {
	ctx, span := otel.Tracer("mosaic/experiment").Start(ctx, "experiment.create", trace.WithAttributes(attribute.String("mosaic.project.id", projectID), attribute.String("mosaic.environment.id", environmentID)))
	defer span.End()
	if actor.ID == "" {
		return ExperimentResponse{}, ErrUnauthenticated
	}
	if strings.TrimSpace(key) == "" {
		return ExperimentResponse{}, ErrPreconditionRequired
	}
	if len(strings.TrimSpace(name)) < 1 || len(name) > 120 {
		return ExperimentResponse{}, ErrInvalid
	}
	scope, err := s.repository.Scope(ctx, actor, projectID, environmentID)
	if err != nil {
		return ExperimentResponse{}, err
	}
	if err = writeScope(scope); err != nil {
		return ExperimentResponse{}, err
	}
	doc := DraftDocument{Variants: []VariantDraft{{Role: "control", Name: "Control", AllocationBasisPoints: 5000}, {Role: "treatment", Name: "Treatment", AllocationBasisPoints: 5000}}, AssignmentKeyPolicy: "installation", Schedule: Schedule{}, GuardrailMetricVersionIDs: []string{}, QAPolicy: QAPolicy{}}
	validation := s.validate(ctx, scope, doc)
	raw, digest := canonical(doc)
	keySum := sha256.Sum256([]byte(key))
	exp, draft, err := s.repository.Create(ctx, scope, actor, placementID, strings.TrimSpace(name), strings.TrimSpace(hypothesis), doc, validation, keySum[:], digest, s.now())
	_ = raw
	if err != nil {
		return ExperimentResponse{}, err
	}
	return response(exp, &draft, nil, scope.Role), nil
}

func response(e Experiment, d *DraftResource, v *VersionResponse, role string) ExperimentResponse {
	return ExperimentResponse{ID: e.ID, ProjectID: e.ProjectID, EnvironmentID: e.EnvironmentID, PlacementID: e.PlacementID, Name: e.Name, Hypothesis: e.Hypothesis, State: e.State, CurrentDraft: d, ActiveVersion: v, Role: role, Permissions: permissions(role), CreatedAt: e.CreatedAt, UpdatedAt: e.UpdatedAt, ArchivedAt: e.ArchivedAt}
}

func (s *Service) List(ctx context.Context, actor Actor, projectID, environmentID string) ([]ExperimentResponse, error) {
	scope, e := s.repository.Scope(ctx, actor, projectID, environmentID)
	if e != nil {
		return nil, e
	}
	items, e := s.repository.List(ctx, scope)
	if e != nil {
		return nil, e
	}
	out := make([]ExperimentResponse, 0, len(items))
	for _, item := range items {
		out = append(out, response(item, nil, nil, scope.Role))
	}
	return out, nil
}
func (s *Service) Get(ctx context.Context, actor Actor, projectID, environmentID, id string) (ExperimentResponse, error) {
	scope, e := s.repository.Scope(ctx, actor, projectID, environmentID)
	if e != nil {
		return ExperimentResponse{}, e
	}
	item, d, v, e := s.repository.Get(ctx, scope, id)
	if e != nil {
		return ExperimentResponse{}, e
	}
	var dr *DraftResource
	if d != nil {
		x := DraftResource{ID: d.Draft.ID, Revision: d.Draft.Revision, Status: d.Draft.Status, Document: d.Document, Validation: d.Validation, UpdatedAt: d.Draft.UpdatedAt, ETag: draftETag(d.Draft.ID, d.Draft.Revision)}
		dr = &x
	}
	return response(item, dr, v, scope.Role), nil
}

func (s *Service) UpdateDraft(ctx context.Context, actor Actor, projectID, environmentID, id, ifMatch, key string, document DraftDocument) (DraftResource, error) {
	if ifMatch == "" || key == "" {
		return DraftResource{}, ErrPreconditionRequired
	}
	scope, e := s.repository.Scope(ctx, actor, projectID, environmentID)
	if e != nil {
		return DraftResource{}, e
	}
	if e = writeScope(scope); e != nil {
		return DraftResource{}, e
	}
	item, d, _, e := s.repository.Get(ctx, scope, id)
	if e != nil || d == nil {
		return DraftResource{}, e
	}
	if item.State != "draft" || d.Draft.Status != "active" {
		return DraftResource{}, ErrConflict
	}
	if ifMatch != draftETag(d.Draft.ID, d.Draft.Revision) {
		return DraftResource{}, &ConflictError{Revision: d.Draft.Revision, ETag: draftETag(d.Draft.ID, d.Draft.Revision)}
	}
	validation := s.validate(ctx, scope, document)
	_, request := canonical(document)
	mutation := sha256.Sum256([]byte(key))
	return s.repository.UpdateDraft(ctx, scope, actor, id, d.Draft.Revision, mutation[:], request, document, validation, s.now())
}
func (s *Service) Validate(ctx context.Context, actor Actor, projectID, environmentID, id string) (ValidationResult, error) {
	scope, e := s.repository.Scope(ctx, actor, projectID, environmentID)
	if e != nil {
		return ValidationResult{}, e
	}
	_, d, _, e := s.repository.Get(ctx, scope, id)
	if e != nil || d == nil {
		return ValidationResult{}, e
	}
	return s.validate(ctx, scope, d.Document), nil
}
func (s *Service) Publish(ctx context.Context, actor Actor, projectID, environmentID, id string, revision int64) (VersionResponse, error) {
	scope, e := s.repository.Scope(ctx, actor, projectID, environmentID)
	if e != nil {
		return VersionResponse{}, e
	}
	if e = writeScope(scope); e != nil {
		return VersionResponse{}, e
	}
	item, d, _, e := s.repository.Get(ctx, scope, id)
	if e != nil || d == nil {
		return VersionResponse{}, e
	}
	if d.Draft.Revision != revision {
		return VersionResponse{}, &ConflictError{Revision: d.Draft.Revision, ETag: draftETag(d.Draft.ID, d.Draft.Revision)}
	}
	validation := s.validate(ctx, scope, d.Document)
	if !validation.Valid {
		return VersionResponse{}, &ValidationError{Result: validation}
	}
	_, digest := canonical(d.Document)
	out, e := s.repository.Publish(ctx, scope, PublishInput{Experiment: item, Draft: d.Draft, Document: d.Document, Validation: validation, Digest: digest, ActorID: actor.ID, Now: s.now()})
	return out.Version, e
}

var transitions = map[string]map[string]bool{"draft": {"scheduled": true, "running": true}, "scheduled": {"running": true, "stopped": true}, "running": {"paused": true, "stopped": true, "completed": true}, "paused": {"running": true, "stopped": true, "completed": true}, "stopped": {"archived": true}, "completed": {"archived": true}}

func (s *Service) Transition(ctx context.Context, actor Actor, projectID, environmentID, id, target, reason string) (ExperimentResponse, error) {
	scope, e := s.repository.Scope(ctx, actor, projectID, environmentID)
	if e != nil {
		return ExperimentResponse{}, e
	}
	if e = writeScope(scope); e != nil {
		return ExperimentResponse{}, e
	}
	current, _, _, e := s.repository.Get(ctx, scope, id)
	if e != nil {
		return ExperimentResponse{}, e
	}
	if !transitions[current.State][target] {
		return ExperimentResponse{}, ErrConflict
	}
	if (target == "stopped" || target == "completed" || target == "archived") && strings.TrimSpace(reason) == "" {
		return ExperimentResponse{}, ErrInvalid
	}
	updated, _, e := s.repository.Transition(ctx, scope, actor, id, target, strings.TrimSpace(reason), s.now())
	if e != nil {
		return ExperimentResponse{}, e
	}
	return response(updated, nil, nil, scope.Role), nil
}
func (s *Service) Versions(ctx context.Context, actor Actor, p, e, id string) ([]VersionResponse, error) {
	scope, x := s.repository.Scope(ctx, actor, p, e)
	if x != nil {
		return nil, x
	}
	return s.repository.Versions(ctx, scope, id)
}
func (s *Service) History(ctx context.Context, actor Actor, p, e, id string) ([]HistoryEntry, error) {
	scope, x := s.repository.Scope(ctx, actor, p, e)
	if x != nil {
		return nil, x
	}
	return s.repository.History(ctx, scope, id)
}
func (s *Service) Metrics(ctx context.Context, actor Actor, p, e string) ([]MetricDefinition, error) {
	scope, x := s.repository.Scope(ctx, actor, p, e)
	if x != nil {
		return nil, x
	}
	_ = scope
	return s.repository.Metrics(ctx)
}
func (s *Service) Groups(ctx context.Context, actor Actor, p, e string) ([]Group, error) {
	scope, x := s.repository.Scope(ctx, actor, p, e)
	if x != nil {
		return nil, x
	}
	return s.repository.Groups(ctx, scope)
}
func validateGroupInput(input CreateGroupInput, requireName bool) error {
	if requireName && (strings.TrimSpace(input.Name) == "" || len(input.Name) > 120) {
		return ErrInvalid
	}
	if input.AssignmentKeyPolicy != "installation" && input.AssignmentKeyPolicy != "identified_user" && input.AssignmentKeyPolicy != "identified_user_or_installation" {
		return ErrInvalid
	}
	total := input.HoldoutBasisPoints
	seen := map[string]bool{}
	for _, m := range input.Members {
		if m.ExperimentID == "" || m.AllocationBasisPoints <= 0 || seen[m.ExperimentID] {
			return ErrInvalid
		}
		seen[m.ExperimentID] = true
		total += m.AllocationBasisPoints
	}
	if len(input.Members) == 0 || total != 10000 {
		return ErrInvalid
	}
	return nil
}

func (s *Service) CreateGroup(ctx context.Context, actor Actor, p, e string, input CreateGroupInput) (GroupCreated, error) {
	scope, err := s.repository.Scope(ctx, actor, p, e)
	if err != nil {
		return GroupCreated{}, err
	}
	if err = writeScope(scope); err != nil {
		return GroupCreated{}, err
	}
	if err = validateGroupInput(input, true); err != nil {
		return GroupCreated{}, ErrInvalid
	}
	return s.repository.CreateGroup(ctx, scope, actor, input, s.now())
}
func (s *Service) CreateGroupVersion(ctx context.Context, actor Actor, p, e, groupID string, input CreateGroupInput) (GroupVersion, error) {
	scope, err := s.repository.Scope(ctx, actor, p, e)
	if err != nil {
		return GroupVersion{}, err
	}
	if err = writeScope(scope); err != nil {
		return GroupVersion{}, err
	}
	if err = validateGroupInput(input, false); err != nil {
		return GroupVersion{}, ErrInvalid
	}
	return s.repository.CreateGroupVersion(ctx, scope, actor, groupID, input, s.now())
}
func (s *Service) GroupVersions(ctx context.Context, actor Actor, p, e, groupID string) ([]GroupVersion, error) {
	scope, err := s.repository.Scope(ctx, actor, p, e)
	if err != nil {
		return nil, err
	}
	return s.repository.GroupVersions(ctx, scope, groupID)
}

func (s *Service) Results(ctx context.Context, actor Actor, p, e, id string) (Results, error) {
	scope, x := s.repository.Scope(ctx, actor, p, e)
	if x != nil {
		return Results{}, x
	}
	exp, version, values, x := s.repository.Aggregates(ctx, scope, id)
	if x != nil {
		return Results{}, x
	}
	result := Results{ExperimentID: id, ExperimentVersionID: version.ID, State: exp.State, Interim: exp.State != "completed", Warnings: []string{}, Guardrails: []GuardrailResult{}, Variants: []VariantResult{}, Lifts: []LiftResult{}}
	var control *VariantAggregate
	var conversions int64
	for i := range values {
		v := values[i]
		estimate := 0.0
		if v.UniqueExposures > 0 {
			estimate = float64(v.UniqueConversions) / float64(v.UniqueExposures)
		}
		result.Variants = append(result.Variants, VariantResult{v.VariantID, v.Role, v.AllocationBasisPoints, v.UniqueExposures, v.UniqueConversions, estimate, Wilson(v.UniqueConversions, v.UniqueExposures), v.RawExposureEvents, v.FallbackPresentations})
		conversions += v.UniqueConversions
		if v.Role == "control" {
			control = &values[i]
		}
		if v.UniqueExposures < 100 {
			result.Warnings = append(result.Warnings, "minimum_variant_exposures")
		}
		if v.LatestReceivedAt != nil && (result.Freshness == nil || v.LatestReceivedAt.After(*result.Freshness)) {
			result.Freshness = v.LatestReceivedAt
		}
	}
	if control != nil {
		cp := 0.0
		if control.UniqueExposures > 0 {
			cp = float64(control.UniqueConversions) / float64(control.UniqueExposures)
		}
		for _, v := range values {
			if v.Role != "treatment" {
				continue
			}
			tp := 0.0
			if v.UniqueExposures > 0 {
				tp = float64(v.UniqueConversions) / float64(v.UniqueExposures)
			}
			var relative *float64
			if cp > 0 {
				q := (tp - cp) / cp
				relative = &q
			}
			result.Lifts = append(result.Lifts, LiftResult{v.VariantID, tp - cp, Newcombe(control.UniqueConversions, control.UniqueExposures, v.UniqueConversions, v.UniqueExposures), relative})
		}
	}
	if conversions < 20 {
		result.Warnings = append(result.Warnings, "minimum_total_conversions")
	}
	if result.Freshness == nil || s.now().Sub(*result.Freshness) > 15*time.Minute {
		result.Warnings = append(result.Warnings, "aggregate_stale")
	}
	result.SRM = SampleRatioMismatch(values)
	guardrails, guardrailErr := s.repository.GuardrailAggregates(ctx, scope, version.ID)
	if guardrailErr != nil {
		return Results{}, guardrailErr
	}
	for _, aggregate := range guardrails {
		compiled := compileGuardrail(exp, aggregate, s.now())
		result.Guardrails = append(result.Guardrails, compiled)
		if compiled.Status == "warning" || compiled.Status == "stale" {
			result.Warnings = append(result.Warnings, "guardrail_"+compiled.Status+":"+compiled.MetricVersionID)
		}
	}
	return result, nil
}

func compileGuardrail(exp Experiment, aggregate GuardrailAggregate, now time.Time) GuardrailResult {
	result := GuardrailResult{
		MetricVersionID: fmt.Sprintf("%s@%d", aggregate.Definition.ID, aggregate.Definition.Version),
		Name:            aggregate.Definition.Name,
		Status:          "insufficient_data",
		Variants:        []GuardrailVariantResult{},
		Maturity: GuardrailMaturity{
			Status:                    "insufficient_sample",
			MinimumVariantDenominator: 0,
		},
	}
	minimum := int64(-1)
	controlRate := 0.0
	treatmentWorse := false
	for _, value := range aggregate.Variants {
		rate := 0.0
		if value.UniqueExposures > 0 {
			rate = float64(value.UniqueConversions) / float64(value.UniqueExposures)
		}
		result.Variants = append(result.Variants, GuardrailVariantResult{VariantID: value.VariantID, Role: value.Role, DenominatorCount: value.UniqueExposures, NumeratorCount: value.UniqueConversions, Rate: rate})
		result.DenominatorCount += value.UniqueExposures
		result.NumeratorCount += value.UniqueConversions
		if minimum < 0 || value.UniqueExposures < minimum {
			minimum = value.UniqueExposures
		}
		if value.Role == "control" {
			controlRate = rate
		}
		if value.LatestReceivedAt != nil && (result.Freshness == nil || value.LatestReceivedAt.After(*result.Freshness)) {
			result.Freshness = value.LatestReceivedAt
		}
	}
	if minimum < 0 {
		minimum = 0
	}
	result.Maturity.MinimumVariantDenominator = minimum
	if result.DenominatorCount > 0 {
		result.Rate = float64(result.NumeratorCount) / float64(result.DenominatorCount)
	}
	terminal := exp.State == "completed" || exp.State == "stopped"
	result.Maturity.AttributionWindowClosed = terminal && !now.Before(exp.UpdatedAt.Add(time.Duration(aggregate.Definition.AttributionWindowSeconds)*time.Second))
	if minimum >= 100 && result.Maturity.AttributionWindowClosed {
		result.Maturity.Status = "mature"
	} else if !terminal || !result.Maturity.AttributionWindowClosed {
		result.Maturity.Status = "interim"
	}
	for _, value := range result.Variants {
		if value.Role == "treatment" && value.Rate > controlRate {
			treatmentWorse = true
		}
	}
	if result.DenominatorCount == 0 {
		return result
	}
	if result.Freshness == nil || now.Sub(*result.Freshness) > time.Duration(aggregate.Definition.FreshnessSeconds)*time.Second {
		result.Status = "stale"
	} else if result.Maturity.Status != "mature" {
		result.Status = "insufficient_data"
	} else if treatmentWorse {
		result.Status = "warning"
	} else {
		result.Status = "healthy"
	}
	return result
}

func (s *Service) CreateOverride(ctx context.Context, actor Actor, p, e, id, versionID, variantID, identityType, label string, expiresAt time.Time) (QAOverrideCreated, error) {
	scope, x := s.repository.Scope(ctx, actor, p, e)
	if x != nil {
		return QAOverrideCreated{}, x
	}
	if x = writeScope(scope); x != nil {
		return QAOverrideCreated{}, x
	}
	if scope.EnvironmentMode == "production" || expiresAt.After(s.now().Add(24*time.Hour)) || !expiresAt.After(s.now()) {
		return QAOverrideCreated{}, ErrInvalid
	}
	tokenBytes := make([]byte, 32)
	if x = s.random(tokenBytes); x != nil {
		return QAOverrideCreated{}, x
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	digest := sha256.Sum256([]byte(token))
	override, x := s.repository.CreateOverride(ctx, scope, actor, id, versionID, variantID, identityType, label, digest[:], s.now(), expiresAt)
	return QAOverrideCreated{Override: override, Token: token}, x
}
func (s *Service) Overrides(ctx context.Context, actor Actor, p, e, id string) ([]QAOverride, error) {
	scope, x := s.repository.Scope(ctx, actor, p, e)
	if x != nil {
		return nil, x
	}
	return s.repository.Overrides(ctx, scope, id, s.now())
}
func (s *Service) RevokeOverride(ctx context.Context, actor Actor, p, e, id, overrideID string) error {
	scope, x := s.repository.Scope(ctx, actor, p, e)
	if x != nil {
		return x
	}
	if x = writeScope(scope); x != nil {
		return x
	}
	return s.repository.RevokeOverride(ctx, scope, actor, id, overrideID, s.now())
}

func (s *Service) ProcessNextSchedule(ctx context.Context, worker string) (bool, error) {
	now := s.now()
	job, ok, err := s.repository.LeaseSchedule(ctx, worker, now, now.Add(2*time.Minute))
	if err != nil || !ok {
		return ok, err
	}
	target := "running"
	reason := "scheduled_start"
	if job.Action == "complete" {
		target = "completed"
		reason = "scheduled_end"
	}
	_, err = s.Transition(ctx, Actor{ID: job.ActorID}, job.ProjectID, job.EnvironmentID, job.ExperimentID, target, reason)
	finishErr := s.repository.FinishSchedule(ctx, job.ID, err == nil, s.now())
	if err != nil {
		return true, err
	}
	return true, finishErr
}
