import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  HOSTED_UPDATE_PATHS,
  HOSTED_UPDATE_TRIGGER,
  HostedUpdateAdapter,
  type HostedUpdatePaths,
} from "./hosted-update-adapter";
import type { ReleaseFeedDecision } from "./update-feed-policy";
import type { UpdateCancellationToken } from "./update-service";

const TEST_FEED: ReleaseFeedDecision = { allowed: true, baseUrl: "https://updates.example.test/feeds" };
const folders: string[] = [];

/** The paths of a server in a temporary folder, so the test never touches the real one. */
async function serverPaths(): Promise<HostedUpdatePaths> {
  const root = await mkdtemp(join(tmpdir(), "hosted-update-adapter-"));
  folders.push(root);
  const paths = {
    requests: join(root, "requests"),
    state: join(root, "state"),
    stagedReady: join(root, "staged.ready"),
  };
  await mkdir(paths.requests, { recursive: true });
  return paths;
}

/** Waits until `path` exists, or gives up after five seconds. */
async function waitFor(path: string): Promise<boolean> {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (
      await stat(path).then(
        () => true,
        () => false,
      )
    )
      return true;
    await delay(10);
  }
  return false;
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

/** A cancellation token that the test can cancel. */
class Cancellation implements UpdateCancellationToken {
  cancelled = false;
  cancel(): void {
    this.cancelled = true;
  }
}

describe("HostedUpdateAdapter", () => {
  it("names the paths and the unit of a server, not the ones of the old product name", () => {
    expect(HOSTED_UPDATE_PATHS).toEqual({
      requests: "/run/buildersbot",
      state: "/run/buildersbot-update.state",
      stagedReady: "/opt/BuildersBot/staged.ready",
    });
    expect(HOSTED_UPDATE_TRIGGER).toBe("/etc/systemd/system/buildersbot-update-request.path");
  });

  it("asks root for a download, reports the progress of the state file and resolves with the staged release", async () => {
    const paths = await serverPaths();
    const adapter = new HostedUpdateAdapter({ currentVersion: "0.56.0", arch: "x64", paths, pollIntervalMs: 5 });
    const progress: number[] = [];
    const downloaded: string[] = [];
    adapter.on("download-progress", (info) => progress.push(info.percent));
    adapter.on("update-downloaded", (info) => downloaded.push(info.version));

    const download = adapter.downloadUpdate();
    const request = join(paths.requests, "update-stage");
    expect(await waitFor(request)).toBe(true);

    // Root removes the request without reading it, then writes the step of the download.
    await rm(request);
    await writeFile(paths.state, "downloading 42\n");
    await delay(40);
    await writeFile(paths.stagedReady, "0.57.0\n");
    await rm(paths.state);

    await expect(download).resolves.toBeUndefined();
    expect(progress).toContain(42);
    expect(downloaded).toEqual(["0.57.0"]);
  });

  it("fails when root stages no release", async () => {
    const paths = await serverPaths();
    const adapter = new HostedUpdateAdapter({ currentVersion: "0.56.0", arch: "x64", paths, pollIntervalMs: 5 });

    const download = adapter.downloadUpdate();
    const request = join(paths.requests, "update-stage");
    expect(await waitFor(request)).toBe(true);
    await rm(request);

    await expect(download).rejects.toThrow("The server staged no release.");
  });

  it("refuses a staged release that is not newer than the installed one", async () => {
    const paths = await serverPaths();
    const adapter = new HostedUpdateAdapter({ currentVersion: "0.56.0", arch: "x64", paths, pollIntervalMs: 5 });

    const download = adapter.downloadUpdate();
    const request = join(paths.requests, "update-stage");
    expect(await waitFor(request)).toBe(true);
    await rm(request);
    await writeFile(paths.stagedReady, "0.56.0\n");

    await expect(download).rejects.toThrow("The server staged no release.");
  });

  it("stops the download when the caller cancels it", async () => {
    const paths = await serverPaths();
    const adapter = new HostedUpdateAdapter({ currentVersion: "0.56.0", arch: "x64", paths, pollIntervalMs: 5 });
    const cancellation = new Cancellation();

    const download = adapter.downloadUpdate(cancellation);
    const request = join(paths.requests, "update-stage");
    expect(await waitFor(request)).toBe(true);
    cancellation.cancel();

    await expect(download).rejects.toThrow("The download was cancelled.");
  });

  it("asks root for the install with the install request file", async () => {
    const paths = await serverPaths();
    const adapter = new HostedUpdateAdapter({ currentVersion: "0.56.0", arch: "x64", paths });

    adapter.quitAndInstall();

    expect(await readFile(join(paths.requests, "update-install"), "utf8")).toBe("");
  });

  it("checks the release feed before it asks root for anything", async () => {
    const paths = await serverPaths();
    const adapter = new HostedUpdateAdapter({
      currentVersion: "0.56.0",
      arch: "x64",
      paths,
      releaseFeed: TEST_FEED,
      fetch: async () =>
        new Response(["version: 0.57.0", "files:", "  - url: Builders Bot-0.57.0-x86_64.AppImage"].join("\n")),
    });

    await expect(adapter.checkForUpdates()).resolves.toEqual({
      isUpdateAvailable: true,
      updateInfo: { version: "0.57.0" },
      cancellationToken: expect.anything(),
    });
  });
});
