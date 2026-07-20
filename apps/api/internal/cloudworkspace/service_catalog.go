package cloudworkspace

import (
	"context"
	"strings"

	"go.opentelemetry.io/otel/attribute"
)

func catalogProject(reader Reader, actor Actor, projectID string, write bool) (Project, error) {
	project, _, err := projectScope(reader, actor, projectID, write)
	if err == nil && write && project.Status == ProjectArchived {
		return Project{}, ErrResourceArchived
	}
	return project, err
}

func productScope(reader Reader, actor Actor, productID string, write bool) (Product, Project, error) {
	product, ok := reader.Product(productID)
	if !ok {
		return Product{}, Project{}, ErrNotFound
	}
	project, err := catalogProject(reader, actor, product.ProjectID, write)
	return product, project, err
}

func planScope(reader Reader, actor Actor, planID string, write bool) (Plan, Project, error) {
	plan, ok := reader.Plan(planID)
	if !ok {
		return Plan{}, Project{}, ErrNotFound
	}
	project, err := catalogProject(reader, actor, plan.ProjectID, write)
	return plan, project, err
}

func entitlementScope(reader Reader, actor Actor, entitlementID string, write bool) (Entitlement, Project, error) {
	entitlement, ok := reader.Entitlement(entitlementID)
	if !ok {
		return Entitlement{}, Project{}, ErrNotFound
	}
	project, err := catalogProject(reader, actor, entitlement.ProjectID, write)
	return entitlement, project, err
}

func catalogKeyConflict[T any](values []T, key string, getKey func(T) string) bool {
	for _, value := range values {
		if getKey(value) == key {
			return true
		}
	}
	return false
}

func (s *Service) CreatePlan(ctx context.Context, actor Actor, projectID, key, name, description string) (Plan, error) {
	ctx, span := s.operation(ctx, "plan.create", actor, attribute.String("mosaic.project.id", projectID))
	defer span.End()
	var result Plan
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		project, err := catalogProject(tx, actor, projectID, true)
		if err != nil {
			return err
		}
		if catalogKeyConflict(tx.Plans(projectID), key, func(value Plan) string { return value.Key }) {
			return &ConflictError{Resource: "plan", Field: "key"}
		}
		now := s.now()
		result = Plan{ID: tx.NextID("plan"), ProjectID: projectID, Key: key, Name: name, Description: description, CreatedAt: now, UpdatedAt: now}
		tx.SavePlan(result)
		s.audit(tx, actor, project.OrganizationID, projectID, "", "plan.created", "plan", result.ID, map[string]string{"key": key})
		return nil
	})
	if err == nil {
		logMutation(ctx, "plan.created", actor, "", projectID, result.ID)
	}
	return result, err
}

func (s *Service) ListPlans(ctx context.Context, actor Actor, projectID string, options ListOptions) (List[Plan], error) {
	var values []Plan
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, err := catalogProject(reader, actor, projectID, false); err != nil {
			return err
		}
		values = reader.Plans(projectID)
		return nil
	})
	return paginated(values, options, func(value Plan) string { return value.ID }, err)
}

func (s *Service) GetPlan(ctx context.Context, actor Actor, planID string) (Plan, error) {
	var result Plan
	err := s.repository.View(ctx, func(reader Reader) error {
		plan, _, err := planScope(reader, actor, planID, false)
		result = plan
		return err
	})
	return result, err
}

func (s *Service) UpdatePlan(ctx context.Context, actor Actor, planID, key, name, description string) (Plan, error) {
	ctx, span := s.operation(ctx, "plan.update", actor, attribute.String("mosaic.plan.id", planID))
	defer span.End()
	var result Plan
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		plan, project, err := planScope(tx, actor, planID, true)
		if err != nil {
			return err
		}
		for _, candidate := range tx.Plans(plan.ProjectID) {
			if candidate.ID != plan.ID && candidate.Key == key {
				return &ConflictError{Resource: "plan", Field: "key"}
			}
		}
		plan.Key, plan.Name, plan.Description, plan.UpdatedAt = key, name, description, s.now()
		tx.SavePlan(plan)
		s.audit(tx, actor, project.OrganizationID, project.ID, "", "plan.updated", "plan", plan.ID, map[string]string{"key": key})
		result = plan
		return nil
	})
	if err == nil {
		logMutation(ctx, "plan.updated", actor, "", result.ProjectID, planID)
	}
	return result, err
}

