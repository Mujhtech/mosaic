import { createContext, useContext } from "react";
import { generatedPlacementDecisionsAdapter } from "@/features/placement-decisions/api/generated-placement-decisions-adapter";
import type { PlacementDecisionsAdapter } from "@/features/placement-decisions/api/placement-decisions-adapter";

export const PlacementDecisionsAdapterContext =
  createContext<PlacementDecisionsAdapter>(generatedPlacementDecisionsAdapter);

export function usePlacementDecisionsAdapter() {
  return useContext(PlacementDecisionsAdapterContext);
}
