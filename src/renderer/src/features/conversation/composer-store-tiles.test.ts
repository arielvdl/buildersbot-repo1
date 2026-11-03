import { storeTilesOf } from "@buildersbot/ui/features/marketplace/marketplace-connections";
import { describe, expect, it } from "vitest";
import { storyToolCatalogView } from "../../preview/mock-hub-connections";

describe("storeTilesOf", () => {
  it("lists the platforms that the Apps tab shows as tiles", () => {
    const view = storyToolCatalogView("ok");
    const tiles = storeTilesOf([view]);
    expect(tiles.length).toBe(view.platforms.length);
    expect(tiles.map((tile) => tile.name)).toEqual(view.platforms.map((platform) => platform.name));
    expect(tiles.every((tile) => tile.id.startsWith(`${view.id}:`))).toBe(true);
  });

  it("lists nothing for a connection that the person does not use", () => {
    expect(storeTilesOf([storyToolCatalogView("notEnabled")])).toEqual([]);
  });
});
