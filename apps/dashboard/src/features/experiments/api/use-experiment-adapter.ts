import { createContext, useContext } from "react";

import type { ExperimentAdapter } from "./experiment-adapter";
import { generatedExperimentAdapter } from "./generated-experiment-adapter";

export const ExperimentAdapterContext = createContext<ExperimentAdapter>(
  generatedExperimentAdapter
);

export function useExperimentAdapter() {
  return useContext(ExperimentAdapterContext);
}
