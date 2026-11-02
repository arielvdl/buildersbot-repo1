import { createFileRoute, notFound, redirect } from "@tanstack/solid-router";
import { ArticlePage } from "../../components/content/ArticlePage";
import { type CollectionArticle, findArticle } from "../../lib/content-collection";
import { articleHead } from "../../lib/content-metadata";
import { GUIDES_COLLECTION } from "../../lib/guides";

// The same reason as on /news: the lookup is in `loader`, so an unknown slug ends
// as a real not-found response rather than a 200 that renders an error card.
function loadGuide(slug: string): CollectionArticle {
  const guide = findArticle(GUIDES_COLLECTION, slug);
  if (!guide) throw notFound();
  return guide;
}

export const Route = createFileRoute("/guides/$slug")({
  loader: ({ params }) => {
    // The guide was published under the earlier product name. A 308 keeps saved links and search
    // results on the page that replaced it.
    if (params.slug === "openbot-hosted-servers") {
      throw redirect({ to: "/guides/$slug", params: { slug: "buildersbot-hosted-servers" }, statusCode: 308 });
    }
    if (params.slug === "write-a-guide-for-buildersbot") {
      throw redirect({
        href: "https://github.com/nextlevelcommunity/buildersbot-repo1/blob/main/CONTRIBUTING.md",
        statusCode: 308,
      });
    }

    return loadGuide(params.slug);
  },
  head: ({ loaderData, match }) =>
    loaderData ? articleHead(GUIDES_COLLECTION, loaderData, match.context.siteUrl) : {},
  component: GuideRoute,
});

function GuideRoute() {
  const guide = Route.useLoaderData();
  return <ArticlePage collection={GUIDES_COLLECTION} article={guide()} />;
}
