import { adoptLegacyEnvironment } from "@buildersbot/contracts/legacy-environment";
import startHandler from "@tanstack/solid-start/server-entry";
import { createWorkerHandler } from "./server/worker-handler";

adoptLegacyEnvironment();

export default createWorkerHandler(startHandler.fetch);
