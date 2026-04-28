import 'package:flutter/material.dart';

import 'screens/home_screen.dart';
import 'services/game_api.dart';

class EquipmentRpgApp extends StatelessWidget {
  const EquipmentRpgApp({super.key});

  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://127.0.0.1:5566',
  );

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: '月影星花',
      theme: ThemeData(
        brightness: Brightness.dark,
        fontFamily: 'NotoSansTC',
        scaffoldBackgroundColor: const Color(0xFF090B12),
        useMaterial3: true,
      ),
      home: HomeScreen(api: GameApi(baseUrl: apiBaseUrl)),
    );
  }
}
