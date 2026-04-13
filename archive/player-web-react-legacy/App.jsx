import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCloudBattleApi, runAutoBattle } from "./battle";
import { createBattlefieldGame } from "./phaser/createBattlefieldGame";
import "./App.css";

export default function App() {
  const mountRef = useRef(null);
  const gameRef = useRef(null);

  const [zone, setZone] = useState("normal");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [bootstrap, setBootstrap] = useState(null);
  const [battleResult, setBattleResult] = useState(null);

  const battleApi = useMemo(
    () =>
      createCloudBattleApi({
        getAccessToken: () => localStorage.getItem("player_token"),
        setAccessToken: (token) => {
          if (token) localStorage.setItem("player_token", token);
          else localStorage.removeItem("player_token");
        },
      }),
    [],
  );

  const loadBattle = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await battleApi.getBattleBootstrap({ zone });
      const result = runAutoBattle(payload);
      setBootstrap(payload);
      setBattleResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "讀取雲端戰鬥資料失敗。");
      setBattleResult(null);
    } finally {
      setLoading(false);
    }
  }, [battleApi, zone]);

  useEffect(() => {
    loadBattle();
  }, [loadBattle]);

  useEffect(() => {
    if (!mountRef.current || !bootstrap) return undefined;

    if (gameRef.current) {
      gameRef.current.destroy(true);
      gameRef.current = null;
    }

    gameRef.current = createBattlefieldGame({
      mountElement: mountRef.current,
      bootstrap,
      battleResult,
    });

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, [battleResult, bootstrap]);

  const battleSummary = useMemo(() => {
    if (!battleResult) return "";
    if (battleResult.outcome === "ally_win") return "我方勝利";
    if (battleResult.outcome === "enemy_win") return "敵方勝利";
    return "平手";
  }, [battleResult]);

  return (
    <main className="app-shell">
      <header className="top-bar">
        <h1>自動戰棋戰場預覽</h1>
        <div className="actions">
          <label>
            區域
            <select value={zone} onChange={(event) => setZone(event.target.value)}>
              <option value="normal">normal</option>
              <option value="mid">mid</option>
            </select>
          </label>
          <button type="button" onClick={loadBattle} disabled={loading}>
            {loading ? "載入中..." : "重新載入雲端資料"}
          </button>
        </div>
      </header>

      <section className="content-grid">
        <div className="battle-panel">
          <div ref={mountRef} className="battle-canvas" />
          {battleResult ? (
            <p className="result-text">
              結果：{battleSummary} / 回合數：{battleResult.rounds}
            </p>
          ) : null}
        </div>

        <aside className="info-panel">
          <h2>戰鬥紀錄（自動回合）</h2>
          {error ? <p className="error-text">{error}</p> : null}
          <div className="battle-log">
            {(battleResult?.actions || []).map((action, index) => (
              <p key={`${action.type}-${index}`}>{action.text}</p>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
