const { Router } = require('express');
const { getState, joinQueue, removeFromQueue, dismissTeam, resetAll, subscribers } = require('../../services/mahjong/mahjongQueue');

function createMahjongRoutes() {
  const router = Router();

  // 取得目前狀態（公開）
  router.get('/api/mahjong/state', (_req, res) => {
    res.json(getState());
  });

  // SSE 推播（mahjong.html 訂閱）
  router.get('/api/mahjong/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 立即推送當前狀態
    res.write(`data: ${JSON.stringify(getState())}\n\n`);
    subscribers.add(res);

    const hb = setInterval(() => { try { res.write(':\n\n'); } catch (_) {} }, 15000);
    req.on('close', () => { clearInterval(hb); subscribers.delete(res); });
  });

  // 手動加入（測試用）
  router.post('/api/mahjong/join', (req, res) => {
    const { name, userId, platform } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const result = joinQueue(name, userId || name, platform || 'manual');
    res.json(result);
  });

  // 移除排隊者（管理員）
  router.delete('/api/mahjong/queue/:userId', (req, res) => {
    const { platform = 'unknown' } = req.query;
    removeFromQueue(req.params.userId, platform);
    res.json(getState());
  });

  // 解散隊伍（管理員）
  router.delete('/api/mahjong/team/:teamId', (req, res) => {
    dismissTeam(Number(req.params.teamId));
    res.json(getState());
  });

  // 全部重置（管理員）
  router.post('/api/mahjong/reset', (_req, res) => {
    resetAll();
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createMahjongRoutes };
