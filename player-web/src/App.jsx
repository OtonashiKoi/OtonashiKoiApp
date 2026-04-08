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

const calcPlayerStats = (attrs = {}, equipped = {}) => {
  const { str = 1, agi = 1, vit = 1, int: INT = 1, dex = 1, luk = 1 } = attrs;
  const bonus = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
  
  Object.values(equipped).forEach(item => {
    if (item?.equipStats) {
      Object.entries(item.equipStats).forEach(([k, v]) => {
        if (k in bonus) bonus[k] += (v || 0);
      });
    }
  });

  const S = str + bonus.str;
  const A = agi + bonus.agi;
  const V = vit + bonus.vit;
  const I = INT + bonus.int;
  const D = dex + bonus.dex;
  const L = luk + bonus.luk;

  const weapon = equipped.weapon || null;
  const offhand = equipped.shield || null;
  const OFFHAND_WEAPON_TYPES = new Set(["offhand_sword", "offhand_dagger", "offhand_mace"]);
  const isDualWield = weapon && !weapon.isTwoHanded && offhand?.weaponType != null && OFFHAND_WEAPON_TYPES.has(offhand.weaponType);
  
  const WEAPON_CONFIG = {
    dagger:   { mult: 2, comboBonus: 20 },
    axe_2h:   { mult: 4 },
    staff_1h: { mult: 4, monsterAtk: 2, absoluteHit: true },
    staff_2h: { mult: 5, monsterAtk: 2, absoluteHit: true },
  };

  const wt = weapon?.weaponType;
  const cfg = WEAPON_CONFIG[wt] || {};
  const mult = isDualWield ? 2 : (cfg.mult ?? 3);
  
  const baseStat = (wt === "staff_1h" || wt === "staff_2h") ? I : (wt === "bow" ? D : S);

  return {
    maxHp: V * 15 + 50,
    atk: Math.round(baseStat * mult),
    def: V,
    dodge: Math.min(50, A * 0.5),
    hit: Math.min(100, 80 + D),
    crit: Math.min(100, L * 0.3),
    combo: Math.min(80, 3 + A * 0.3 + (cfg.comboBonus ?? 0))
  };
};

