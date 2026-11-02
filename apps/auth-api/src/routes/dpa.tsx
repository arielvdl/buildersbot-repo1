import { createFileRoute } from "@tanstack/solid-router";
import { DpaPage } from "../components/legal/DpaPage";
import { DPA_META, DPA_ROUTE } from "../lib/dpa";
import { BUILDERSBOT_SOCIAL_IMAGE_ALT, BUILDERSBOT_SOCIAL_IMAGE_URL, BUILDERSBOT_X_HANDLE } from "../lib/site-metadata";

export const Route = createFileRoute("/dpa")({
  head: ({ match }) => {
    const url = new URL(DPA_ROUTE, match.context.siteUrl).toString();
    const { title, description } = DPA_META;
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
  },
  component: DpaPage,
});
