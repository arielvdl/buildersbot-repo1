import type { PlatformLogoVariant } from "@buildersbot/brand";
import { BUILDERSBOT_DOWNLOAD_LINKS, BUILDERSBOT_LINKS } from "./landing-links";
import { RELEASES_ARE_PUBLISHED } from "./release-status";

export type DownloadPlatform = PlatformLogoVariant;

export interface DownloadPlatformDetails {
  action: string;
  available: boolean;
  description: string;
  href?: string;
  id: DownloadPlatform;
  label: string;
  status: "Available" | "Coming soon";
}

export interface PlatformNavigator {
  platform?: string;
  userAgent?: string;
  userAgentData?: {
    platform?: string;
  };
}

/**
 * Until a release carries installers, a card says so and its button opens the source repository
 * instead of a route that answers 404.
 */
const status: DownloadPlatformDetails["status"] = RELEASES_ARE_PUBLISHED ? "Available" : "Coming soon";

export const DOWNLOAD_PLATFORMS: Record<DownloadPlatform, DownloadPlatformDetails> = {
  macos: {
    id: "macos",
    label: "macOS",
    status,
    description: "macOS 13+ · Apple silicon",
    action: "Download for macOS",
    available: RELEASES_ARE_PUBLISHED,
    href: RELEASES_ARE_PUBLISHED ? BUILDERSBOT_DOWNLOAD_LINKS.macos : BUILDERSBOT_LINKS.repository,
  },
  windows: {
    id: "windows",
    label: "Windows",
    status,
    description: "Windows 10+ · x64",
    action: "Download for Windows",
    available: RELEASES_ARE_PUBLISHED,
    href: RELEASES_ARE_PUBLISHED ? BUILDERSBOT_DOWNLOAD_LINKS.windows : BUILDERSBOT_LINKS.repository,
  },
  linux: {
    id: "linux",
    label: "Linux",
    status,
    description: "x64 · AppImage",
    action: "Download for Linux",
    available: RELEASES_ARE_PUBLISHED,
    href: RELEASES_ARE_PUBLISHED ? BUILDERSBOT_DOWNLOAD_LINKS.linux : BUILDERSBOT_LINKS.repository,
  },
};

export const DOWNLOAD_PLATFORM_ORDER: readonly DownloadPlatform[] = ["macos", "windows", "linux"];

export function detectDownloadPlatform(source: PlatformNavigator): DownloadPlatform | undefined {
  const platform =
    `${source.userAgentData?.platform ?? ""} ${source.platform ?? ""} ${source.userAgent ?? ""}`.toLowerCase();

  if (/windows|win32|win64/.test(platform)) return "windows";
  if (/macintosh|macintel|mac os|iphone|ipad|ipod|mac/.test(platform)) return "macos";
  if (/linux|x11|ubuntu|debian|fedora|android|cros/.test(platform)) return "linux";
  return undefined;
}