func replacementChainValid(reader Reader, source Product, replacement Product) bool {
	seen := map[string]struct{}{source.ID: {}}
	current := replacement
	for {
		if _, exists := seen[current.ID]; exists {
			return false
		}
		if current.ProjectID != source.ProjectID || current.Type != source.Type || current.Status == ProductArchived {
			return false
		}
		seen[current.ID] = struct{}{}
		if current.ReplacementProductID == "" {
			return true
		}
		next, ok := reader.Product(current.ReplacementProductID)
		if !ok {
			return false
		}
		current = next
	}
}

func replacementDependencyValid(reader Reader, product Product) bool {
	if product.ReplacementProductID == "" {
		return true
	}
	replacement, ok := reader.Product(product.ReplacementProductID)
	return ok && replacementChainValid(reader, product, replacement)
}

func readiness(reader Reader, product Product) ProductReadiness {
	reasons := make([]string, 0)
	dependencyValid := replacementDependencyValid(reader, product)
	if product.Status == ProductArchived {
		reasons = append(reasons, "product_archived")
	}
	if product.MetadataSource == MetadataMock {
		reasons = append(reasons, "mock_metadata")
	}
	if product.Status == ProductAttentionRequired {
		reasons = append(reasons, "attention_required")
	}
	if !dependencyValid {
		reasons = append(reasons, "replacement_invalid")
	}
	return ProductReadiness{Ready: dependencyValid && product.Status == ProductConnected && product.MetadataSource == MetadataProvider, Reasons: reasons, MetadataSource: product.MetadataSource}
}

func withReadiness(reader Reader, product Product) Product {
	product.Readiness = readiness(reader, product)
	return product
}

func (s *Service) CreateProduct(ctx context.Context, actor Actor, projectID, key, internalName, description string, productType ProductType) (Product, error) {
	ctx, span := s.operation(ctx, "product.create", actor, attribute.String("mosaic.project.id", projectID))
	defer span.End()
	var result Product
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		project, err := catalogProject(tx, actor, projectID, true)
		if err != nil {
			return err
		}
		if catalogKeyConflict(tx.Products(projectID), key, func(value Product) string { return value.Key }) {
			return &ConflictError{Resource: "product", Field: "key"}
		}
		now := s.now()
		result = withReadiness(tx, Product{ID: tx.NextID("product"), ProjectID: projectID, Key: key, InternalName: internalName, Description: description, Type: productType, Status: ProductDraft, MetadataSource: MetadataMock, CreatedAt: now, UpdatedAt: now})
		tx.SaveProduct(result)
		s.audit(tx, actor, project.OrganizationID, projectID, "", "product.created", "product", result.ID, map[string]string{"key": key, "type": string(productType)})
		return nil
	})
	if err == nil {
		logMutation(ctx, "product.created", actor, "", projectID, result.ID)
	}
	return result, err
}

func (s *Service) ListProducts(ctx context.Context, actor Actor, projectID string, filters ProductFilters) (List[Product], error) {
	values := make([]Product, 0)
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, err := catalogProject(reader, actor, projectID, false); err != nil {
			return err
		}
		search := strings.ToLower(filters.Search)
		for _, product := range reader.Products(projectID) {
			if filters.Status != "" && product.Status != filters.Status {
				continue
			}
			if filters.Type != "" && product.Type != filters.Type {
				continue
			}
			if search != "" && !strings.Contains(strings.ToLower(product.InternalName+" "+product.Key), search) {
				continue
			}
			values = append(values, withReadiness(reader, product))
		}
		return nil
	})
	return paginated(values, filters.ListOptions, func(value Product) string { return value.ID }, err)
}

func (s *Service) GetProduct(ctx context.Context, actor Actor, productID string) (Product, error) {
	var result Product
	err := s.repository.View(ctx, func(reader Reader) error {
		product, _, err := productScope(reader, actor, productID, false)
		result = withReadiness(reader, product)
		return err
	})
	return result, err
}

