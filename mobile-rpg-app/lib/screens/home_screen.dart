import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/game_models.dart';
import '../services/game_api.dart';
import '../widgets/boss_panel.dart';
import '../widgets/function_panel.dart';
import '../widgets/game_buttons.dart';
import '../widgets/hud_widgets.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.api});

  final GameApi api;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  GameSnapshot? snapshot;
  String selectedPanel = 'home';
  String selectedZone = '';
  String message = '讀取資料中...';
  bool busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => busy = true);
    try {
      final data = await widget.api.loadSnapshot();
      setState(() {
        snapshot = data;
        selectedZone = data.firstZone.zone;
        message = '資料同步完成';
      });
    } catch (error) {
      setState(() => message = 'API 連線失敗：$error');
    } finally {
      setState(() => busy = false);
    }
  }

  Future<void> _battle() async {
    if (busy || snapshot == null) return;
    HapticFeedback.mediumImpact();
    setState(() {
      busy = true;
      selectedPanel = 'battle';
      message = '戰鬥結算中...';
    });
    try {
      final result = await widget.api.quickBattle(activeZone.zone);
      setState(() => message = '${result.monsterName} 造成 ${result.totalDamage} 傷害');
      await _load();
    } catch (error) {
      setState(() => message = error.toString());
    } finally {
      setState(() => busy = false);
    }
  }

  CombatZone get activeZone {
    final data = snapshot;
    if (data == null) return CombatZone.empty();
    return data.zones.firstWhere(
      (zone) => zone.zone == selectedZone,
      orElse: () => data.firstZone,
    );
  }

  @override
  Widget build(BuildContext context) {
    final data = snapshot;
    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(
            child: Image.asset('assets/images/rpg_lobby_concept.png', fit: BoxFit.cover),
          ),
          Positioned.fill(child: Container(color: Colors.black.withOpacity(0.18))),
          if (data == null) _Loading(message: message) else _GameHud(
            snapshot: data,
            zone: activeZone,
            panel: selectedPanel,
            message: message,
            busy: busy,
            onBattle: _battle,
            onSelectPanel: (panel) {
              HapticFeedback.selectionClick();
              setState(() {
                selectedPanel = panel;
                message = '開啟 ${_label(panel)}';
              });
            },
            onSelectZone: (zone) {
              HapticFeedback.selectionClick();
              setState(() {
                selectedZone = zone;
                message = '切換怪物區';
              });
            },
          ),
        ],
      ),
    );
  }
}

class _GameHud extends StatelessWidget {
  const _GameHud({
    required this.snapshot,
    required this.zone,
    required this.panel,
    required this.message,
    required this.busy,
    required this.onBattle,
    required this.onSelectPanel,
    required this.onSelectZone,
  });

  final GameSnapshot snapshot;
  final CombatZone zone;
  final String panel;
  final String message;
  final bool busy;
  final VoidCallback onBattle;
  final ValueChanged<String> onSelectPanel;
  final ValueChanged<String> onSelectZone;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Stack(
        children: [
          Positioned(top: 8, left: 16, child: PlayerHud(snapshot: snapshot)),
          Positioned(top: 10, right: 260, child: ResourceBar(wallet: snapshot.wallet)),
          Positioned(top: 8, right: 16, child: _TopIcons(onTap: onSelectPanel)),
          Positioned(top: 108, left: 24, child: _LeftRail(onTap: onSelectPanel)),
          Positioned(left: 20, bottom: 126, width: 420, child: _HeroCaption(zone: zone, snapshot: snapshot, message: message)),
          Positioned(top: 92, right: 32, width: 600, height: 248, child: BossPanel(zone: zone)),
          Positioned(top: 356, right: 32, width: 600, height: 132, child: FunctionPanel(panel: panel, snapshot: snapshot, message: message)),
          Positioned(left: 16, bottom: 16, child: _Dock(active: panel, onTap: onSelectPanel)),
          Positioned(right: 32, bottom: 18, child: _BattleCluster(busy: busy, onBattle: onBattle, snapshot: snapshot)),
          Positioned(right: 250, bottom: 18, child: _ZoneTabs(snapshot: snapshot, active: zone.zone, onTap: onSelectZone)),
        ],
      ),
    );
  }
}

