import type { AgentMessage } from "@buildersbot/ui/data";
import { describe, expect, it } from "vitest";
import { UI_ERROR_LIMIT, withUiError } from "./ui-error-feed";

function error(body: string, status = "Send failed"): AgentMessage {
  return { id: body, author: "agent", body, time: "", kind: "error", status };
}

describe("the inline errors of one conversation", () => {
  it("keeps only the newest failures", () => {
    let errors: AgentMessage[] = [];
    for (let index = 0; index < UI_ERROR_LIMIT + 5; index += 1) errors = withUiError(errors, error(`failure ${index}`));

    expect(errors).toHaveLength(UI_ERROR_LIMIT);
    expect(errors[0]?.body).toBe("failure 5");
    expect(errors.at(-1)?.body).toBe(`failure ${UI_ERROR_LIMIT + 4}`);
  });

  it("replaces the same failure instead of adding it again", () => {
    let errors = withUiError(undefined, error("Send failed", "chat.errorStatus.send"));
    errors = withUiError(errors, error("Send failed", "chat.errorStatus.send"));

    expect(errors).toHaveLength(1);
  });

  it("keeps failures of different statuses apart", () => {
    let errors = withUiError(undefined, error("Send failed", "chat.errorStatus.send"));
    errors = withUiError(errors, error("Send failed", "chat.errorStatus.steer"));

    expect(errors).toHaveLength(2);
  });
});
