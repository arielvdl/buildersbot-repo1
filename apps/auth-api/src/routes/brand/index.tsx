import { createFileRoute } from "@tanstack/solid-router";
import { BrandPage } from "../../components/brand/BrandPage";
import { BRAND_PAGE_META, BRAND_ROUTE } from "../../lib/brand-page";
import {
  BUILDERSBOT_SOCIAL_IMAGE_ALT,
  BUILDERSBOT_SOCIAL_IMAGE_URL,
  BUILDERSBOT_X_HANDLE,
} from "../../lib/site-metadata";

export const Route = createFileRoute("/brand/")({
  head: ({ match }) => {
    const url = new URL(BRAND_ROUTE, match.context.siteUrl).toString();
    const { title, description } = BRAND_PAGE_META;
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
  component: BrandPage,
});