func (s *Service) UpdateProduct(ctx context.Context, actor Actor, productID, key, internalName, description string, productType ProductType) (Product, error) {
	ctx, span := s.operation(ctx, "product.update", actor, attribute.String("mosaic.product.id", productID))
	defer span.End()
	var result Product
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		product, project, err := productScope(tx, actor, productID, true)
		if err != nil {
			return err
		}
		if product.Status == ProductArchived {
			return ErrResourceArchived
		}
		if productType != product.Type {
			if product.ReplacementProductID != "" {
				replacement, ok := tx.Product(product.ReplacementProductID)
				if !ok || replacement.Type != productType {
					return ErrReplacementInvalid
				}
			}
			for _, candidate := range tx.Products(product.ProjectID) {
				if candidate.ReplacementProductID == product.ID && candidate.Type != productType {
					return ErrReplacementInvalid
				}
			}
		}
		for _, candidate := range tx.Products(product.ProjectID) {
			if candidate.ID != product.ID && candidate.Key == key {
				return &ConflictError{Resource: "product", Field: "key"}
			}
		}
		product.Key, product.InternalName, product.Description, product.Type, product.UpdatedAt = key, internalName, description, productType, s.now()
		product = withReadiness(tx, product)
		tx.SaveProduct(product)
		s.audit(tx, actor, project.OrganizationID, project.ID, "", "product.updated", "product", product.ID, map[string]string{"key": key})
		result = product
		return nil
	})
	if err == nil {
		logMutation(ctx, "product.updated", actor, "", result.ProjectID, productID)
	}
	return result, err
}

func (s *Service) ProductReadiness(ctx context.Context, actor Actor, productID string) (ProductReadiness, error) {
	product, err := s.GetProduct(ctx, actor, productID)
	return product.Readiness, err
}

func (s *Service) setProductArchived(ctx context.Context, actor Actor, productID string, archived bool) (Product, error) {
	operation, action := "product.archive", "product.archived"
	if !archived {
		operation, action = "product.restore", "product.restored"
	}
	ctx, span := s.operation(ctx, operation, actor, attribute.String("mosaic.product.id", productID))
	defer span.End()
	var result Product
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		product, project, err := productScope(tx, actor, productID, true)
		if err != nil {
			return err
		}
		now := s.now()
		if archived {
			for _, candidate := range tx.Products(product.ProjectID) {
				if candidate.ReplacementProductID == product.ID {
					return ErrReplacementInvalid
				}
			}
			product.Status, product.ArchivedAt = ProductArchived, &now
		} else {
			product.Status, product.ArchivedAt = ProductDraft, nil
		}
		product.UpdatedAt, product = now, withReadiness(tx, product)
		tx.SaveProduct(product)
		s.audit(tx, actor, project.OrganizationID, project.ID, "", action, "product", product.ID, map[string]string{})
		result = product
		return nil
	})
	if err == nil {
		logMutation(ctx, action, actor, "", result.ProjectID, productID)
	}
	return result, err
}

func (s *Service) ArchiveProduct(ctx context.Context, actor Actor, productID string) (Product, error) {
	return s.setProductArchived(ctx, actor, productID, true)
}
func (s *Service) RestoreProduct(ctx context.Context, actor Actor, productID string) (Product, error) {
	return s.setProductArchived(ctx, actor, productID, false)
}

func (s *Service) SetProductReplacement(ctx context.Context, actor Actor, productID, replacementID string) (Product, error) {
	ctx, span := s.operation(ctx, "product.set_replacement", actor, attribute.String("mosaic.product.id", productID))
	defer span.End()
	var result Product
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		product, project, err := productScope(tx, actor, productID, true)
		if err != nil {
			return err
		}
		replacement, ok := tx.Product(replacementID)
		if !ok || !replacementChainValid(tx, product, replacement) {
			return ErrReplacementInvalid
		}
		product.ReplacementProductID, product.UpdatedAt = replacementID, s.now()
		product = withReadiness(tx, product)
		tx.SaveProduct(product)
		s.audit(tx, actor, project.OrganizationID, project.ID, "", "product.replacement_set", "product", product.ID, map[string]string{"replacementProductId": replacementID})
		result = product
		return nil
	})
	if err == nil {
		logMutation(ctx, "product.replacement_set", actor, "", result.ProjectID, productID)
	}
	return result, err
}