function ProfileTab() {
  const [data, setData] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [swappingSlot, setSwappingSlot] = useState(null); // { slotKey, label }

  const loadAll = () => {
    Promise.all([
      api.getProfile(),
      api.getInventory()
    ]).then(([profile, inv]) => {
      setData(profile);
      setInventory(inv.inventory || []);
    }).catch(console.error);
  };

  useEffect(() => {
    loadAll();
    const handleEsc = (e) => e.key === 'Escape' && setSwappingSlot(null);
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  if (!data) return <div className="app-screen" style={{display:'flex',justifyContent:'center',alignItems:'center'}}>Loading Profile...</div>;

  const { player, wallet, progress } = data;
  const { attributes, equipment = {} } = progress;
  const stats = calcPlayerStats(attributes, equipment);

  const handleEquip = async (itemUuid) => {
    try {
      await api.equipItem(itemUuid);
      setSwappingSlot(null);
      loadAll();
    } catch (err) {
      alert("更換裝備失敗: " + err.message);
    }
  };

  const handleUnequip = async (slotKey) => {
    const item = equipment[slotKey];
    if (!item) return;
    try {
      await api.unequipItem(slotKey);
      loadAll();
    } catch (err) {
      alert("脫下裝備失敗: " + err.message);
    }
  };

  const slots = [
    { key: 'head_top', label: '頭上', icon: '👒' },
    { key: 'head_mid', label: '頭中', icon: '🕶️' },
    { key: 'head_low', label: '頭下', icon: '🧣' },
    { key: 'armor', label: '衣服', icon: '👕' },
    { key: 'weapon', label: '主武器', icon: '⚔️' },
    { key: 'shield', label: '副手', icon: '🛡️' },
    { key: 'garment', label: '披肩', icon: '🧥' },
    { key: 'shoes', label: '鞋子', icon: '👞' },
    { key: 'accessory_l', label: '左飾品', icon: '💍' },
    { key: 'accessory_r', label: '右飾品', icon: '💍' },
  ];

  return (
    <div className="app-screen" style={{ position: 'relative' }}>
      <header style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)', fontWeight: 600 }}>冒險者檔案 Profile</p>
          <h2 style={{ fontSize: '1.8rem' }}>{player.displayName}</h2>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ display: 'inline-block', background: 'var(--accent-light)', color: 'var(--accent-strong)', padding: '4px 12px', borderRadius: '12px', fontSize: '14px', fontWeight: 'bold' }}>{progress.playerTier} 級玩家</span>
        </div>
      </header>

      {/* 錢包 */}
      <div className="stat-grid" style={{ marginBottom: '16px' }}>
        <div className="stat-box">
          <small>金幣 GOLD</small>
          <strong>💰 {wallet.gold || 0}</strong>
        </div>
        <div className="stat-box">
          <small>鑽石 DIAMOND</small>
          <strong>💎 {wallet.diamond || 0}</strong>
        </div>
      </div>

      {/* 裝備欄 (Grid 佈局) - 改為更緊湊的 2 列佈局 */}
      <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: 'var(--muted)' }}>裝備欄位 (Equipment)</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
          {slots.map(s => {
            const item = equipment[s.key];
            return (
                <div 
                  key={s.key} 
                  onClick={() => setSwappingSlot(s)}
                  style={{ 
                    aspectRatio: '1', 
                    background: item ? 'var(--surface-hover)' : 'rgba(255,255,255,0.03)', 
                    borderRadius: '12px', 
                    border: item ? '1.5px solid var(--accent)' : '1px dashed var(--glass-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '2px',
                    cursor: 'pointer',
                    position: 'relative',
                    overflow: 'hidden',
                    transition: 'all 0.2s ease',
                    boxShadow: item ? '0 0 10px rgba(168, 85, 247, 0.2)' : 'none'
                  }}
                  className="equip-slot-card"
                >
                  {item ? (
                    <>
                      <div style={{ width: '100%', height: '100%', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {item.imageUrl ? (
                          <img src={getAssetUrl(item.imageUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        ) : (
                          <div style={{ fontSize: '11px', textAlign: 'center', color: '#fff', fontWeight: 'bold', padding: '4px', wordBreak: 'break-all' }}>
                            {item.itemName}
                          </div>
                        )}
                      </div>
                      {item.imageUrl && (
                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: '8px', padding: '2px 4px', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.itemName}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: '18px', opacity: 0.2 }}>{s.icon}</span>
                      <span style={{ fontSize: '9px', color: 'var(--muted)', textAlign: 'center', opacity: 0.6 }}>{s.label}</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 戰鬥數值 */}
        <div className="card" style={{ padding: '16px' }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
            <span>戰鬥能力 (Combat)</span>
            <span style={{ fontSize: '12px', color: 'var(--accent)' }}>{progress.job || "Novice"}</span>
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)', paddingBottom: '4px' }}>
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>HP</span>
              <strong style={{ color: 'var(--success)' }}>{stats.maxHp}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)', paddingBottom: '4px' }}>
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>ATK</span>
              <strong style={{ color: '#e67e22' }}>{stats.atk}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)', paddingBottom: '4px' }}>
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>DEF</span>
              <strong style={{ color: '#3498db' }}>{stats.def}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)', paddingBottom: '4px' }}>
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>HIT</span>
              <strong>{stats.hit}%</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)', paddingBottom: '4px' }}>
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>DODGE</span>
              <strong>{stats.dodge}%</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)', paddingBottom: '4px' }}>
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>CRIT</span>
              <strong>{stats.crit}%</strong>
            </div>
          </div>
        </div>

      {/* 基礎屬性 */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h4 style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>屬性配點 (Attributes)</h4>
          <span style={{ fontSize: '12px', background: 'var(--accent-strong)', color: '#fff', padding: '2px 8px', borderRadius: '10px' }}>剩餘點數: {progress.statusPoints}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px 16px', fontSize: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: '8px' }}><span style={{ color: 'var(--muted)' }}>STR</span> <strong>{attributes.str}</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: '8px' }}><span style={{ color: 'var(--muted)' }}>INT</span> <strong>{attributes.int}</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: '8px' }}><span style={{ color: 'var(--muted)' }}>AGI</span> <strong>{attributes.agi}</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: '8px' }}><span style={{ color: 'var(--muted)' }}>DEX</span> <strong>{attributes.dex}</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: '8px' }}><span style={{ color: 'var(--muted)' }}>VIT</span> <strong>{attributes.vit}</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: '8px' }}><span style={{ color: 'var(--muted)' }}>LUK</span> <strong>{attributes.luk}</strong></div>
        </div>
      </div>

      {/* 快速更換裝備 Modal */}
      {swappingSlot && (
        <div className="modal-overlay" onClick={() => setSwappingSlot(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '90%', maxWidth: '360px', borderRadius: '24px', padding: '20px' }}>
            <div className="modal-header" style={{ marginBottom: '20px' }}>
              <div>
                <h3 style={{ margin: 0 }}>部位操作：{swappingSlot.label}</h3>
                {equipment[swappingSlot.key] && <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--accent)' }}>目前裝備: {equipment[swappingSlot.key].itemName}</p>}
              </div>
              <button className="close-btn" onClick={() => setSwappingSlot(null)}>&times;</button>
            </div>

            <div className="modal-body" style={{ maxHeight: '450px', overflowY: 'auto' }}>
              {/* 卸下按鈕區 */}
              {equipment[swappingSlot.key] && (
                <div style={{ marginBottom: '20px', padding: '16px', background: 'rgba(255,0,0,0.05)', borderRadius: '16px', border: '1px solid rgba(255,0,0,0.1)' }}>
                  <p style={{ margin: '0 0 12px 0', fontSize: '13px', textAlign: 'center', color: 'var(--muted)' }}>想要卸下此裝備嗎？</p>
                  <button 
                    className="btn" 
                    onClick={() => handleUnequip(swappingSlot.key)}
                    style={{ borderColor: '#ff4d4f', color: '#ff4d4f', width: '100%', borderRadius: '12px', fontWeight: 'bold' }}
                  >
                    卸下目前裝備
                  </button>
                </div>
              )}
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', color: 'var(--muted)' }}>可更換的裝備 (Inventory)</h4>
                {inventory && inventory
                  .filter(item => item.itemType === 'equipment' && item.equipSlot === swappingSlot.key && !item.isEquipped)
                  .map(item => (
                    <div 
                      key={item.uuid} 
                      className="card" 
                      onClick={() => handleEquip(item.uuid)}
                      style={{ cursor: 'pointer', display: 'flex', gap: '12px', alignItems: 'center', padding: '12px', border: '1px solid var(--glass-border)', transition: 'transform 0.1s' }}
                    >
                      <div style={{ width: '48px', height: '48px', background: 'var(--surface-hover)', borderRadius: '10px', overflow: 'hidden', flexShrink: 0 }}>
                        {item.imageUrl ? <img src={getAssetUrl(item.imageUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '📦'}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{item.itemName}</div>
                        <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                          {item.equipStats ? Object.entries(item.equipStats).map(([k, v]) => `${k.toUpperCase()}+${v}`).join(', ') : '無額外加成'}
                        </div>
                      </div>
                    </div>
                  ))
                }
                {( !inventory || inventory.filter(item => item.itemType === 'equipment' && item.equipSlot === swappingSlot.key && !item.isEquipped).length === 0) && (
                  <div style={{ textAlign: 'center', padding: '20px 0', background: 'rgba(255,255,255,0.02)', borderRadius: '16px' }}>
                    <p style={{ color: 'var(--muted)', fontSize: '13px' }}>📭 背包裡沒有其他可替換的道具</p>
                    <button 
                      className="btn" 
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('changeTab', { detail: 'inventory' }));
                        setSwappingSlot(null);
                      }} 
                      style={{ marginTop: '12px', width: 'auto', padding: '6px 16px', fontSize: '12px' }}
                    >
                      前往背包查看全部
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InventoryTab() {
  const [inventory, setInventory] = useState(null);
  const [category, setCategory] = useState('all');
  const [activeItem, setActiveItem] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);

  const loadInventory = () => {
    api.getInventory().then(data => setInventory(data.inventory || [])).catch(console.error);
  };

  useEffect(() => {
    loadInventory();
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        setActiveItem(null);
        setPreviewImage(null);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  if (inventory === null) return <div className="app-screen">Loading Inventory...</div>;

  const handleUse = async (item) => {
    try {
      const res = await api.useItem(item.uuid);
      alert(`使用了 ${res.itemName}！${res.effectDesc || ''}`);
      setActiveItem(null);
      loadInventory();
    } catch (err) {
      alert("使用失敗: " + err.message);
    }
  };

  const handleDiscard = async (item) => {
    if (!confirm(`確定要永久丟棄 ${item.itemName} 嗎？此操作不可恢復。`)) return;
    try {
      await api.discardItem(item.uuid);
      alert(`已丟棄 ${item.itemName}`);
      setActiveItem(null);
      loadInventory();
    } catch (err) {
      alert("丟棄失敗: " + err.message);
    }
  };

  const handleEquip = async (item) => {
    try {
      await api.equipItem(item.uuid);
      alert(`已裝備 ${item.itemName}`);
      setActiveItem(null);
      loadInventory();
    } catch (err) {
      alert("裝備失敗: " + err.message);
    }
  };

  const filtered = inventory.filter(item => {
    if (category === 'all') return true;
    return item.itemType === category;
  });

  const categories = [
    { key: 'all', label: '全部' },
    { key: 'equipment', label: '裝備' },
    { key: 'consumable', label: '消耗品' },
    { key: 'collectible', label: '收藏品' }
  ];

  return (
    <div className="app-screen" style={{ position: 'relative' }}>
      <h2 style={{ marginBottom: '16px' }}>背包 Inventory</h2>
      
      <div className="filter-bar" style={{ display: 'flex', gap: '8px', marginBottom: '16px', overflowX: 'auto' }}>
        {categories.map(c => (
          <div 
            key={c.key} 
            className={`filter-pill ${category === c.key ? 'active' : ''}`}
            onClick={() => setCategory(c.key)}
            style={{ padding: '6px 12px', borderRadius: '20px', background: category === c.key ? 'var(--accent)' : 'var(--surface-hover)', cursor: 'pointer', fontSize: '12px' }}
          >
            {c.label}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', marginTop: '40px' }}>此分類下暫無物品</div>
        ) : (
          filtered.map((item) => (
            <div key={item.uuid} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setActiveItem(item)}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div style={{ width: '40px', height: '40px', background: 'var(--surface-hover)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', overflow: 'hidden' }}>
                  {item.imageUrl ? <img src={getAssetUrl(item.imageUrl)} alt="" style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : '📦'}
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '15px' }}>
                    {item.isEquipped && <span style={{ color: 'var(--accent)', marginRight: '4px' }}>[已裝備]</span>}
                    {item.itemName}
                  </h4>
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--muted)' }}>
                    {item.itemType === 'equipment' ? '裝備' : 
                     item.itemType === 'consumable' ? '消耗品' : 
                     item.itemType === 'collectible' ? '收藏品' : item.itemType}
                  </p>
                </div>
              </div>
              <button className="btn" style={{ width: 'auto', padding: '4px 12px', fontSize: '12px' }}>操作</button>
            </div>
          ))
        )}
      </div>

      {activeItem && (
        <div className="modal-overlay" onClick={() => setActiveItem(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '320px' }}>
            <div className="modal-header">
              <h3>{activeItem.itemName}</h3>
              <button className="close-btn" onClick={() => setActiveItem(null)}>&times;</button>
            </div>
            <div className="modal-body" style={{ textAlign: 'center' }}>
              <div style={{ padding: '20px 0' }}>
                <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '16px' }}>{activeItem.itemDescription || '無詳細描述'}</div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {activeItem.itemType === 'consumable' && (
                    <button className="btn" onClick={() => handleUse(activeItem)} style={{ background: 'var(--success)', borderColor: 'var(--success)' }}>使用</button>
                  )}
                  {activeItem.itemType === 'collectible' && activeItem.imageUrl && (
                    <button className="btn" onClick={() => setPreviewImage(getAssetUrl(activeItem.imageUrl))}>檢視圖片</button>
                  )}
                  <button className="btn" onClick={() => handleDiscard(activeItem)} style={{ background: 'transparent', borderColor: '#ff4d4d', color: '#ff4d4d' }}>丟棄物品</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 圖片大圖預覽 (點擊背景關閉，長按可儲存) */}
      {previewImage && (
        <div 
          className="modal-overlay" 
          onClick={() => setPreviewImage(null)} 
          style={{ background: 'rgba(0,0,0,0.92)', zIndex: 3000, cursor: 'zoom-out', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <img 
            src={previewImage} 
            alt="Preview" 
            style={{ maxWidth: '95vw', maxHeight: '95vh', borderRadius: '4px', boxShadow: '0 0 50px rgba(0,0,0,0.9)', cursor: 'default' }} 
            onClick={(e) => e.stopPropagation()} /* 防止點擊圖片本身時關閉，解決電腦模式衝突 */
          />
          <div 
            style={{ position: 'absolute', top: '20px', right: '20px', color: '#fff', fontSize: '36px', cursor: 'pointer', textShadow: '0 0 10px rgba(0,0,0,0.5)', zIndex: 10 }}
            onClick={() => setPreviewImage(null)}
          >
            &times;
          </div>
        </div>
      )}
    </div>
  );
}

function CombatTab() {
  const [battleState, setBattleState] = useState(null);
  const [isBattling, setIsBattling] = useState(false);
  const [zones, setZones] = useState([]);
  const logsEndRef = React.useRef(null);

  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') setBattleState(null);
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

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
                  {data.monsterImageUrl && <img src={getAssetUrl(data.monsterImageUrl)} alt="" style={{ height: '1.2em', verticalAlign: 'middle', marginRight: '8px' }} />}
                  {z.name}
                </h3>
                <span style={{ fontSize: '11px', background: 'var(--surface-hover)', padding: '2px 8px', borderRadius: '4px', color:'var(--muted)' }}>{z.lv}</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>{z.desc}</p>
            </div>

            {data.monsterName && (
              <div style={{ 
                background: 'rgba(0,0,0,0.3)', 
                borderRadius: '12px', 
                border: '1px solid var(--glass-border)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column'
              }}>
                <div style={{ display: 'flex', minHeight: '120px' }}>
                  {/* 怪物圖片區 */}
                  <div style={{ 
                    width: '100px', 
                    background: 'rgba(255,255,255,0.03)', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    borderRight: '1px solid var(--glass-border)',
                    position: 'relative'
                  }}>
                    {data.monsterImageUrl ? (
                      <img src={getAssetUrl(data.monsterImageUrl)} alt="" style={{ maxWidth: '85%', maxHeight: '85%', objectFit: 'contain', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.5))' }} />
                    ) : (
                      <span style={{ fontSize: '40px', opacity: 0.3 }}>👾</span>
                    )}
                    <div style={{ 
                      position: 'absolute', top: '4px', left: '4px', 
                      background: 'var(--accent-strong)', color: '#fff', 
                      padding: '1px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold' 
                    }}>
                      Lv.{data.monsterLevel}
                    </div>
                  </div>

                  {/* 怪物首選資訊區 */}
                  <div style={{ flex: 1, padding: '12px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <h4 style={{ margin: 0, fontSize: '15px', color: '#fff' }}>{data.monsterName}</h4>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <span style={{ fontSize: '10px', background: 'rgba(241, 196, 15, 0.1)', color: '#f1c40f', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(241, 196, 15, 0.2)' }}>
                            💰 {data.goldReward}
                          </span>
                          <span style={{ fontSize: '10px', background: 'rgba(52, 152, 219, 0.1)', color: '#3498db', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(52, 152, 219, 0.2)' }}>
                            ⭐ {data.expReward}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                        <span style={{ color: 'var(--muted)' }}>HP 狀態</span>
                        <span style={{ color: hpPercent < 20 ? '#e74c3c' : '#fff', fontWeight: 'bold' }}>{data.currentHp} / {data.maxHp}</span>
                      </div>
                      <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ 
                          height: '100%', 
                          width: `${hpPercent}%`, 
                          background: `linear-gradient(to right, ${hpPercent > 30 ? z.color : '#e74c3c'}, ${hpPercent > 30 ? z.color : '#ff4d4d'})`, 
                          transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                          boxShadow: hpPercent < 20 ? '0 0 10px rgba(231, 76, 60, 0.5)' : 'none'
                        }}></div>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div style={{ 
                  background: 'rgba(255,255,255,0.02)', 
                  padding: '6px 12px', 
                  fontSize: '10px', 
                  color: 'var(--muted)', 
                  textAlign: 'right',
                  borderTop: '1px solid rgba(255,255,255,0.05)'
                }}>
                   ⚡ {data.participantCount} 人正在圍攻此怪物
                </div>
              </div>
            )}

            <button className="btn" disabled={isBattling} onClick={() => startBattle(z.key)} style={{ 
              borderColor: z.color, 
              color: z.color,
              background: isBattling ? 'transparent' : `${z.color}10`,
              fontWeight: 'bold',
              letterSpacing: '1px'
            }}>
              {isBattling ? '戰鬥準備中...' : '⚔️ 進入該區域出戰'}
            </button>
          </div>
        );
      })}

      {/* 戰鬥小窗彈出層 */}
      {battleState && (
        <div className="modal-overlay" onClick={(e) => {
          if (e.target === e.currentTarget && !isBattling) setBattleState(null);
        }} style={{ alignItems: 'flex-start', paddingTop: 'env(safe-area-inset-top, 20px)', paddingBottom: '20px' }}>
          <div className="modal-content" style={{ marginTop: '20px', maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column' }}>
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
  const [category, setCategory] = useState('all'); // 'all', 'equipment', 'consumable', 'collectible'

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
    const currency = item.currency || 'gold';
    const currencyName = currency === 'gold' ? '金幣' : '鑽石';
    const userBalance = wallet ? wallet[currency] : 0;

    if (userBalance < item.price) {
      alert(`${currencyName}不足！`);
      return;
    }
    try {
      if (confirm(`確定要花費 ${item.price} ${currencyName} 購買 ${item.name} 嗎？`)) {
        await api.buyShopItem(item.id);
        alert(`成功購買 ${item.name}!`);
        loadData(); // Refresh list and wallet
      }
    } catch (err) {
      alert("購買失敗: " + err.message);
    }
  };

  if (!items) return <div className="app-screen" style={{display:'flex',justifyContent:'center',alignItems:'center'}}>Loading Shop...</div>;

  const filteredItems = items.filter(item => {
    if (category === 'all') return true;
    return item.itemType === category;
  });

  const categories = [
    { key: 'all', label: '全部' },
    { key: 'equipment', label: '裝備' },
    { key: 'consumable', label: '消耗品' },
    { key: 'collectible', label: '收藏品' }
  ];

  return (
    <div className="app-screen" style={{ paddingBottom: 'calc(var(--nav-height) + 16px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', gap: '8px' }}>
        <h2 style={{ margin: 0, fontSize: '1.6rem' }}>商店 Market</h2>
        {wallet && (
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '6px' }}>
            <div style={{ background: 'rgba(241, 196, 15, 0.15)', color: '#f1c40f', padding: '4px 10px', borderRadius: '10px', fontSize: '13px', fontWeight: 'bold', whiteSpace: 'nowrap', border: '1px solid rgba(241, 196, 15, 0.2)' }}>
              💰 {wallet.gold}
            </div>
            <div style={{ background: 'rgba(52, 152, 219, 0.15)', color: '#3498db', padding: '4px 10px', borderRadius: '10px', fontSize: '13px', fontWeight: 'bold', whiteSpace: 'nowrap', border: '1px solid rgba(52, 152, 219, 0.2)' }}>
              💎 {wallet.diamond}
            </div>
          </div>
        )}
      </div>

      {/* 分類篩選列 */}
      <div className="filter-bar">
        {categories.map(c => (
          <div 
            key={c.key} 
            className={`filter-pill ${category === c.key ? 'active' : ''}`}
            onClick={() => setCategory(c.key)}
          >
            {c.label}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {filteredItems.length === 0 ? <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px 0' }}>目前該分類下沒有商品。</p> : null}
        
        {filteredItems.map(item => {
          const isDiamond = item.currency === 'diamond';
          const currencyColor = isDiamond ? '#3498db' : '#f1c40f';
          
          return (
            <div key={item.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div style={{ width: '40px', height: '40px', background: 'var(--surface-hover)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', overflow: 'hidden' }}>
                  {item.imageUrl ? <img src={getAssetUrl(item.imageUrl)} alt="" style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : '📦'}
                </div>
                <div style={{ flex: 1 }}>
                  <h4 style={{ margin: 0, fontSize: '15px' }}>{item.name} <span style={{fontSize:'12px', color:'var(--muted)', fontWeight:'normal'}}>Lv.{item.reqLevel || 1}</span></h4>
                  <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)' }}>
                    {item.itemType === 'equipment' ? '裝備' : 
                     item.itemType === 'consumable' ? '消耗品' : 
                     item.itemType === 'collectible' ? '收藏品' : item.itemType} 
                    {item.equipSlot ? ` (${item.equipSlot})` : ''} 
                  </p>
                  <div style={{ fontSize: '11px', color: 'var(--success)', marginTop: '4px' }}>
                    {item.effect?.type === 'heal' ? `恢復 ${item.effect.value} HP` : 
                     item.itemType === 'equipment' ? `提供額外裝備屬性加成` : '點擊使用獲得效果'}
                  </div>
                </div>
              </div>
              <button className="btn" onClick={() => handleBuy(item)} style={{ width: 'auto', padding: '6px 16px', borderColor: currencyColor, color: currencyColor, fontWeight: 'bold' }}>
                {isDiamond ? '💎' : '💰'} {item.price}
              </button>
            </div>
          );
        })}
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
