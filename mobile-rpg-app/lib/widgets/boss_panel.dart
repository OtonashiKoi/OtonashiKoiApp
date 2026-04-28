import 'package:flutter/material.dart';

import '../models/game_models.dart';
import 'hud_widgets.dart';

class BossPanel extends StatelessWidget {
  const BossPanel({super.key, required this.zone});

  final CombatZone zone;

  @override
  Widget build(BuildContext context) {
    return HudFrame(
      padding: EdgeInsets.zero,
      child: Stack(
        children: [
          Positioned.fill(child: _BossArt(url: zone.monsterImageUrl)),
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [Colors.black.withOpacity(0.82), Colors.black.withOpacity(0.2)],
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 18, 24, 18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const CircleAvatar(
                      radius: 34,
                      backgroundColor: Color(0xFF621518),
                      child: Text('王', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900)),
                    ),
                    const SizedBox(width: 18),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(_zoneLabel(zone.zone), style: const TextStyle(color: gold, fontWeight: FontWeight.w900)),
                          Text(
                            zone.monsterName,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w900),
                          ),
                          Text('Lv.${zone.monsterLevel} / ${zone.participantCount} 人參戰'),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                _BossBar(label: 'HP', value: zone.hpPercent, trailing: '${zone.currentHp}/${zone.maxHp}'),
                const SizedBox(height: 10),
                _BossBar(label: '獎', value: 0.78, trailing: '${zone.goldReward}G / ${zone.expReward}EXP'),
                const SizedBox(height: 14),
                Expanded(
                  child: Row(
                    children: zone.drops.take(5).map((drop) => _DropBox(label: drop)).toList(),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _BossArt extends StatelessWidget {
  const _BossArt({required this.url});

  final String? url;

  @override
  Widget build(BuildContext context) {
    if (url == null || url!.isEmpty) {
      return const DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(colors: [Color(0xFF401417), Color(0xFF7D1F2A)]),
        ),
      );
    }
    return Image.network(url!, fit: BoxFit.cover, errorBuilder: (_, __, ___) {
      return const DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(colors: [Color(0xFF401417), Color(0xFF7D1F2A)]),
        ),
      );
    });
  }
}

class _BossBar extends StatelessWidget {
  const _BossBar({required this.label, required this.value, required this.trailing});

  final String label;
  final double value;
  final String trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        CircleAvatar(radius: 16, backgroundColor: const Color(0xFF171017), child: Text(label)),
        const SizedBox(width: 10),
        Expanded(
          child: LinearProgressIndicator(
            value: value,
            minHeight: 12,
            backgroundColor: const Color(0xFF1B1214),
            color: label == 'HP' ? const Color(0xFFE8423F) : gold,
          ),
        ),
        const SizedBox(width: 10),
        Text(trailing, style: const TextStyle(color: gold, fontWeight: FontWeight.w900)),
      ],
    );
  }
}

class _DropBox extends StatelessWidget {
  const _DropBox({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        margin: const EdgeInsets.only(right: 8),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: const Color(0xDD171017),
          border: Border.all(color: gold.withOpacity(0.58)),
        ),
        child: Text(label, maxLines: 2, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center),
      ),
    );
  }
}

String _zoneLabel(String zone) {
  return const {
    'beginner': '新手區',
    'normal': '一般區',
    'mid': '中級區',
    'hard': '高級區',
    'elite': '精英區',
  }[zone] ?? zone;
}
