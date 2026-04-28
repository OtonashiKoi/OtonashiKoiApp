import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/game_models.dart';

class GameApi {
  GameApi({
    required this.baseUrl,
    http.Client? client,
  }) : _client = client ?? http.Client();

  final String baseUrl;
  final http.Client _client;
  String? _token;

  Future<GameSnapshot> loadSnapshot() async {
    await _ensureToken();
    final profile = await _get('/api/me/profile');
    final inventory = await _get('/api/me/inventory');
    final zones = await _get('/api/combat/zones');

    final progress = ProgressInfo.fromJson(_map(profile['progress']));
    final equipped = _map(inventory['equipped']);
    final items = inventory['inventory'] as List? ?? [];

    return GameSnapshot(
      player: PlayerInfo.fromJson(_map(profile['player'])),
      wallet: WalletInfo.fromJson(_map(profile['wallet'])),
      progress: progress,
      inventoryCount: items.length,
      equippedCount: equipped.values.where((item) => item != null).length,
      zones: (zones as List? ?? [])
          .map((zone) => CombatZone.fromJson(_map(zone)))
          .toList(),
    );
  }

  Future<BattleResult> quickBattle(String zone) async {
    await _ensureToken();
    final data = await _post('/api/combat/quick-battle', {'zone': zone});
    return BattleResult.fromJson(_map(data));
  }

  Future<void> _ensureToken() async {
    if (_token != null) return;
    final data = await _post('/api/auth/discord', {
      'code': 'mock:1450019975031951370',
    }, needsAuth: false);
    _token = data['token']?.toString();
  }

  Future<dynamic> _get(String path) async {
    final response = await _client.get(_uri(path), headers: _headers());
    return _decode(response);
  }

  Future<dynamic> _post(
    String path,
    Map<String, dynamic> body, {
    bool needsAuth = true,
  }) async {
    final response = await _client.post(
      _uri(path),
      headers: _headers(needsAuth: needsAuth),
      body: jsonEncode(body),
    );
    return _decode(response);
  }

  Uri _uri(String path) => Uri.parse('$baseUrl$path');

  Map<String, String> _headers({bool needsAuth = true}) {
    return {
      'Content-Type': 'application/json',
      if (needsAuth && _token != null) 'Authorization': 'Bearer $_token',
    };
  }

  dynamic _decode(http.Response response) {
    final json = jsonDecode(utf8.decode(response.bodyBytes));
    if (response.statusCode >= 400 || json['status'] == 'error') {
      throw Exception(json['message'] ?? 'API error ${response.statusCode}');
    }
    return json['data'];
  }

  Map<String, dynamic> _map(Object? value) {
    return value is Map<String, dynamic> ? value : <String, dynamic>{};
  }
}