func (s *Service) AddPlanProduct(ctx context.Context, actor Actor, planID, productID string) (PlanProduct, error) {
	ctx, span := s.operation(ctx, "plan.add_product", actor, attribute.String("mosaic.plan.id", planID), attribute.String("mosaic.product.id", productID))
	defer span.End()
	var result PlanProduct
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		plan, project, err := planScope(tx, actor, planID, true)
		if err != nil {
			return err
		}
		product, ok := tx.Product(productID)
		if !ok {
			return ErrNotFound
		}
		if product.ProjectID != plan.ProjectID {
			return ErrReplacementInvalid
		}
		if product.Status == ProductArchived {
			return ErrResourceArchived
		}
		for _, membership := range tx.PlanProducts(planID) {
			if membership.ProductID == productID {
				return &ConflictError{Resource: "plan_product", Field: "productId"}
			}
		}
		result = PlanProduct{PlanID: planID, ProductID: productID, CreatedAt: s.now()}
		tx.SavePlanProduct(result)
		s.audit(tx, actor, project.OrganizationID, project.ID, "", "plan.product_added", "plan", planID, map[string]string{"productId": productID})
		return nil
	})
	if err == nil {
		logMutation(ctx, "plan.product_added", actor, "", "", planID)
	}
	return result, err
}

func (s *Service) RemovePlanProduct(ctx context.Context, actor Actor, planID, productID string) error {
	ctx, span := s.operation(ctx, "plan.remove_product", actor, attribute.String("mosaic.plan.id", planID), attribute.String("mosaic.product.id", productID))
	defer span.End()
	var organizationID, projectID string
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		plan, project, err := planScope(tx, actor, planID, true)
		if err != nil {
			return err
		}
		found := false
		for _, membership := range tx.PlanProducts(planID) {
			if membership.ProductID == productID {
				found = true
			}
		}
		if !found {
			return ErrNotFound
		}
		tx.DeletePlanProduct(planID, productID)
		s.audit(tx, actor, project.OrganizationID, project.ID, "", "plan.product_removed", "plan", plan.ID, map[string]string{"productId": productID})
		organizationID, projectID = project.OrganizationID, project.ID
		return nil
	})
	if err == nil {
		logMutation(ctx, "plan.product_removed", actor, organizationID, projectID, planID)
	}
	return err
}

func (s *Service) ListPlanProducts(ctx context.Context, actor Actor, planID string, options ListOptions) (List[Product], error) {
	values := make([]Product, 0)
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, _, err := planScope(reader, actor, planID, false); err != nil {
			return err
		}
		for _, membership := range reader.PlanProducts(planID) {
			if product, ok := reader.Product(membership.ProductID); ok {
				values = append(values, withReadiness(reader, product))
			}
		}
		return nil
	})
	return paginated(values, options, func(value Product) string { return value.ID }, err)
}

func (s *Service) CreateEntitlement(ctx context.Context, actor Actor, projectID, key, name, description string) (Entitlement, error) {
	ctx, span := s.operation(ctx, "entitlement.create", actor, attribute.String("mosaic.project.id", projectID))
	defer span.End()
	var result Entitlement
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		project, err := catalogProject(tx, actor, projectID, true)
		if err != nil {
			return err
		}
		if catalogKeyConflict(tx.Entitlements(projectID), key, func(value Entitlement) string { return value.Key }) {
			return &ConflictError{Resource: "entitlement", Field: "key"}
		}
		now := s.now()
		result = Entitlement{ID: tx.NextID("entitlement"), ProjectID: projectID, Key: key, Name: name, Description: description, CreatedAt: now, UpdatedAt: now}
		tx.SaveEntitlement(result)
		s.audit(tx, actor, project.OrganizationID, project.ID, "", "entitlement.created", "entitlement", result.ID, map[string]string{"key": key})
		return nil
	})
	if err == nil {
		logMutation(ctx, "entitlement.created", actor, "", projectID, result.ID)
	}
	return result, err
}

func (s *Service) ListEntitlements(ctx context.Context, actor Actor, projectID string, options ListOptions) (List[Entitlement], error) {
	var values []Entitlement
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, err := catalogProject(reader, actor, projectID, false); err != nil {
			return err
		}
		values = reader.Entitlements(projectID)
		return nil
	})
	return paginated(values, options, func(value Entitlement) string { return value.ID }, err)
}

func (s *Service) GetEntitlement(ctx context.Context, actor Actor, entitlementID string) (Entitlement, error) {
	var result Entitlement
	err := s.repository.View(ctx, func(reader Reader) error {
		entitlement, _, err := entitlementScope(reader, actor, entitlementID, false)
		result = entitlement
		return err
	})
	return result, err
}

