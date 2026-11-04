// What `HubConnectionTools` asks of a Hub client. The app's own server has the real client
// (`HubConnectionClient`), which holds the Cultura Builder session. A local server that the app runs as
// a child process has `HubConnectionDelegate`, which asks the app to run each operation, so the child
// never holds a session or a token (docs/architecture/hub-connections.md, "Local servers").

import type {
  HubAccessRequestAnswer,
  HubAccessRequestKind,
  HubConfirmationStatus,
  HubConnectionCatalog,
  HubConnectionUsage,
  HubSessionConnections,
  ToolCatalogCallOutcome,
  ToolCatalogCallRequest,
  ToolCatalogDescribeAnswer,
  ToolCatalogSearchAnswer,
  ToolCatalogSearchRequest,
} from "@buildersbot/contracts/hub-connections";
import type { Effect } from "effect";
import type { HubConnectionFailure, HubOperationOutcome } from "./hub-connection-client";

export interface HubConnectionPort {
  /** Whether a Cultura Builder session is stored. It reads no network and waits for nothing. */
  signedIn(): boolean;
  /** The connection ids of the last `/session` answer of this sign-in. */
  knownConnectionIds(): string[];
  forget(): void;
  forgetCatalog(): void;
  forgetCapabilities(): void;
  forgetOrg(orgId: string): void;
  capabilities(fresh?: boolean): Effect.Effect<HubSessionConnections, HubConnectionFailure>;
  catalog(fresh?: boolean): Effect.Effect<HubConnectionCatalog, HubConnectionFailure>;
  search(
    orgId: string,
    body: ToolCatalogSearchRequest,
  ): Effect.Effect<HubOperationOutcome<ToolCatalogSearchAnswer>, HubConnectionFailure>;
  describe(
    orgId: string,
    endpointId: string,
  ): Effect.Effect<HubOperationOutcome<ToolCatalogDescribeAnswer>, HubConnectionFailure>;
  call(
    orgId: string,
    body: ToolCatalogCallRequest,
    idempotencyKey: string,
  ): Effect.Effect<ToolCatalogCallOutcome, HubConnectionFailure>;
  usage(
    orgId: string,
    period?: string | null,
  ): Effect.Effect<HubOperationOutcome<HubConnectionUsage>, HubConnectionFailure>;
  confirmation(
    orgId: string,
    confirmationId: string,
  ): Effect.Effect<HubOperationOutcome<HubConfirmationStatus>, HubConnectionFailure>;
  requestAccess(
    orgId: string,
    connectionId: string,
    kind: HubAccessRequestKind,
  ): Effect.Effect<HubOperationOutcome<HubAccessRequestAnswer>, HubConnectionFailure>;
}
