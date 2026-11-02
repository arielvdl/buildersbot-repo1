import { PRIVACY_POLICY_META, PRIVACY_POLICY_ROUTE } from "./privacy-policy";
import { BUILDERSBOT_SOCIAL_IMAGE_ALT, BUILDERSBOT_SOCIAL_IMAGE_URL, BUILDERSBOT_X_HANDLE } from "./site-metadata";

/** The head of the privacy policy at /privacy-policy and /privacy. The canonical link is /privacy-policy on both. */
export function privacyPolicyHead(siteUrl: string) {
  const url = new URL(PRIVACY_POLICY_ROUTE, siteUrl).toString();
  const { title, description } = PRIVACY_POLICY_META;
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Builders Bot" },
      { property: "og:locale", content: "en_US" },
      { property: "og:url", content: url },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:image", content: BUILDERSBOT_SOCIAL_IMAGE_URL },
      { property: "og:image:alt", content: BUILDERSBOT_SOCIAL_IMAGE_ALT },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: BUILDERSBOT_X_HANDLE },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: BUILDERSBOT_SOCIAL_IMAGE_URL },
      { name: "twitter:image:alt", content: BUILDERSBOT_SOCIAL_IMAGE_ALT },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
