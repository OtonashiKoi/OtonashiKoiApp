class GameSnapshot {
  const GameSnapshot({
    required this.player,
    required this.wallet,
    required this.progress,
    required this.inventoryCount,
    required this.equippedCount,
    required this.zones,
  });

  final PlayerInfo player;
  final WalletInfo wallet;
  final ProgressInfo progress;
  final int inventoryCount;
  final int equippedCount;
  final List<CombatZone> zones;

  CombatZone get firstZone => zones.isEmpty ? CombatZone.empty() : zones.first;
}

class PlayerInfo {
  const PlayerInfo({required this.displayName, this.avatarUrl});

  final String displayName;
  final String? avatarUrl;

  factory PlayerInfo.fromJson(Map<String, dynamic> json) {
    return PlayerInfo(
      displayName: json['displayName']?.toString() ?? '未登入',
      avatarUrl: json['avatarUrl']?.toString(),
    );
  }
}

class WalletInfo {
  const WalletInfo({required this.gold, required this.diamond});

  final int gold;
  final int diamond;

  factory WalletInfo.fromJson(Map<String, dynamic> json) {
    return WalletInfo(
      gold: _asInt(json['gold']),
      diamond: _asInt(json['diamond']),
    );
  }
}

class ProgressInfo {
  const ProgressInfo({
    required this.level,
    required this.job,
    required this.exp,
    required this.nextLevelExp,
    required this.tier,
    required this.attributes,
  });

  final int level;
  final String job;
  final int exp;
  final int nextLevelExp;
  final String tier;
  final Map<String, int> attributes;

  int get power {
    final attrPower = attributes.values.fold<int>(0, (sum, value) => sum + value) * 120;
    return level * 280 + attrPower;
  }

  factory ProgressInfo.fromJson(Map<String, dynamic> json) {
    final attrs = (json['attributes'] as Map<String, dynamic>? ?? {})
        .map((key, value) => MapEntry(key, _asInt(value)));
    return ProgressInfo(
      level: _asInt(json['level'], fallback: 1),
      job: json['job']?.toString() ?? 'Novice',
      exp: _asInt(json['exp']),
      nextLevelExp: _asInt(json['nextLevelExp'], fallback: 100),
      tier: json['playerTier']?.toString() ?? 'E',
      attributes: attrs.isEmpty ? const {'str': 1, 'agi': 1, 'luk': 1} : attrs,
    );
  }
}

class CombatZone {
  const CombatZone({
    required this.zone,
    required this.monsterName,
    required this.monsterLevel,
    required this.goldReward,
    required this.expReward,
    required this.currentHp,
    required this.maxHp,
    required this.participantCount,
    required this.drops,
    this.monsterImageUrl,
  });

  final String zone;
  final String monsterName;
  final int monsterLevel;
  final int goldReward;
  final int expReward;
  final int currentHp;
  final int maxHp;
  final int participantCount;
  final List<String> drops;
  final String? monsterImageUrl;

  double get hpPercent {
    if (maxHp <= 0) return 0;
    return (currentHp / maxHp).clamp(0, 1).toDouble();
  }

  static CombatZone empty() {
    return const CombatZone(
      zone: 'beginner',
      monsterName: '未連線',
      monsterLevel: 0,
      goldReward: 0,
      expReward: 0,
      currentHp: 0,
      maxHp: 1,
      participantCount: 0,
      drops: [],
    );
  }

  factory CombatZone.fromJson(Map<String, dynamic> json) {
    return CombatZone(
      zone: json['zone']?.toString() ?? 'beginner',
      monsterName: json['monsterName']?.toString() ?? '未設定',
      monsterLevel: _asInt(json['monsterLevel']),
      goldReward: _asInt(json['goldReward']),
      expReward: _asInt(json['expReward']),
      currentHp: _asInt(json['currentHp']),
      maxHp: _asInt(json['maxHp'], fallback: 1),
      participantCount: _asInt(json['participantCount']),
      drops: (json['drops'] as List? ?? []).map((item) => item.toString()).toList(),
      monsterImageUrl: json['monsterImageUrl']?.toString(),
    );
  }
}

class BattleResult {
  const BattleResult({
    required this.monsterName,
    required this.totalDamage,
    required this.outcome,
  });

  final String monsterName;
  final int totalDamage;
  final String outcome;

  factory BattleResult.fromJson(Map<String, dynamic> json) {
    return BattleResult(
      monsterName: json['monsterName']?.toString() ?? '怪物',
      totalDamage: _asInt(json['totalDamage']),
      outcome: json['outcome']?.toString() ?? 'unknown',
    );
  }
}

int _asInt(Object? value, {int fallback = 0}) {
  if (value is int) return value;
  if (value is num) return value.round();
  return int.tryParse(value?.toString() ?? '') ?? fallback;
}