class _Loading extends StatelessWidget {
  const _Loading({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(child: HudFrame(child: Text(message)));
  }
}

class _HeroCaption extends StatelessWidget {
  const _HeroCaption({required this.zone, required this.snapshot, required this.message});

  final CombatZone zone;
  final GameSnapshot snapshot;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(message, style: const TextStyle(color: gold, fontWeight: FontWeight.w900)),
        Text(zone.monsterName, style: const TextStyle(fontSize: 54, fontWeight: FontWeight.w900, height: 1)),
        Text('討伐資料已同步 / 戰力 ${snapshot.progress.power}', style: const TextStyle(fontWeight: FontWeight.w800)),
      ],
    );
  }
}

class _TopIcons extends StatelessWidget {
  const _TopIcons({required this.onTap});

  final ValueChanged<String> onTap;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        RoundIconButton(label: '友', onTap: () => onTap('home')),
        const SizedBox(width: 10),
        RoundIconButton(label: '信', onTap: () => onTap('quest')),
        const SizedBox(width: 10),
        RoundIconButton(label: 'DC', onTap: () => onTap('battle')),
        const SizedBox(width: 10),
        RoundIconButton(label: '設', onTap: () => onTap('home')),
      ],
    );
  }
}

class _LeftRail extends StatelessWidget {
  const _LeftRail({required this.onTap});

  final ValueChanged<String> onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        RoundIconButton(label: '告', size: 66, onTap: () => onTap('quest')),
        const SizedBox(height: 18),
        RoundIconButton(label: '禮', size: 66, onTap: () => onTap('bag')),
      ],
    );
  }
}

class _Dock extends StatelessWidget {
  const _Dock({required this.active, required this.onTap});

  final String active;
  final ValueChanged<String> onTap;

  @override
  Widget build(BuildContext context) {
    final items = const {
      'home': ['城', '首頁'],
      'battle': ['獸', '討伐'],
      'equip': ['劍', '裝備'],
      'bag': ['袋', '背包'],
      'quest': ['旗', '任務'],
      'shop': ['店', '商店'],
    };
    return HudFrame(
      padding: EdgeInsets.zero,
      child: Row(
        children: items.entries.map((entry) {
          final selected = active == entry.key;
          return InkWell(
            onTap: () => onTap(entry.key),
            child: Container(
              width: 112,
              height: 82,
              color: selected ? const Color(0xAA8F5528) : Colors.transparent,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(entry.value[0], style: const TextStyle(color: gold, fontSize: 25, fontWeight: FontWeight.w900)),
                  Text(entry.value[1], style: const TextStyle(fontWeight: FontWeight.w900)),
                ],
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

class _ZoneTabs extends StatelessWidget {
  const _ZoneTabs({required this.snapshot, required this.active, required this.onTap});

  final GameSnapshot snapshot;
  final String active;
  final ValueChanged<String> onTap;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: snapshot.zones.map((zone) {
        return Padding(
          padding: const EdgeInsets.only(right: 6),
          child: OutlinedButton(
            onPressed: () => onTap(zone.zone),
            child: Text(zone.zone == active ? '◆ ${_zoneLabel(zone.zone)}' : _zoneLabel(zone.zone)),
          ),
        );
      }).toList(),
    );
  }
}

class _BattleCluster extends StatelessWidget {
  const _BattleCluster({required this.busy, required this.onBattle, required this.snapshot});

  final bool busy;
  final VoidCallback onBattle;
  final GameSnapshot snapshot;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            HudFrame(child: const Text('雙劍', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900))),
            const SizedBox(height: 12),
            Row(
              children: [
                RoundIconButton(label: '箱', size: 44, onTap: () {}),
                const SizedBox(width: 8),
                RoundIconButton(label: '袋', size: 44, onTap: () {}),
                const SizedBox(width: 8),
                RoundIconButton(label: '藥', size: 44, onTap: () {}),
              ],
            ),
          ],
        ),
        const SizedBox(width: 16),
        BattleButton(onTap: onBattle, busy: busy),
      ],
    );
  }
}

String _label(String key) {
  return const {
    'home': '首頁',
    'battle': '討伐',
    'equip': '裝備',
    'bag': '背包',
    'quest': '任務',
    'shop': '商店',
  }[key] ?? key;
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
