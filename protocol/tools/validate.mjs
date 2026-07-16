import {
  loadProtocolArtifacts,
  protocolPaths,
  protocolRoot,
  validateJsonFormatting,
  validateProtocol,
} from "./validation.mjs";
import { relative } from "node:path";

try {
  const errors = [
    ...validateProtocol(loadProtocolArtifacts()),
    ...validateJsonFormatting(),
  ];

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      `Validated ${relative(protocolRoot, protocolPaths.canonicalFixture)} ` +
        "against protocol 0.1 and its compatibility manifest.",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

