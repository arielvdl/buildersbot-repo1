import { createFileRoute, redirect } from "@tanstack/solid-router";

// The Commercial License Agreement names buildersbot.culturabuilder.com/branding for the brand guidelines.
export const Route = createFileRoute("/branding")({
  loader: () => {
    throw redirect({ to: "/brand", statusCode: 308 });
  },
});
