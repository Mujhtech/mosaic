import { MonetizationWorkspace } from "@/features/environments/components/monetization-workspace";
import { ExperimentBuilder } from "./experiment-builder";

export function NewExperimentPage(props: {
  environmentId: string;
  organizationId: string;
  projectId: string;
}) {
  return (
    <MonetizationWorkspace
      description="Define the smallest valid scientific contract. Publication captures immutable Variants, allocation, assignment policy, metric definitions, and schedule."
      {...props}
      surface="experiments"
      title="New Experiment"
    >
      <ExperimentBuilder {...props} />
    </MonetizationWorkspace>
  );
}
