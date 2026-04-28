import 'package:flutter/material.dart';

import '../models/game_models.dart';
import 'hud_widgets.dart';

class FunctionPanel extends StatelessWidget {
  const FunctionPanel({
    super.key,
    required this.panel,
    required this.snapshot,
    required this.message,
  });

  final String panel;
  final GameSnapshot snapshot;
  final String message;

  @override
  Widget build(BuildContext context) {
    final title = _titles[panel] ?? '首頁';
    final lines = _lines();
    return HudFrame(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(title, style: const TextStyle(color: gold, fontSize: 18, fontWeight: FontWeight.w900)),
              const Spacer(),
              Text(message, overflow: TextOverflow.ellipsis),
            ],
          ),
          const Divider(color: Color(0x55FFD98A)),
          ...lines.map((line) => Padding(
                padding: const EdgeInsets.only(bottom: 7),
                child: Text(line, overflow: TextOverflow.ellipsis),
              )),
        ],
      ),
    );
  }

  List<String> _lines() {
    switch (panel) {
      case 'battle':
        return snapshot.zones
            .map((zone) => '${zone.monsterName} / HP ${zone.currentHp}/${zone.maxHp} / ${zone.participantCount} 人')
            .toList();
      case 'equip':
        return ['已裝備 ${snapshot.equippedCount} 件', '戰力 ${snapshot.progress.power}', '職業 ${snapshot.progress.job}'];
      case 'bag':
        return ['背包道具 ${snapshot.inventoryCount} 件', '掉落物會自動放入背包', '可再接裝備詳情與出售'];
      case 'quest':
        return ['每日討伐', '傷害累積任務', '死亡/閃避/連擊週任務'];
      case 'shop':
        return ['金幣 ${snapshot.wallet.gold}', '鑽石 ${snapshot.wallet.diamond}', '可接 /api/shop/items'];
      default:
        return ['歡迎回來，${snapshot.player.displayName}', '目前戰力 ${snapshot.progress.power}', '選擇功能入口查看內容'];
    }
  }
}

const _titles = {
  'home': '首頁',
  'battle': '討伐',
  'equip': '裝備',
  'bag': '背包',
  'quest': '任務',
  'shop': '商店',
};
