import { createFileRoute } from "@tanstack/solid-router";
import { LandingPage } from "../components/landing/LandingPage";
import { buildersBotHomeHead } from "../lib/site-metadata";
import { BUILDERSBOT_SOFTWARE_APPLICATION } from "../lib/software-application";

export const Route = createFileRoute("/")({
  head: () => buildersBotHomeHead(BUILDERSBOT_SOFTWARE_APPLICATION),
  component: LandingPage,
});
