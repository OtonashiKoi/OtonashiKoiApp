import React, { useState, useEffect } from 'react';
import { api, getDiscordLoginUrl, setToken, API_ORIGIN } from './api';
import './index.css';

// SVG Icons
const Icons = {
  User: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>,
  Backpack: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10h16M4 14h16M6 6h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>,
  Swords: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 17.5L3 6V3h3l11.5 11.5"></path><path d="M13 19l6-6"></path><path d="M16 16l4 4"></path><path d="M19 21l2-2"></path><path d="M14.5 6.5L18 3h3v3l-3.5 3.5"></path><path d="M5 14l4 4"></path><path d="M7 17l-3 3"></path><path d="M3 19l2 2"></path></svg>,
  Store: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>,
  Chat: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z"></path></svg>,
  Discord: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/></svg>,
  CheckCircle: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
};

const getAssetUrl = (url) => {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  // Ensure we don't double slash
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${API_ORIGIN}${path}`;
};

function LoginScreen() {
  const handleLogin = () => {
    window.location.href = getDiscordLoginUrl();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '40px', textAlign: 'center' }}>
      <h1 style={{ fontSize: '2.5rem', marginBottom: '8px' }}>Equipment</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '48px' }}>Login to access your adventure</p>
      <button className="btn btn-primary" onClick={handleLogin} style={{ backgroundColor: '#5865F2' }}>
        <Icons.Discord />
        使用 Discord 登入
      </button>
      <p style={{ marginTop: '24px', fontSize: '12px', color: 'var(--muted)' }}>
        我們將使用 Discord OAuth2 安全地同步您的遊戲進度與背包。
      </p>
    </div>
  );
}

function ProfileTab() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.getProfile().then(setData).catch(console.error);
  }, []);

  if (!data) return <div className="app-screen" style={{display:'flex',justifyContent:'center',alignItems:'center'}}>Loading Profile...</div>;

  const { player, wallet, progress } = data;
  const { attributes } = progress;

  return (
    <div className="app-screen">
      <header style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)', fontWeight: 600 }}>冒險者檔案 Profile</p>
          <h2 style={{ fontSize: '1.8rem' }}>{player.displayName}</h2>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ display: 'inline-block', background: 'var(--accent-light)', color: 'var(--accent-strong)', padding: '4px 12px', borderRadius: '12px', fontSize: '14px', fontWeight: 'bold' }}>{progress.playerTier} 級玩家</span>
        </div>
      </header>

      <div className="stat-grid" style={{ marginBottom: '20px' }}>
        <div className="stat-box">
          <small>金幣 Gold</small>
          <strong>💰 {wallet.gold || 0}</strong>
        </div>
        <div className="stat-box">
          <small>鑽石 Diamond</small>
          <strong>💎 {wallet.diamond || 0}</strong>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: '16px', fontSize: '1.2rem', display: 'flex', justifyContent: 'space-between' }}>
          <span>角色狀態 Status</span>
        </h3>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--glass-border)' }}>
          <span style={{ color: 'var(--muted)' }}>職業 (Class)</span>
          <strong>{progress.job || "Novice"}</strong>
        </div>
        
        <div style={{ display: 'flex', gap: '20px', marginBottom: '16px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' }}>
              <span>Base Lv.{progress.level}</span>
              <span>{progress.exp} EXP</span>
            </div>
            <div style={{ height: '6px', background: 'var(--surface-hover)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `100%`, background: 'var(--accent)' }}></div>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' }}>
              <span>Job Lv.{progress.jobLevel}</span>
            </div>
            <div style={{ height: '6px', background: 'var(--surface-hover)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `100%`, background: 'var(--accent)' }}></div>
            </div>
          </div>
        </div>

        <div style={{ background: 'var(--surface-hover)', padding: '16px', borderRadius: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h4 style={{ margin: 0, fontSize: '14px' }}>屬性配點 (Attributes)</h4>
            <span style={{ fontSize: '12px', background: 'var(--accent-strong)', color: '#fff', padding: '2px 8px', borderRadius: '10px' }}>剩餘屬性點: {progress.statusPoints}</span>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>STR</span> <strong>{attributes.str}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>INT</span> <strong>{attributes.int}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>AGI</span> <strong>{attributes.agi}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>DEX</span> <strong>{attributes.dex}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>VIT</span> <strong>{attributes.vit}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>LUK</span> <strong>{attributes.luk}</strong></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InventoryTab() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.getInventory().then(setData).catch(console.error);
  }, []);

  if (!data) return <div className="app-screen">Loading Inventory...</div>;

  const { inventory } = data;

  if (!inventory || inventory.length === 0) {
    return (
      <div className="app-screen">
        <h2 style={{ marginBottom: '24px' }}>背包 Inventory</h2>
        <div style={{ textAlign: 'center', color: 'var(--muted)', marginTop: '40px' }}>背包空空如也...</div>
      </div>
    );
  }

  return (
    <div className="app-screen">
      <h2 style={{ marginBottom: '24px' }}>背包 Inventory</h2>
      {inventory.map((item, idx) => (
        <div key={idx} className="list-item">
          <div>
            <h4 style={{ margin: 0, fontSize: '15px', color: item.itemType === 'consumable' ? 'var(--success)' : 'inherit' }}>
              {item.imageUrl && <img src={getAssetUrl(item.imageUrl)} alt="" style={{ height: '1.2em', vertical-align: 'middle', marginRight: '6px' }} />}
              {item.itemName}
            </h4>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{item.itemType}</span>
          </div>
          <button className="btn" style={{ width: 'auto', padding: '4px 12px', fontSize: '12px', marginLeft: '12px' }}>操作</button>
        </div>
      ))}
    </div>
  );
}

function CombatTab() {
  const [battleState, setBattleState] = useState(null);
  const [isBattling, setIsBattling] = useState(false);
  const [zones, setZones] = useState([]);
  const logsEndRef = React.useRef(null);

  const fetchZones = () => {
    api.getCombatZones().then(setZones).catch(console.error);
  };

  useEffect(() => {
    fetchZones();
    const timer = setInterval(fetchZones, 5000);
    return () => clearInterval(timer);
  }, []);

  const startBattle = async (zone) => {
    try {
      setIsBattling(true);
      setBattleState({ logs: ["⚔️ 正在前往戰區..."], visibleLogs: ["⚔️ 正在前往戰區..."] });
      const result = await api.quickBattle(zone);
      
      const logs = result.logs;
      setBattleState({ ...result, visibleLogs: [] });
      let currentIdx = 0;
      
      const interval = setInterval(() => {
        try {
          if (currentIdx < logs.length) {
            const nextLog = logs[currentIdx];
            setBattleState(prev => {
              if (!prev) return prev;
              const newVisible = [...(prev.visibleLogs || [])];
              if (typeof nextLog === 'string') newVisible.push(nextLog);
              return { ...prev, visibleLogs: newVisible };
            });
            currentIdx++;
            setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
          } else {
            clearInterval(interval);
            setIsBattling(false);
            setBattleState(prev => {
              if (!prev) return prev;
              return { ...prev, showResults: true };
            });
            setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
          }
        } catch (err) {
          console.error("Battle log interval error:", err);
          clearInterval(interval);
          setIsBattling(false);
        }
      }, 700);
      
      fetchZones(); // Update zones immediately after start
    } catch (err) {
      console.error("Combat API Error:", err);
      setBattleState(prev => ({
        ...(prev || {}),
        showResults: true,
        outcome: 'error',
        rewardLines: ["⚠️ 出戰發生錯誤：", String(err.message || "未知原因")]
      }));
      setIsBattling(false);
    }
  };

  const renderLog = (text) => {
    if (!text || typeof text !== 'string') return null;
    const parts = text.split('\n');
    return parts.map((line, idx) => {
      if (!line) return <br key={idx} />;
      let formatted = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      // 處理表情符號
      formatted = formatted.replace(/<a?:(\w+):(\d+)>/g, (match, name, id) => {
        return `<img src="https://cdn.discordapp.com/emojis/${id}.png" alt="${name}" class="battle-emoji" />`;
      });
      // 處理提到 (@)
      formatted = formatted.replace(/\[@(.*?)\]/g, '<span class="mention">@$1</span>');
      
      return <div key={idx} dangerouslySetInnerHTML={{ __html: formatted }} style={{ marginBottom: '4px' }} />;
    });
  };

  const getZoneData = (key) => zones.find(z => z.zone === key) || {};

  return (
    <div className="app-screen" style={{ position: 'relative', height: '100%' }}>
      <h2 style={{ marginBottom: '16px' }}>戰鬥區 Combat</h2>
      <p style={{ color: 'var(--muted)', fontSize: '13px', marginBottom: '20px', lineHeight: 1.5 }}>
        選擇你想挑戰的地圖區域。隨著等級提升，可以解鎖更強大的區域。
      </p>

      {[ 
        { key: 'normal', name: '新手區', lv: 'Lv.1 ~ 10', desc: '適合初學者的史萊姆與小型怪物出沒區域。', color: 'var(--success)' },
        { key: 'mid',    name: '次級區', lv: 'Lv.11 ~ 30', desc: '更危險的怪物巢穴，建議準備好裝備再前往。', color: 'var(--warn)' }
      ].map(z => {
        const data = getZoneData(z.key);
        const hpPercent = data.maxHp > 0 ? (data.currentHp / data.maxHp) * 100 : 0;
        
        return (
          <div key={z.key} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '16px', borderColor: `${z.color}44`, backgroundImage: `linear-gradient(to bottom right, ${z.color}08, transparent)` }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '1.3rem', color: z.color }}>
                  {data.monsterImageUrl && <img src={getAssetUrl(data.monsterImageUrl)} alt="" style={{ height: '1.2em', vertical-align: 'middle', marginRight: '8px' }} />}
                  {z.name}
                </h3>
                <span style={{ fontSize: '11px', background: 'var(--surface-hover)', padding: '2px 8px', borderRadius: '4px', color:'var(--muted)' }}>{z.lv}</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>{z.desc}</p>
            </div>

            {data.monsterName && (
              <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                  <span style={{ fontWeight: 'bold', color: '#fff' }}>👾 {data.monsterName}</span>
                  <span style={{ color: 'var(--muted)' }}>{data.currentHp} / {data.maxHp} HP</span>
                </div>
                <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${hpPercent}%`, background: hpPercent > 30 ? z.color : '#e74c3c', transition: 'width 0.5s ease' }}></div>
                </div>
                <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '6px', textAlign: 'right' }}>
                   {data.participantCount} 人正在參與戰鬥
                </div>
              </div>
            )}

            <button className="btn" disabled={isBattling} onClick={() => startBattle(z.key)} style={{ borderColor: z.color, color: z.color }}>
              {isBattling ? '戰鬥準備中...' : '進入該區域出戰'}
            </button>
          </div>
        );
      })}

      {/* 戰鬥小窗彈出層 */}
      {battleState && (
        <div className="modal-overlay" onClick={(e) => {
          if (e.target === e.currentTarget && !isBattling) setBattleState(null);
        }}>
          <div className="modal-content">
            <div className="modal-header">
              <h3 style={{ fontSize: '1.1rem' }}>⚔️ 戰鬥紀錄</h3>
              <button 
                onClick={() => setBattleState(null)}
                style={{ background: 'var(--surface-hover)', border: 'none', color: '#fff', width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >✕</button>
            </div>
            
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {(battleState.visibleLogs || []).map((log, idx) => (
                   <div key={idx} style={{ 
                     background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '12px', 
                     lineHeight: 1.5, borderLeft: '3px solid var(--accent)', fontSize: '13px'
                   }}>
                     {renderLog(log)}
                   </div>
                ))}
                
                {battleState.showResults && (
                  <div style={{ 
                    padding: '20px', marginTop: '10px',
                    background: battleState.outcome === 'win' ? 'rgba(241, 196, 15, 0.08)' : 'rgba(231, 76, 60, 0.08)', 
                    border: `1px solid ${battleState.outcome === 'win' ? 'rgba(241, 196, 15, 0.3)' : 'rgba(231, 76, 60, 0.3)'}`, 
                    borderRadius: '16px', textAlign: 'center'
                  }}>
                    <h4 style={{ color: battleState.outcome === 'win' ? '#f1c40f' : '#e74c3c', margin: '0 0 12px 0', fontSize: '1.2rem' }}>
                      {battleState.outcome === 'win' ? '🏆 戰鬥勝利！' : 
                       battleState.outcome === 'error' ? '❌ 系統異常' :
                       battleState.outcome === 'lose' ? '💀 戰鬥失敗' : '⏸️ 戰略撤退'}
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {Array.isArray(battleState.rewardLines) && battleState.rewardLines.map((line, i) => {
                        if (typeof line !== 'string') return null;
                        return (
                          <div key={i} style={{ fontSize: '13px', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                        );
                      })}
                    </div>
                    {!isBattling && (
                      <button className="btn btn-primary" onClick={() => setBattleState(null)} style={{ marginTop: '20px', width: '100%', padding: '10px' }}>
                        完成並關閉
                      </button>
                    )}
                  </div>
                )}
                <div ref={logsEndRef} style={{ height: '20px' }} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ShopTab() {
  const [items, setItems] = useState(null);
  const [wallet, setWallet] = useState(null);

  const loadData = () => {
    Promise.all([
      api.getShopItems(),
      api.getProfile()
    ]).then(([shopItems, profile]) => {
      setItems(shopItems);
      setWallet(profile.wallet);
    }).catch(console.error);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleBuy = async (item) => {
    if (!wallet || wallet.gold < item.price) {
      alert("金幣不足！");
      return;
    }
    try {
      if (confirm(`確定要花費 ${item.price} 金幣購買 ${item.name} 嗎？`)) {
        await api.buyShopItem(item.id);
        alert(`成功購買 ${item.name}!`);
        loadData(); // Refresh list and wallet
      }
    } catch (err) {
      alert("購買失敗: " + err.message);
    }
  };

  if (!items) return <div className="app-screen" style={{display:'flex',justifyContent:'center',alignItems:'center'}}>Loading Shop...</div>;

  return (
    <div className="app-screen" style={{ paddingBottom: 'calc(var(--nav-height) + 16px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ margin: 0 }}>商店 Market</h2>
        {wallet && <div style={{ background: 'rgba(241, 196, 15, 0.2)', color: '#f1c40f', padding: '4px 12px', borderRadius: '12px', fontSize: '14px', fontWeight: 'bold' }}>💰 {wallet.gold}</div>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {items.length === 0 ? <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px 0' }}>目前沒有販售任何商品，請稍後再來。</p> : null}
        
        {items.map(item => (
          <div key={item.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <div style={{ width: '40px', height: '40px', background: 'var(--surface-hover)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', overflow: 'hidden' }}>
                {item.imageUrl ? <img src={getAssetUrl(item.imageUrl)} alt="" style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : '📦'}
              </div>
              <div>
                <h4 style={{ margin: 0, fontSize: '15px' }}>{item.name} <span style={{fontSize:'12px', color:'var(--muted)', fontWeight:'normal'}}>Lv.{item.reqLevel || 1}</span></h4>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)' }}>
                  {item.itemType} {item.equipSlot ? `(${item.equipSlot})` : ''} 
                  {item.rating > 0 ? ` - ⭐${item.rating}` : ''}
                </p>
                <div style={{ fontSize: '11px', color: 'var(--success)', marginTop: '4px' }}>
                  {item.effect?.type === 'heal' ? `恢復 ${item.effect.value} HP` : 
                   item.equipStats ? `提供額外裝備屬性加成` : '遊戲消耗品'}
                </div>
              </div>
            </div>
            <button className="btn" onClick={() => handleBuy(item)} style={{ width: 'auto', padding: '6px 16px', borderColor: '#f1c40f', color: '#f1c40f', fontWeight: 'bold' }}>
              💰 {item.price}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatTab() {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [myDisplayName, setMyDisplayName] = useState('');
  const messagesEndRef = React.useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    // 從第一頁載入的時候去拿 Profile，因為這裡沒有全域狀態，我們偷懶再拿一次
    api.getProfile().then(data => {
      setMyDisplayName(data.player.displayName);
    }).catch(() => {});

    // 1. 取得歷史紀錄
    api.getChatHistory().then(history => {
      const formatted = history.map(m => {
        // 如果是機器人轉發 Web 的訊息，檢查是否是我發的
        let isMe = false;
        let text = m.content;
        let author = m.author;
        
        if (m.isBot && text.startsWith("[Web] **")) {
          const match = text.match(/\[Web\] \*\*([\s\S]+?)\*\*: ([\s\S]+)/);
          if (match) {
            author = match[1];
            text = match[2];
            // 這裡還不知道 myDisplayName，所以晚點渲染時判斷
          }
        }
        
          return {
            id: m.id,
            text: text,
            originalText: m.content,
            author: author,
            avatar: m.avatar,
            time: new Date(m.timestamp).toLocaleTimeString()
          };
        });
      setMessages(formatted);
      setTimeout(scrollToBottom, 100);
    }).catch(console.error);

    // 2. 建立 SSE 直播連線
    const eventSource = api.createChatStream((newMsg) => {
      setMessages(prev => {
        // 去重
        if (prev.some(m => m.id === newMsg.id)) return prev;
        
        let text = newMsg.content;
        let author = newMsg.author;
        
        if (newMsg.isBot && text.startsWith("[Web] **")) {
          const match = text.match(/\[Web\] \*\*([\s\S]+?)\*\*: ([\s\S]+)/);
          if (match) {
            author = match[1];
            text = match[2];
          }
        }

        return [...prev, {
          id: newMsg.id,
          text: text,
          originalText: newMsg.content,
          author: author,
          avatar: newMsg.avatar,
          time: new Date(newMsg.timestamp).toLocaleTimeString()
        }];
      });
      setTimeout(scrollToBottom, 100);
    });

    return () => {
      eventSource.close();
    };
  }, []);

  const handleSend = async () => {
    if (!message.trim()) return;
    try {
      await api.sendChatMessage(message);
      // Optimistic upate (沒 id 會被下一次 SSE 蓋掉或追加，這裡先不推入去重靠服務端，但為了流暢我們先推)
      setMessages(prev => [...prev, {
        id: "temp-" + Date.now(),
        text: message,
        author: myDisplayName || "Me",
        time: new Date().toLocaleTimeString()
      }]);
      setMessage('');
      setTimeout(scrollToBottom, 50);
    } catch (err) {
      alert("發送失敗: " + err.message);
    }
  };

  return (
    <div className="app-screen" style={{ height: '100%', paddingBottom: '16px' }}>
      <header style={{ flexShrink: 0, marginBottom: '8px' }}>
        <h2 style={{ margin: 0, fontSize: '1.4rem' }}>城鎮大廳 Chat Lobby</h2>
        <p style={{ color: 'var(--muted)', fontSize: '12px', margin: '4px 0' }}>發送對話至 Discord 城鎮頻道</p>
      </header>

      <div style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: '16px', padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: 'inset 0 0 20px rgba(0,0,0,0.2)' }}>
        <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '11px', marginBottom: '8px' }}>--- 歷史紀錄 ---</div>
        
        {messages.map((m, idx) => {
          const isMe = m.author === myDisplayName || m.author === "Me";
          
          // 解析 Discord 表情符號與提到
          let parsedText = m.text.replace(/<a?:(\w+):(\d+)>/g, (match, name, id) => {
             const isAnimated = match.startsWith('<a:');
             return `<img src="https://cdn.discordapp.com/emojis/${id}.${isAnimated ? 'gif' : 'png'}" alt=":${name}:" class="chat-emoji" />`;
          });
          parsedText = parsedText.replace(/\[@(.*?)\]/g, '<span class="mention">@$1</span>');

          return (
            <div key={m.id || idx} style={{ display: 'flex', gap: '10px', alignSelf: isMe ? 'flex-end' : 'flex-start', flexDirection: isMe ? 'row-reverse' : 'row' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: isMe ? 'var(--accent)' : 'var(--surface-hover)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold', overflow: 'hidden', border: '1px solid var(--glass-border)' }}>
                {m.avatar ? <img src={m.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : m.author.substring(0, 2).toUpperCase()}
              </div>
              <div style={{ alignItems: isMe ? 'flex-end' : 'flex-start', display: 'flex', flexDirection: 'column', maxWidth: '85%' }}>
                <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {!isMe && <span style={{ fontWeight: 'bold', color: 'var(--accent-light)' }}>{m.author}</span>}
                  <span>{m.time}</span>
                </div>
                <div 
                  style={{ 
                    background: isMe ? 'var(--accent-strong)' : 'var(--surface-hover)', 
                    color: '#fff', 
                    padding: '10px 14px', 
                    borderRadius: isMe ? '16px 0 16px 16px' : '0 16px 16px 16px', 
                    fontSize: '14px', 
                    wordBreak: 'break-word', 
                    whiteSpace: 'pre-line',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                    lineHeight: 1.5,
                    border: '1px solid var(--glass-border)'
                  }}
                  dangerouslySetInnerHTML={{ __html: parsedText }}
                />
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexShrink: 0 }}>
        <input 
          type="text" 
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="發送訊息至 Discord..." 
          style={{ flex: 1, padding: '12px', borderRadius: '12px', background: 'var(--bg)', border: '1px solid var(--line)', color: '#fff' }} 
        />
        <button className="btn btn-primary" onClick={handleSend} style={{ width: 'auto', padding: '0 20px' }}>送出</button>
      </div>
    </div>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState('profile');
  const [isInitializing, setIsInitializing] = useState(true);

  // Check URL for ?code= (Discord OAuth Callback)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const authCode = urlParams.get('code');

    if (authCode) {
      api.loginWithDiscord(authCode).then(data => {
        setToken(data.token);
        // Clear url bar
        window.history.replaceState({}, document.title, "/");
        setIsAuthenticated(true);
        setIsInitializing(false);
      }).catch(err => {
        console.error("Login failed", err);
        alert("登入失敗！請確認有啟動後端 API 伺服器 (npm start)：\n" + err.message);
        window.history.replaceState({}, document.title, "/");
        setIsInitializing(false);
      });
    } else {
      if (localStorage.getItem("player_token")) {
        setIsAuthenticated(true);
      }
      setIsInitializing(false);
    }
  }, []);

  if (isInitializing) return <div className="app-screen">Loading...</div>;

  if (!isAuthenticated) return <LoginScreen />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'profile' && <ProfileTab />}
        {activeTab === 'inventory' && <InventoryTab />}
        {activeTab === 'combat' && <CombatTab />}
        {activeTab === 'shop' && <ShopTab />}
        {activeTab === 'chat' && <ChatTab />}
      </div>

      <nav className="bottom-nav">
        <div className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveTab('profile')}>
          <Icons.User />
          <span>角色</span>
        </div>
        <div className={`nav-item ${activeTab === 'combat' ? 'active' : ''}`} onClick={() => setActiveTab('combat')}>
          <Icons.Swords />
          <span>戰鬥</span>
        </div>
        <div className={`nav-item ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => setActiveTab('chat')}>
          <Icons.Chat />
          <span>大廳</span>
        </div>
        <div className={`nav-item ${activeTab === 'inventory' ? 'active' : ''}`} onClick={() => setActiveTab('inventory')}>
          <Icons.Backpack />
          <span>背包</span>
        </div>
        <div className={`nav-item ${activeTab === 'shop' ? 'active' : ''}`} onClick={() => setActiveTab('shop')}>
          <Icons.Store />
          <span>商店</span>
        </div>
      </nav>
    </div>
  );
}
