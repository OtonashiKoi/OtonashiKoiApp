import 'package:flutter/material.dart';

import '../models/game_models.dart';

const gold = Color(0xFFFFD98A);
const panel = Color(0xCC151018);

class HudFrame extends StatelessWidget {
  const HudFrame({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(12),
  });

  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: panel,
        border: Border.all(color: gold.withOpacity(0.62), width: 1.5),
        boxShadow: const [
          BoxShadow(color: Color(0xAA000000), blurRadius: 24, offset: Offset(0, 12)),
        ],
      ),
      child: child,
    );
  }
}

class PlayerHud extends StatelessWidget {
  const PlayerHud({super.key, required this.snapshot});

  final GameSnapshot snapshot;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 340,
      child: Row(
        children: [
          CircleAvatar(
            radius: 36,
            backgroundColor: gold,
            backgroundImage: snapshot.player.avatarUrl == null
                ? null
                : NetworkImage(snapshot.player.avatarUrl!),
            child: snapshot.player.avatarUrl == null
                ? Text(_initial(snapshot.player.displayName))
                : null,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: HudFrame(
              padding: const EdgeInsets.fromLTRB(18, 9, 12, 9),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    snapshot.player.displayName,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
                  ),
                  Text(
                    '${snapshot.progress.job} / Tier ${snapshot.progress.tier}',
                    style: const TextStyle(color: Color(0xFFE8CFA7), fontSize: 12),
                  ),
                  const SizedBox(height: 7),
                  LinearProgressIndicator(
                    value: snapshot.progress.nextLevelExp == 0
                        ? 1
                        : (snapshot.progress.exp / snapshot.progress.nextLevelExp)
                            .clamp(0, 1)
                            .toDouble(),
                    minHeight: 5,
                    backgroundColor: const Color(0xFF302020),
                    color: gold,
                  ),
                ],
              ),
            ),
          ),
          Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: const Color(0xFF111018),
              shape: BoxShape.circle,
              border: Border.all(color: gold, width: 2),
            ),
            child: Text(
              '${snapshot.progress.level}',
              style: const TextStyle(fontWeight: FontWeight.w900),
            ),
          ),
        ],
      ),
    );
  }
}

class ResourceBar extends StatelessWidget {
  const ResourceBar({super.key, required this.wallet});

  final WalletInfo wallet;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        ResourceChip(label: '金', value: wallet.gold),
        const SizedBox(width: 8),
        ResourceChip(label: '鑽', value: wallet.diamond),
        const SizedBox(width: 8),
        const ResourceChip(label: '體', textValue: '120/120'),
      ],
    );
  }
}

class ResourceChip extends StatelessWidget {
  const ResourceChip({
    super.key,
    required this.label,
    this.value,
    this.textValue,
  });

  final String label;
  final int? value;
  final String? textValue;

  @override
  Widget build(BuildContext context) {
    return HudFrame(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircleAvatar(
            radius: 13,
            backgroundColor: gold,
            child: Text(label, style: const TextStyle(color: Colors.black, fontSize: 11)),
          ),
          const SizedBox(width: 8),
          Text(
            textValue ?? _format(value ?? 0),
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
          ),
          const Text(' +', style: TextStyle(color: gold, fontWeight: FontWeight.w900)),
        ],
      ),
    );
  }
}

String _format(int value) {
  return value.toString().replaceAllMapped(
    RegExp(r'\B(?=(\d{3})+(?!\d))'),
    (_) => ',',
  );
}

String _initial(String value) {
  if (value.isEmpty) return '月';
  return value.substring(0, 1);
}
