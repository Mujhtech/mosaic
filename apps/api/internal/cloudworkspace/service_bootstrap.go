package cloudworkspace

import "context"

// bootstrapProjectsPerOrganization bounds the snapshot. Entry only needs enough
// Projects to route into one and to populate a switcher; an operator with more
// than this reads the rest from the paginated Project list.
const bootstrapProjectsPerOrganization = 25

// BootstrapOrganization pairs an Organization the actor belongs to with the
// actor's role in it and that Organization's active Projects.
type BootstrapOrganization struct {
	Organization      Organization `json:"organization"`
	Role              Role         `json:"role"`
	Projects          []Project    `json:"projects"`
	ProjectCount      int          `json:"projectCount"`
	ProjectsTruncated bool         `json:"projectsTruncated"`
}

// WorkspaceBootstrap is the one-shot answer to "where does this actor land?".
// Resolving entry from the paginated Organization and Project lists cost one
// request per Organization and could not be decided without a round trip per
// candidate, so the destination was guessed before the data arrived.
type WorkspaceBootstrap struct {
	Organizations []BootstrapOrganization `json:"organizations"`
}

// Bootstrap returns every Organization the actor belongs to together with that
// Organization's active Projects, in a single read so entry resolves in one hop.
func (s *Service) Bootstrap(ctx context.Context, actor Actor) (WorkspaceBootstrap, error) {
	if err := requireActor(actor); err != nil {
		return WorkspaceBootstrap{}, err
	}
	var organizations []BootstrapOrganization
	err := s.repository.View(ctx, func(reader Reader) error {
		organizations = nil
		for _, organization := range reader.OrganizationsForActor(actor.ID) {
			membership, ok := reader.Membership(organization.ID, actor.ID)
			if !ok {
				// OrganizationsForActor already filters on membership, so a missing
				// row means the two reads disagree. Skip rather than report a role
				// the actor may not hold.
				continue
			}
			entry := BootstrapOrganization{
				Organization: organization,
				Role:         membership.Role,
				Projects:     []Project{},
			}
			for _, project := range reader.Projects(organization.ID) {
				if project.Status != ProjectActive {
					continue
				}
				entry.ProjectCount++
				if len(entry.Projects) >= bootstrapProjectsPerOrganization {
					entry.ProjectsTruncated = true
					continue
				}
				entry.Projects = append(entry.Projects, project)
			}
			organizations = append(organizations, entry)
		}
		return nil
	})
	if err != nil {
		return WorkspaceBootstrap{}, err
	}
	if organizations == nil {
		organizations = []BootstrapOrganization{}
	}
	return WorkspaceBootstrap{Organizations: organizations}, nil
}
