import { prefersReducedMotion } from "../../utils";

export function rendererDuration(property: string, fallback: number): number {
  if (prefersReducedMotion()) return 0;
  const value = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
  if (value.endsWith("ms")) return Number.parseFloat(value) || fallback;
  if (value.endsWith("s")) return (Number.parseFloat(value) || fallback / 1_000) * 1_000;
  return fallback;
}

export function agentActivityExitDuration(): number {
  return rendererDuration("--buildersbot-duration-overlay", 240);
}

export function agentActivityShowDelay(): number {
  return rendererDuration("--buildersbot-duration-fast", 120);
}

export function agentActivityExitDelay(): number {
  return rendererDuration("--buildersbot-agent-activity-exit-delay", 500);
}
