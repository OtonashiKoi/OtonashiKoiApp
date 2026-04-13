import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Rnd } from 'react-rnd';
import { api } from '../api.js';
import { BattlefieldCanvas, VIEWER_ARENA_SIZE } from './BattlefieldCanvas.jsx';
import { buildBattlefieldSceneModel } from './viewerModels.js';
import './viewer.css';

const DEFAULT_WINDOWS = {
  map: { x: 20, y: 24, width: 260, height: 220, z: 4, open: true },
  stats: { x: 24, y: 600, width: 360, height: 240, z: 5, open: true },
  ranking: { x: 1180, y: 560, width: 340, height: 280, z: 6, open: true },
};

const MOCK_VIEWER_SNAPSHOT = {
  zones: [
    {
      zone: 'normal',
      monsterName: 'Clockwork Basilisk',
      monsterImageUrl: null,
      monsterLevel: 12,
      currentHp: 860,
      maxHp: 1200,
      participantCount: 5,
      damageLeaderboard: [
        { discordId: '1', name: 'Rin', damage: 420, damageTaken: 72, weaponType: 'sword_1h', avatarUrl: null },
        { discordId: '2', name: 'Mika', damage: 380, damageTaken: 54, weaponType: 'bow', avatarUrl: null },
        { discordId: '3', name: 'Noa', damage: 344, damageTaken: 48, weaponType: 'staff_1h', avatarUrl: null },
        { discordId: '4', name: 'Haku', damage: 310, damageTaken: 80, weaponType: 'axe_2h', avatarUrl: null },
        { discordId: '5', name: 'Sena', damage: 266, damageTaken: 32, weaponType: 'dagger', avatarUrl: null },
      ],
    },
    {
      zone: 'mid',
      monsterName: 'Night Archive',
      monsterImageUrl: null,
      monsterLevel: 18,
      currentHp: 1320,
      maxHp: 1800,
      participantCount: 4,
      damageLeaderboard: [
        { discordId: '6', name: 'Yui', damage: 520, damageTaken: 96, weaponType: 'staff_2h', avatarUrl: null },
        { discordId: '7', name: 'Kai', damage: 470, damageTaken: 65, weaponType: 'sword_2h', avatarUrl: null },
        { discordId: '8', name: 'Luna', damage: 405, damageTaken: 40, weaponType: 'bow', avatarUrl: null },
      ],
    },
  ],
  streamPresence: { viewerCount: 8, actors: [], isLive: true },
};

function PixelWindow({ title, state, onFocus, onClose, onDragStop, onResizeStop, children }) {
  if (!state.open) return null;
  return (
    <Rnd
      bounds="parent"
      size={{ width: state.width, height: state.height }}
      position={{ x: state.x, y: state.y }}
      style={{ zIndex: state.z }}
      className="pixel-window"
      onDragStart={onFocus}
      onMouseDown={onFocus}
      onDragStop={(_, data) => onDragStop(data.x, data.y)}
      onResizeStop={(_, __, ref, ___, position) => onResizeStop(ref.offsetWidth, ref.offsetHeight, position.x, position.y)}
      minWidth={220}
      minHeight={160}
      dragHandleClassName="pixel-window-bar"
    >
      <div className="pixel-window-shell">
        <div className="pixel-window-bar">
          <span>{title}</span>
          <button onClick={onClose}>X</button>
        </div>
        <div className="pixel-window-body">{children}</div>
      </div>
    </Rnd>
  );
}

function buildBattleFeed(zone, streamPresence) {
  const leaders = zone?.damageLeaderboard || [];
  const leader = leaders[0];
  const topTaken = [...leaders].sort((a, b) => (b.damageTaken || 0) - (a.damageTaken || 0))[0];
  return [
    `${zone?.monsterName || 'Monster'} remains active on the DC frontline.`,
    `${zone?.participantCount || 0} fighters currently locked in combat.`,
    leader ? `${leader.name} leads damage with ${leader.damage.toLocaleString()} total.` : 'Waiting for the first combat log.',
    topTaken ? `${topTaken.name} has absorbed ${topTaken.damageTaken.toLocaleString()} damage so far.` : 'No incoming damage tracked yet.',
    `${streamPresence?.viewerCount || 0} live viewers are currently watching.`,
  ];
}