func (s *Service) UpdateEntitlement(ctx context.Context, actor Actor, entitlementID, key, name, description string) (Entitlement, error) {
	ctx, span := s.operation(ctx, "entitlement.update", actor, attribute.String("mosaic.entitlement.id", entitlementID))
	defer span.End()
	var result Entitlement
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		entitlement, project, err := entitlementScope(tx, actor, entitlementID, true)
		if err != nil {
			return err
		}
		for _, candidate := range tx.Entitlements(entitlement.ProjectID) {
			if candidate.ID != entitlement.ID && candidate.Key == key {
				return &ConflictError{Resource: "entitlement", Field: "key"}
			}
		}
		entitlement.Key, entitlement.Name, entitlement.Description, entitlement.UpdatedAt = key, name, description, s.now()
		tx.SaveEntitlement(entitlement)
		s.audit(tx, actor, project.OrganizationID, project.ID, "", "entitlement.updated", "entitlement", entitlement.ID, map[string]string{"key": key})
		result = entitlement
		return nil
	})
	if err == nil {
		logMutation(ctx, "entitlement.updated", actor, "", result.ProjectID, entitlementID)
	}
	return result, err
}

func (s *Service) AddProductEntitlement(ctx context.Context, actor Actor, productID, entitlementID string) (ProductEntitlementGrant, error) {
	ctx, span := s.operation(ctx, "product.grant_entitlement", actor, attribute.String("mosaic.product.id", productID))
	defer span.End()
	var result ProductEntitlementGrant
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		product, project, err := productScope(tx, actor, productID, true)
		if err != nil {
			return err
		}
		entitlement, ok := tx.Entitlement(entitlementID)
		if !ok {
			return ErrNotFound
		}
		if entitlement.ProjectID != product.ProjectID {
			return ErrReplacementInvalid
		}
		for _, grant := range tx.ProductGrants(productID) {
			if grant.EntitlementID == entitlementID {
				return &ConflictError{Resource: "product_entitlement", Field: "entitlementId"}
			}
		}
		result = ProductEntitlementGrant{ProductID: productID, EntitlementID: entitlementID, CreatedAt: s.now()}
		tx.SaveProductGrant(result)
		s.audit(tx, actor, project.OrganizationID, project.ID, "", "product.entitlement_granted", "product", productID, map[string]string{"entitlementId": entitlementID})
		return nil
	})
	if err == nil {
		logMutation(ctx, "product.entitlement_granted", actor, "", "", productID)
	}
	return result, err
}

func (s *Service) RemoveProductEntitlement(ctx context.Context, actor Actor, productID, entitlementID string) error {
	ctx, span := s.operation(ctx, "product.remove_entitlement", actor, attribute.String("mosaic.product.id", productID), attribute.String("mosaic.entitlement.id", entitlementID))
	defer span.End()
	var organizationID, projectID string
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		product, project, err := productScope(tx, actor, productID, true)
		if err != nil {
			return err
		}
		found := false
		for _, grant := range tx.ProductGrants(productID) {
			if grant.EntitlementID == entitlementID {
				found = true
			}
		}
		if !found {
			return ErrNotFound
		}
		tx.DeleteProductGrant(productID, entitlementID)
		s.audit(tx, actor, project.OrganizationID, project.ID, "", "product.entitlement_removed", "product", product.ID, map[string]string{"entitlementId": entitlementID})
		organizationID, projectID = project.OrganizationID, project.ID
		return nil
	})
	if err == nil {
		logMutation(ctx, "product.entitlement_removed", actor, organizationID, projectID, productID)
	}
	return err
}

func (s *Service) ListProductEntitlements(ctx context.Context, actor Actor, productID string, options ListOptions) (List[Entitlement], error) {
	values := make([]Entitlement, 0)
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, _, err := productScope(reader, actor, productID, false); err != nil {
			return err
		}
		for _, grant := range reader.ProductGrants(productID) {
			if entitlement, ok := reader.Entitlement(grant.EntitlementID); ok {
				values = append(values, entitlement)
			}
		}
		return nil
	})
	return paginated(values, options, func(value Entitlement) string { return value.ID }, err)
}

