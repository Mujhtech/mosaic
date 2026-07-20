package cloudworkspace

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
)

func (s *Service) CreateProject(ctx context.Context, actor Actor, organizationID, key, name string) (Project, error) {
	ctx, span := s.operation(ctx, "project.create", actor, attribute.String("mosaic.organization.id", organizationID))
	defer span.End()
	var result Project
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		if _, ok := tx.Organization(organizationID); !ok {
			return ErrNotFound
		}
		if _, err := requireWriter(tx, actor, organizationID); err != nil {
			return err
		}
		for _, project := range tx.Projects(organizationID) {
			if project.Key == key {
				return &ConflictError{Resource: "project", Field: "key"}
			}
		}
		now := s.now()
		result = Project{ID: tx.NextID("project"), OrganizationID: organizationID, Key: key, Name: name, Status: ProjectActive, CreatedAt: now, UpdatedAt: now}
		tx.SaveProject(result)
		for _, environment := range []struct{ key, name string }{{"development", "Development"}, {"staging", "Staging"}, {"production", "Production"}} {
			tx.SaveEnvironment(Environment{ID: tx.NextID("env"), ProjectID: result.ID, Key: environment.key, Name: environment.name, CreatedAt: now, UpdatedAt: now})
		}
		s.audit(tx, actor, organizationID, result.ID, "", "project.created", "project", result.ID, map[string]string{"key": key})
		return nil
	})
	if err == nil {
		logMutation(ctx, "project.created", actor, organizationID, result.ID, result.ID)
	}
	return result, err
}

func (s *Service) ListProjects(ctx context.Context, actor Actor, organizationID string, status ProjectStatus, options ListOptions) (List[Project], error) {
	var values []Project
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, ok := reader.Organization(organizationID); !ok {
			return ErrNotFound
		}
		if _, err := roleFor(reader, actor, organizationID); err != nil {
			return err
		}
		for _, project := range reader.Projects(organizationID) {
			if status == "" || project.Status == status {
				values = append(values, project)
			}
		}
		return nil
	})
	return paginated(values, options, func(value Project) string { return value.ID }, err)
}

func (s *Service) GetProject(ctx context.Context, actor Actor, projectID string) (Project, error) {
	var result Project
	err := s.repository.View(ctx, func(reader Reader) error {
		project, _, err := projectScope(reader, actor, projectID, false)
		result = project
		return err
	})
	return result, err
}

func (s *Service) UpdateProject(ctx context.Context, actor Actor, projectID, name string) (Project, error) {
	ctx, span := s.operation(ctx, "project.update", actor, attribute.String("mosaic.project.id", projectID))
	defer span.End()
	var result Project
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		project, _, err := projectScope(tx, actor, projectID, true)
		if err != nil {
			return err
		}
		if project.Status == ProjectArchived {
			return ErrResourceArchived
		}
		project.Name, project.UpdatedAt = name, s.now()
		tx.SaveProject(project)
		s.audit(tx, actor, project.OrganizationID, project.ID, "", "project.updated", "project", project.ID, map[string]string{})
		result = project
		return nil
	})
	if err == nil {
		logMutation(ctx, "project.updated", actor, result.OrganizationID, projectID, projectID)
	}
	return result, err
}

func (s *Service) setProjectArchived(ctx context.Context, actor Actor, projectID string, archived bool) (Project, error) {
	operation := "project.archive"
	action := "project.archived"
	if !archived {
		operation, action = "project.restore", "project.restored"
	}
	ctx, span := s.operation(ctx, operation, actor, attribute.String("mosaic.project.id", projectID))
	defer span.End()
	var result Project
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		project, _, err := projectScope(tx, actor, projectID, true)
		if err != nil {
			return err
		}
		now := s.now()
		if archived {
			if project.Status == ProjectArchived {
				result = project
				return nil
			}
			project.Status, project.ArchivedAt = ProjectArchived, &now
		} else {
			project.Status, project.ArchivedAt = ProjectActive, nil
		}
		project.UpdatedAt = now
		tx.SaveProject(project)
		s.audit(tx, actor, project.OrganizationID, project.ID, "", action, "project", project.ID, map[string]string{})
		result = project
		return nil
	})
	if err == nil {
		logMutation(ctx, action, actor, result.OrganizationID, projectID, projectID)
	}
	return result, err
}

func (s *Service) ArchiveProject(ctx context.Context, actor Actor, projectID string) (Project, error) {
	return s.setProjectArchived(ctx, actor, projectID, true)
}

func (s *Service) RestoreProject(ctx context.Context, actor Actor, projectID string) (Project, error) {
	return s.setProjectArchived(ctx, actor, projectID, false)
}

func (s *Service) CreateApplication(ctx context.Context, actor Actor, projectID, name string, platform Platform, identifier string) (Application, error) {
	ctx, span := s.operation(ctx, "application.create", actor, attribute.String("mosaic.project.id", projectID))
	defer span.End()
	var result Application
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		project, _, err := projectScope(tx, actor, projectID, true)
		if err != nil {
			return err
		}
		if project.Status == ProjectArchived {
			return ErrResourceArchived
		}
		for _, application := range tx.Applications(projectID) {
			if application.Platform == platform && application.Identifier == identifier {
				return &ConflictError{Resource: "application", Field: "identifier"}
			}
		}
		now := s.now()
		result = Application{ID: tx.NextID("app"), ProjectID: projectID, Name: name, Platform: platform, Identifier: identifier, CreatedAt: now, UpdatedAt: now}
		tx.SaveApplication(result)
		s.audit(tx, actor, project.OrganizationID, projectID, "", "application.created", "application", result.ID, map[string]string{"platform": string(platform)})
		return nil
	})
	if err == nil {
		logMutation(ctx, "application.created", actor, "", projectID, result.ID)
	}
	return result, err
}

func (s *Service) ListApplications(ctx context.Context, actor Actor, projectID string, options ListOptions) (List[Application], error) {
	var values []Application
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, _, err := projectScope(reader, actor, projectID, false); err != nil {
			return err
		}
		values = reader.Applications(projectID)
		return nil
	})
	return paginated(values, options, func(value Application) string { return value.ID }, err)
}

func (s *Service) ListEnvironments(ctx context.Context, actor Actor, projectID string, options ListOptions) (List[Environment], error) {
	var values []Environment
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, _, err := projectScope(reader, actor, projectID, false); err != nil {
			return err
		}
		values = reader.Environments(projectID)
		return nil
	})
	return paginated(values, options, func(value Environment) string { return value.ID }, err)
}

func (s *Service) UpdateEnvironment(ctx context.Context, actor Actor, environmentID, name string) (Environment, error) {
	ctx, span := s.operation(ctx, "environment.update", actor, attribute.String("mosaic.environment.id", environmentID))
	defer span.End()
	var result Environment
	var organizationID string
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		environment, project, err := environmentScope(tx, actor, environmentID, true)
		if err != nil {
			return err
		}
		if project.Status == ProjectArchived {
			return ErrResourceArchived
		}
		environment.Name, environment.UpdatedAt = name, s.now()
		tx.SaveEnvironment(environment)
		s.audit(tx, actor, project.OrganizationID, project.ID, environment.ID, "environment.updated", "environment", environment.ID, map[string]string{})
		organizationID = project.OrganizationID
		result = environment
		return nil
	})
	if err == nil {
		logMutation(ctx, "environment.updated", actor, organizationID, result.ProjectID, environmentID)
	}
	return result, err
}
