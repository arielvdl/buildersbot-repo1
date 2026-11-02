import { createFileRoute } from "@tanstack/solid-router";
import { LandingPage } from "../components/landing/LandingPage";
import { openBotHomeHead } from "../lib/site-metadata";
import { BUILDERSBOT_SOFTWARE_APPLICATION } from "../lib/software-application";

export const Route = createFileRoute("/")({
  head: () => openBotHomeHead(BUILDERSBOT_SOFTWARE_APPLICATION),
  component: LandingPage,
});