export function BattleViewerApp() {
  const [zones, setZones] = useState([]);
  const [selectedZone, setSelectedZone] = useState('normal');
  const [streamPresence, setStreamPresence] = useState({ viewerCount: 0, actors: [], isLive: false });
  const [viewerMode, setViewerMode] = useState('live');
  const [mockViewerCount, setMockViewerCount] = useState(8);
  const [windows, setWindows] = useState(DEFAULT_WINDOWS);
  const [topZ, setTopZ] = useState(10);
  const [battleFeed, setBattleFeed] = useState(['Preparing viewer sync...']);
  const [battleScene, setBattleScene] = useState(null);
  const [pulseTick, setPulseTick] = useState(0);

  const loadData = async () => {
    if (viewerMode === 'mock') {
      setZones(MOCK_VIEWER_SNAPSHOT.zones);
      setStreamPresence(MOCK_VIEWER_SNAPSHOT.streamPresence);
      return;
    }

    const snapshot = await api.getViewerSnapshot();
    setZones(snapshot.zones || []);
    setStreamPresence(snapshot.streamPresence || { viewerCount: 0, actors: [], isLive: false });
  };

  useEffect(() => {
    document.body.classList.add('viewer-mode');
    loadData().catch(console.error);
    const timer = window.setInterval(() => loadData().catch(console.error), 5000);
    return () => {
      document.body.classList.remove('viewer-mode');
      window.clearInterval(timer);
    };
  }, [viewerMode]);

  useEffect(() => {
    const timer = window.setInterval(() => setPulseTick((value) => value + 1), 1200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!zones.some((zone) => zone.zone === selectedZone) && zones[0]?.zone) {
      setSelectedZone(zones[0].zone);
    }
  }, [zones, selectedZone]);

  const currentZone = zones.find((zone) => zone.zone === selectedZone) || zones[0] || null;

  useEffect(() => {
    if (!currentZone) return;

    const leaders = currentZone.damageLeaderboard || [];
    const maxDamage = Math.max(1, ...leaders.map((entry) => entry.damage || 0));
    const maxTaken = Math.max(1, ...leaders.map((entry) => entry.damageTaken || 0));
    const partyHpRatios = leaders.slice(0, 6).map((entry, index) => {
      const offenseRatio = (entry.damage || 0) / maxDamage;
      const pressureRatio = (entry.damageTaken || 0) / maxTaken;
      const pulse = 0.04 * Math.sin(pulseTick + index * 0.85);
      return Math.max(0.24, Math.min(0.96, 0.82 - pressureRatio * 0.28 + offenseRatio * 0.16 + pulse));
    });

    setBattleScene({
      monsterHp: currentZone.currentHp || currentZone.maxHp || 1,
      totalDamage: leaders.reduce((sum, entry) => sum + (entry.damage || 0), 0),
      partyHpRatios,
      partyLeadMaxHp: 150 + Math.round(Math.min(90, maxDamage / 45)),
      updatedAt: Date.now(),
    });
    setBattleFeed(buildBattleFeed(currentZone, streamPresence));
  }, [currentZone, streamPresence, pulseTick]);

  const scene = useMemo(() => buildBattlefieldSceneModel({
    zones,
    selectedZone,
    streamPresence,
    mockViewerCount,
    mode: viewerMode,
    battleScene,
  }), [zones, selectedZone, streamPresence, mockViewerCount, viewerMode, battleScene]);

  const isBattling = (currentZone?.participantCount || 0) > 0;

  const updateWindow = (key, patch) => {
    setWindows((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  };

  const focusWindow = (key) => {
    setTopZ((value) => {
      const nextZ = value + 1;
      setWindows((current) => ({ ...current, [key]: { ...current[key], z: nextZ } }));
      return nextZ;
    });
  };

  const toggleWindow = (key) => {
    if (windows[key].open) {
      updateWindow(key, { open: false });
      return;
    }
    focusWindow(key);
    updateWindow(key, { open: true });
  };

  return (
    <div className="viewer-root">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <strong>Battle Viewer Mode</strong>
          <span>{currentZone?.monsterName || 'Loading zone'} / {scene.buffState.title}</span>
        </div>
        <div className="viewer-toolbar-actions">
          <button onClick={() => toggleWindow('map')}>地圖</button>
          <button onClick={() => toggleWindow('stats')}>戰況</button>
          <button onClick={() => toggleWindow('ranking')}>排行</button>
          <Link to="/">回首頁</Link>
        </div>
      </div>

      <div className="viewer-stage-shell">
        <div className="viewer-stage-frame">
          <div className="viewer-canvas-wrap" style={{ aspectRatio: `${VIEWER_ARENA_SIZE.width} / ${VIEWER_ARENA_SIZE.height}` }}>
            <BattlefieldCanvas scene={scene} isBattling={isBattling} />

            <div className="viewer-overlay top-left">
              <div className="viewer-chip">{scene.zone?.monsterName || 'Zone'}</div>
              <div className="viewer-chip subtle">{scene.zone?.participantCount || 0} Fighters</div>
              <div className="viewer-chip subtle">{scene.viewerCount} Viewers</div>
            </div>

            <div className="viewer-overlay left-bottom roster">
              <h3>Frontline</h3>
              {scene.playerActors.map((actor) => (
                <div key={actor.id} className="roster-row">
                  <span>{actor.name}</span>
                  <div className="roster-bar">
                    <div style={{ width: `${Math.max(5, Math.round((actor.hp / Math.max(1, actor.maxHp)) * 100))}%` }} />
                  </div>
                  <strong>{actor.hp}/{actor.maxHp}</strong>
                </div>
              ))}
            </div>

            <div className="viewer-overlay right-bottom battle-summary">
              <div className="summary-grid">
                <div><span>Monster HP</span><strong>{scene.monsterHp}/{scene.monsterMaxHp}</strong></div>
                <div><span>Total DMG</span><strong>{battleScene?.totalDamage || 0}</strong></div>
                <div><span>Zone Buff</span><strong>{scene.buffState.effect}</strong></div>
              </div>
            </div>

            <div className="viewer-overlay bottom-center battle-controls">
              <button className="viewer-battle-btn" disabled>
                {isBattling ? 'LIVE AUTO BATTLE' : 'WAITING FOR COMBAT'}
              </button>
              <div className="viewer-skill-bar">
                {[
                  ['前排', '近戰武器'],
                  ['中排', '雙手重武'],
                  ['後排', '弓與法杖'],
                  ['承傷', '即時同步'],
                  ['輸出', '即時同步'],
                ].map(([label, sub]) => (
                  <div key={label} className="viewer-skill-slot">
                    <span>{label}</span>
                    <small>{sub}</small>
                  </div>
                ))}
              </div>
            </div>

            <div className="viewer-overlay top-right debug-panel">
              <div className="debug-row">
                <label>Viewer Source</label>
                <select value={viewerMode} onChange={(event) => setViewerMode(event.target.value)}>
                  <option value="live">live</option>
                  <option value="mock">mock</option>
                </select>
              </div>
              <div className="debug-row">
                <label>Mock Count</label>
                <input type="range" min="0" max="32" value={mockViewerCount} onChange={(event) => setMockViewerCount(Number(event.target.value))} />
                <strong>{mockViewerCount}</strong>
              </div>
            </div>
          </div>

          <PixelWindow
            title="戰區地圖"
            state={windows.map}
            onFocus={() => focusWindow('map')}
            onClose={() => updateWindow('map', { open: false })}
            onDragStop={(x, y) => updateWindow('map', { x, y })}
            onResizeStop={(width, height, x, y) => updateWindow('map', { width, height, x, y })}
          >
            {(zones || []).map((zone) => (
              <button key={zone.zone} className={`window-zone-btn ${selectedZone === zone.zone ? 'active' : ''}`} onClick={() => setSelectedZone(zone.zone)}>
                <strong>{zone.zone}</strong>
                <span>{zone.monsterName}</span>
              </button>
            ))}
          </PixelWindow>

          <PixelWindow
            title="戰況快報"
            state={windows.stats}
            onFocus={() => focusWindow('stats')}
            onClose={() => updateWindow('stats', { open: false })}
            onDragStop={(x, y) => updateWindow('stats', { x, y })}
            onResizeStop={(width, height, x, y) => updateWindow('stats', { width, height, x, y })}
          >
            <div className="stat-card-grid">
              <div><span>Active Monster</span><strong>{currentZone?.monsterName || '-'}</strong></div>
              <div><span>Monster Lv</span><strong>{currentZone?.monsterLevel || 0}</strong></div>
              <div><span>Participants</span><strong>{currentZone?.participantCount || 0}</strong></div>
              <div><span>Viewers</span><strong>{streamPresence?.viewerCount || 0}</strong></div>
              <div><span>Gold Reward</span><strong>{currentZone?.goldReward || 0}</strong></div>
              <div><span>EXP Reward</span><strong>{currentZone?.expReward || 0}</strong></div>
            </div>
            <div className="window-feed">
              {battleFeed.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
            </div>
          </PixelWindow>

          <PixelWindow
            title="前線排行"
            state={windows.ranking}
            onFocus={() => focusWindow('ranking')}
            onClose={() => updateWindow('ranking', { open: false })}
            onDragStop={(x, y) => updateWindow('ranking', { x, y })}
            onResizeStop={(width, height, x, y) => updateWindow('ranking', { width, height, x, y })}
          >
            <div className="equipment-list">
              {(currentZone?.damageLeaderboard || []).slice(0, 6).map((entry, index) => (
                <div key={`${entry.discordId || entry.name}-${index}`} className="equipment-row">
                  <div className="equipment-thumb">
                    <span>{index + 1}</span>
                  </div>
                  <div>
                    <strong>{entry.name}</strong>
                    <span>DMG {entry.damage || 0} / TAKEN {entry.damageTaken || 0}</span>
                  </div>
                </div>
              ))}
            </div>
          </PixelWindow>
        </div>
      </div>
    </div>
  );
}