func (s *Service) CreateProviderMapping(ctx context.Context, actor Actor, productID, applicationID string, provider ProviderKind, providerProductIdentifier string) (ProviderProductMapping, error) {
	ctx, span := s.operation(ctx, "provider_mapping.create_placeholder", actor, attribute.String("mosaic.product.id", productID))
	defer span.End()
	var result ProviderProductMapping
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		product, project, err := productScope(tx, actor, productID, true)
		if err != nil {
			return err
		}
		application, ok := tx.Application(applicationID)
		if !ok {
			return ErrNotFound
		}
		if application.ProjectID != product.ProjectID {
			return ErrReplacementInvalid
		}
		for _, mapping := range tx.ProviderMappings(productID) {
			if mapping.ApplicationID == applicationID && mapping.Provider == provider {
				return &ConflictError{Resource: "provider_mapping", Field: "applicationId"}
			}
		}
		now := s.now()
		result = ProviderProductMapping{ID: tx.NextID("mapping"), ProductID: productID, ApplicationID: applicationID, Provider: provider, ProviderProductIdentifier: providerProductIdentifier, Status: "placeholder", CreatedAt: now, UpdatedAt: now}
		tx.SaveProviderMapping(result)
		s.audit(tx, actor, project.OrganizationID, project.ID, "", "provider_mapping.placeholder_created", "provider_mapping", result.ID, map[string]string{"provider": string(provider)})
		return nil
	})
	if err == nil {
		logMutation(ctx, "provider_mapping.placeholder_created", actor, "", "", result.ID)
	}
	return result, err
}

func (s *Service) ListProviderMappings(ctx context.Context, actor Actor, productID string, options ListOptions) (List[ProviderProductMapping], error) {
	var values []ProviderProductMapping
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, _, err := productScope(reader, actor, productID, false); err != nil {
			return err
		}
		values = reader.ProviderMappings(productID)
		return nil
	})
	return paginated(values, options, func(value ProviderProductMapping) string { return value.ID }, err)
}

func productUsage(reader Reader, product Product) ProductUsage {
	usage := ProductUsage{ProductID: product.ID, Plans: []Plan{}, Entitlements: []Entitlement{}, ProviderMappings: reader.ProviderMappings(product.ID), HistoricalReferences: []string{}}
	for _, plan := range reader.Plans(product.ProjectID) {
		for _, membership := range reader.PlanProducts(plan.ID) {
			if membership.ProductID == product.ID {
				usage.Plans = append(usage.Plans, plan)
			}
		}
	}
	for _, grant := range reader.ProductGrants(product.ID) {
		if entitlement, ok := reader.Entitlement(grant.EntitlementID); ok {
			usage.Entitlements = append(usage.Entitlements, entitlement)
		}
	}
	if product.ReplacementProductID != "" {
		usage.HistoricalReferences = append(usage.HistoricalReferences, "replacement_source")
	}
	for _, candidate := range reader.Products(product.ProjectID) {
		if candidate.ReplacementProductID == product.ID {
			usage.HistoricalReferences = append(usage.HistoricalReferences, "replacement_target:"+candidate.ID)
		}
	}
	return usage
}

func (s *Service) ProductUsage(ctx context.Context, actor Actor, productID string) (ProductUsage, error) {
	var result ProductUsage
	err := s.repository.View(ctx, func(reader Reader) error {
		product, _, err := productScope(reader, actor, productID, false)
		if err != nil {
			return err
		}
		result = productUsage(reader, product)
		return nil
	})
	return result, err
}

func referenced(usage ProductUsage) bool {
	return len(usage.Plans)+len(usage.Entitlements)+len(usage.ProviderMappings)+len(usage.HistoricalReferences) > 0
}

func (s *Service) DeleteProduct(ctx context.Context, actor Actor, productID string) error {
	ctx, span := s.operation(ctx, "product.delete", actor, attribute.String("mosaic.product.id", productID))
	defer span.End()
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		product, project, err := productScope(tx, actor, productID, true)
		if err != nil {
			return err
		}
		if referenced(productUsage(tx, product)) {
			return ErrProductReferenced
		}
		tx.DeleteProduct(productID)
		s.audit(tx, actor, project.OrganizationID, project.ID, "", "product.deleted", "product", productID, map[string]string{})
		return nil
	})
	if err == nil {
		logMutation(ctx, "product.deleted", actor, "", "", productID)
	}
	return err
}
