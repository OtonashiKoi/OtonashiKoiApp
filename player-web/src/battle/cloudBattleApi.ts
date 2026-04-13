import type {
  BattleBootstrapPayload,
  BattleBootstrapQuery,
  BattleMap,
  BattleMode,
  BattleStats,
  BattleWeapon,
  CloudApiEnvelope,
} from "./types";

type JsonObject = Record<string, unknown>;

export interface CloudBattleApiOptions {
  apiOrigin?: string;
  apiBasePath?: string;
  getAccessToken?: () => string | null;
  setAccessToken?: (token: string | null) => void;
  fetchImpl?: typeof fetch;
  enableGuestLogin?: boolean;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: JsonObject;
  useAuth?: boolean;
}

interface PlayerProfileData {
  player?: { discordId?: string; displayName?: string; level?: number; avatarUrl?: string | null };
  progress?: {
    level?: number;
    attributes?: { str?: number; agi?: number; vit?: number; int?: number; dex?: number; luk?: number };
    equipment?: { weapon?: { id?: string; name?: string; imageUrl?: string } };
  };
}

interface CombatZoneData {
  zone?: string;
  monsterName?: string;
  monsterImageUrl?: string | null;
  monsterLevel?: number;
  currentHp?: number;
  maxHp?: number;
}

const DEFAULT_BATTLE_MODE: BattleMode = "auto_tactics";

function resolveApiOrigin(explicitApiOrigin?: string): string {
  if (explicitApiOrigin) return explicitApiOrigin.replace(/\/+$/, "");

  const envApiUrl =
    typeof import.meta !== "undefined" &&
    typeof import.meta.env !== "undefined" &&
    typeof import.meta.env.VITE_API_URL === "string"
      ? import.meta.env.VITE_API_URL
      : "";

  if (envApiUrl) return envApiUrl.replace(/\/+$/, "");

  if (typeof window === "undefined") return "http://127.0.0.1:5566";
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return "http://127.0.0.1:5566";
  return window.location.origin.replace(/\/+$/, "");
}

async function parseEnvelope<T>(response: Response): Promise<CloudApiEnvelope<T>> {
  const json = (await response.json()) as CloudApiEnvelope<T>;
  if (!response.ok || json.status !== "ok") {
    throw new Error(json?.message || `請求失敗（${response.status}）`);
  }
  return json;
}

function toNumber(input: unknown, fallback: number): number {
  return typeof input === "number" && Number.isFinite(input) ? input : fallback;
}

function buildDefaultMap(zone: string): BattleMap {
  const width = 8;
  const height = 6;
  const tiles = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      tiles.push({
        x,
        y,
        terrainId: "plain",
        moveCost: 1,
        hitRateModifier: 0,
        evadeRateModifier: 0,
      });
    }
  }

  return {
    id: `default-${zone}`,
    name: `預設 ${zone} 地圖`,
    width,
    height,
    tiles,
    allyDeployArea: [
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 0, y: 3 },
      { x: 1, y: 2 },
      { x: 1, y: 3 },
    ],
    enemyDeployArea: [
      { x: 7, y: 1 },
      { x: 7, y: 2 },
      { x: 7, y: 3 },
      { x: 6, y: 2 },
      { x: 6, y: 3 },
    ],
  };
}

function derivePlayerStats(profile: PlayerProfileData): BattleStats {
  const attr = profile.progress?.attributes || {};
  const level = toNumber(profile.progress?.level ?? profile.player?.level, 1);
  return {
    hp: 350 + toNumber(attr.vit, 1) * 40 + level * 20,
    atk: 40 + toNumber(attr.str, 1) * 8 + level * 2,
    def: 18 + toNumber(attr.vit, 1) * 4 + level,
    spd: 12 + toNumber(attr.agi, 1) * 2,
    moveRange: 3,
    attackRange: 1,
    critRate: Math.min(60, 5 + toNumber(attr.dex, 1) + toNumber(attr.luk, 1)),
    critDamage: 150 + toNumber(attr.luk, 1) * 2,
  };
}

function deriveWeapon(profile: PlayerProfileData): BattleWeapon | null {
  const weapon = profile.progress?.equipment?.weapon;
  if (!weapon?.id && !weapon?.name) return null;
  return {
    id: weapon.id || "weapon-unknown",
    name: weapon.name || "未知武器",
    iconUrl: weapon.imageUrl || null,
    statModifiers: {},
    skillOverrides: [],
  };
}

