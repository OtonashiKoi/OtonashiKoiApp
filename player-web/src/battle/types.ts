export type TeamSide = "ally" | "enemy";

export type BattleMode = "auto_tactics";

export interface GridPosition {
  x: number;
  y: number;
}

export interface BattleMapTile {
  x: number;
  y: number;
  terrainId: string;
  moveCost: number;
  hitRateModifier: number;
  evadeRateModifier: number;
}

export interface BattleMap {
  id: string;
  name: string;
  width: number;
  height: number;
  tiles: BattleMapTile[];
  allyDeployArea: GridPosition[];
  enemyDeployArea: GridPosition[];
}

export interface BattleStats {
  hp: number;
  atk: number;
  def: number;
  spd: number;
  moveRange: number;
  attackRange: number;
  critRate: number;
  critDamage: number;
}

export type SkillTargetRule = "lowest_hp_in_range" | "nearest" | "highest_threat" | "self";

export interface BattleSkill {
  id: string;
  name: string;
  type: "normal" | "active" | "passive";
  power: number;
  range: number;
  cooldown: number;
  targetRule: SkillTargetRule;
  aoe: "single" | "line" | "cross" | "square";
  iconUrl: string | null;
}

export interface BattleWeaponModifier {
  hp?: number;
  atk?: number;
  def?: number;
  spd?: number;
  moveRange?: number;
  attackRange?: number;
  critRate?: number;
  critDamage?: number;
}

export interface BattleWeapon {
  id: string;
  name: string;
  iconUrl: string | null;
  statModifiers: BattleWeaponModifier;
  skillOverrides: string[];
}

export interface BattleUnit {
  id: string;
  sourceId: string;
  side: TeamSide;
  name: string;
  level: number;
  spriteUrl: string | null;
  stats: BattleStats;
  weapon: BattleWeapon | null;
  skillIds: string[];
  initialGrid: GridPosition | null;
}

export interface BattleBootstrapPayload {
  fetchedAt: string;
  mode: BattleMode;
  zone: string;
  map: BattleMap;
  units: BattleUnit[];
  skills: BattleSkill[];
}

export interface CloudApiEnvelope<T> {
  status: "ok" | "error";
  code?: string;
  message?: string;
  data: T;
}

export interface BattleBootstrapQuery {
  zone: string;
  mode?: BattleMode;
}

