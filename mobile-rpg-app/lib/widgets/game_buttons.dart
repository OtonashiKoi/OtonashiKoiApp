import 'package:flutter/material.dart';

import 'hud_widgets.dart';

class RoundIconButton extends StatelessWidget {
  const RoundIconButton({
    super.key,
    required this.label,
    required this.onTap,
    this.size = 54,
  });

  final String label;
  final VoidCallback onTap;
  final double size;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      customBorder: const CircleBorder(),
      onTap: onTap,
      child: Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: const Color(0xDD111015),
          shape: BoxShape.circle,
          border: Border.all(color: gold.withOpacity(0.68), width: 1.5),
          boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 18)],
        ),
        child: Text(label, style: const TextStyle(color: gold, fontWeight: FontWeight.w900)),
      ),
    );
  }
}

class BattleButton extends StatefulWidget {
  const BattleButton({super.key, required this.onTap, required this.busy});

  final VoidCallback onTap;
  final bool busy;

  @override
  State<BattleButton> createState() => _BattleButtonState();
}

class _BattleButtonState extends State<BattleButton> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final glow = 18 + _controller.value * 18;
        return GestureDetector(
          onTap: widget.busy ? null : widget.onTap,
          child: Container(
            width: 132,
            height: 132,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: const RadialGradient(
                colors: [Color(0xFFFFBE76), Color(0xFFE7472A), Color(0xFF7D1718)],
              ),
              border: Border.all(color: gold, width: 4),
              boxShadow: [
                BoxShadow(color: const Color(0xFFFF6A35).withOpacity(0.45), blurRadius: glow),
                const BoxShadow(color: Colors.black87, blurRadius: 28, offset: Offset(0, 14)),
              ],
            ),
            child: Text(
              widget.busy ? '結算' : '出戰',
              style: const TextStyle(fontSize: 27, fontWeight: FontWeight.w900),
            ),
          ),
        );
      },
    );
  }
}
