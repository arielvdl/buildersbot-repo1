import { createFileRoute, redirect } from "@tanstack/solid-router";

// There is no page that lists every download: the home page has the macOS and Windows buttons.
// `/download` stays a valid address for old links and sends them there.
export const Route = createFileRoute("/download/")({
  beforeLoad: () => {
    throw redirect({ to: "/", hash: "downloads", statusCode: 301 });
  },
});
