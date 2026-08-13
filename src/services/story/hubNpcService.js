"use strict";

async function listHubNpcs(storyService) {
  const npcs = await storyService.adminListNpcs();
  return npcs
    .filter((npc) => {
      const id = String(npc?.id || "");
      const name = String(npc?.name || "").trim();
      return Boolean(npc?.portraitUrl)
        && !id.startsWith("npc-otonashi-koi")
        && name !== "音無恋";
    })
    .map((npc) => ({
      id: String(npc.id),
      name: String(npc.name || "據點訪客"),
      portraitUrl: String(npc.portraitUrl),
      description: npc.description ? String(npc.description) : null
    }));
}

module.exports = { listHubNpcs };
