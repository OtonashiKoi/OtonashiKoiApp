"use strict";

const SUPPORT_BADGE_IDS = Object.freeze([
  "job_healer_v1",
  "job_tactician_v1",
  "job_bard_v1",
  "job_barrier_mage_v1",
]);

const ANCHOR_QUEST_RULES = Object.freeze([
  {
    questId: "adb20d0d-829d-4d94-a1bd-2c40d506c43f",
    rewardItemId: "s-legend-bond",
    fields: {
      target: 1500,
      unlockProgressAtLeast: 0,
      unlockRequireItemIds: SUPPORT_BADGE_IDS,
      description: "【隱藏賽季任務】集齊全部輔助職業徽章（治療師／軍師／詩人／結界師）後現身。裝著任一輔助職徽章出戰累積 1,500 場，證明你與夥伴的羈絆。獎勵：傳說錨點【繫絆・共鳴之鏈】。",
    },
  },
  {
    questId: "33b37247-c914-4b10-9822-cb13082e7c54",
    rewardItemId: "s-legend-endure",
    fields: {
      target: 100000,
      unlockProgressAtLeast: 50000,
      description: "【隱藏賽季任務】累積承受傷害達 5 萬後現身；解鎖後再硬吃 5 萬點傷害，證明你扛得住。獎勵：傳說錨點【沒苦硬吃】。",
    },
  },
  {
    questId: "season_anchor_thirst_lifesteal_v2",
    rewardItemId: "s-legend-thirst",
    fields: {
      target: 100000,
      unlockProgressAtLeast: 50000,
      description: "【隱藏賽季任務】累積實際吸血 5 萬點後現身；解鎖後再實際吸血 5 萬點。滿血時的溢出吸血不列入。獎勵：傳說錨點【對鮮血的渴望】。",
    },
  },
  {
    questId: "season_anchor_saint_healing_v2",
    rewardItemId: "s-legend-saint",
    fields: {
      target: 50000,
      unlockProgressAtLeast: 0,
      unlockRequireSeasonDonation: false,
      description: "【賽季任務】累積實際非吸血治療 5 萬點。滿血溢補、治療轉傷害與吸血不列入。獎勵：傳說錨點【聖人就是比拳頭大小】。",
    },
  },
  {
    questId: "15718b28-c96c-4fcd-a9ba-a922e5e383cb",
    rewardItemId: "s-legend-timelord",
    fields: {
      target: 7,
      unlockCheckinStreak: 3,
      description: "【隱藏賽季任務】連續簽到 3 天後現身；連續簽到滿 7 天，掌握時間者得之。獎勵：傳說錨點【時間管理大師】。",
    },
  },
]);

module.exports = { SUPPORT_BADGE_IDS, ANCHOR_QUEST_RULES };