function mapPrivateDataToBootstrap(
  zone: string,
  mode: BattleMode,
  profile: PlayerProfileData,
  zones: CombatZoneData[],
): BattleBootstrapPayload {
  const selectedZone = zones.find((entry) => entry.zone === zone) || zones[0] || {};
  const playerStats = derivePlayerStats(profile);
  const playerName = profile.player?.displayName || "玩家";
  const monsterHp = Math.max(1, toNumber(selectedZone.maxHp, toNumber(selectedZone.currentHp, 1200)));

  return {
    fetchedAt: new Date().toISOString(),
    zone,
    mode,
    map: buildDefaultMap(zone),
    skills: [],
    units: [
      {
        id: `ally-${profile.player?.discordId || "self"}`,
        sourceId: profile.player?.discordId || "self",
        side: "ally",
        name: playerName,
        level: toNumber(profile.progress?.level ?? profile.player?.level, 1),
        spriteUrl: profile.player?.avatarUrl || null,
        stats: playerStats,
        weapon: deriveWeapon(profile),
        skillIds: [],
        initialGrid: { x: 1, y: 2 },
      },
      {
        id: `enemy-${selectedZone.zone || zone}`,
        sourceId: selectedZone.zone || zone,
        side: "enemy",
        name: selectedZone.monsterName || "怪物",
        level: toNumber(selectedZone.monsterLevel, 1),
        spriteUrl: selectedZone.monsterImageUrl || null,
        stats: {
          hp: monsterHp,
          atk: Math.max(20, Math.round(monsterHp * 0.08)),
          def: Math.max(5, Math.round(monsterHp * 0.03)),
          spd: 8,
          moveRange: 2,
          attackRange: 1,
          critRate: 2,
          critDamage: 150,
        },
        weapon: null,
        skillIds: [],
        initialGrid: { x: 6, y: 2 },
      },
    ],
  };
}

export function createCloudBattleApi(options: CloudBattleApiOptions = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const apiOrigin = resolveApiOrigin(options.apiOrigin);
  const apiBasePath = options.apiBasePath || "/api";
  const enableGuestLogin = options.enableGuestLogin !== false;

  async function request<T>(path: string, requestOptions: RequestOptions = {}): Promise<T> {
    const useAuth = requestOptions.useAuth !== false;
    const token = useAuth ? options.getAccessToken?.() : null;
    const response = await fetchImpl(`${apiOrigin}${apiBasePath}${path}`, {
      method: requestOptions.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(useAuth && token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(requestOptions.body ? { body: JSON.stringify(requestOptions.body) } : {}),
    });

    const parsed = await parseEnvelope<T>(response);
    return parsed.data;
  }

  async function loginAsGuestIfNeeded() {
    const hasToken = Boolean(options.getAccessToken?.());
    if (hasToken || !enableGuestLogin) return;

    const redirectUri =
      typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "http://127.0.0.1";

    const data = await request<{ token?: string }>("/auth/discord", {
      method: "POST",
      useAuth: false,
      body: {
        code: "mock:web-guest",
        redirect_uri: redirectUri,
      },
    });

    if (!data?.token) throw new Error("雲端登入失敗：未取得存取 Token。");
    options.setAccessToken?.(data.token);
  }

  async function loadFromPrivateApi(zone: string, mode: BattleMode) {
    const [profile, zones] = await Promise.all([
      request<PlayerProfileData>("/me/profile"),
      request<CombatZoneData[]>("/combat/zones"),
    ]);
    return mapPrivateDataToBootstrap(zone, mode, profile, zones);
  }

  return {
    async getBattleBootstrap(query: BattleBootstrapQuery): Promise<BattleBootstrapPayload> {
      const zone = query.zone || "normal";
      const mode = query.mode || DEFAULT_BATTLE_MODE;

      try {
        await loginAsGuestIfNeeded();
        return await loadFromPrivateApi(zone, mode);
      } catch (_privateError) {
        try {
          return await request<BattleBootstrapPayload>(`/battle/bootstrap?zone=${encodeURIComponent(zone)}&mode=${encodeURIComponent(mode)}`);
        } catch (_bootstrapError) {
          throw new Error("目前後台尚未提供可用戰鬥資料來源，請確認 API 路由是否已啟用。");
        }
      }
    },
  };
}

