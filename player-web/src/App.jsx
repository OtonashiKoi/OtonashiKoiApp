import React, { useState, useEffect, useRef } from 'react';
import { api, getDiscordLoginUrl, setToken, API_ORIGIN } from './api';
import './index.css';

// SVG Icons
const Icons = {
  Home: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>,
  User: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>,
  Backpack: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10h16M4 14h16M6 6h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>,
  Swords: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 17.5L3 6V3h3l11.5 11.5"></path><path d="M13 19l6-6"></path><path d="M16 16l4 4"></path><path d="M19 21l2-2"></path><path d="M14.5 6.5L18 3h3v3l-3.5 3.5"></path><path d="M5 14l4 4"></path><path d="M7 17l-3 3"></path><path d="M3 19l2 2"></path></svg>,
  Store: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>,
  Chat: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z"></path></svg>,
  Discord: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/></svg>,
  CheckCircle: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>,
  Settings: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>,
  More: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle></svg>,
};

// ===== Discord 登入畫面 =====
function LoginScreen() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      height: '100%', overflowY: 'auto',
      background: 'linear-gradient(175deg, #04060e 0%, #08091a 50%, #060c18 100%)',
      color: '#f0e6d3', textAlign: 'center', padding: '0 0 2rem',
      position: 'relative',
    }}>
      {/* 頂部金線 */}
      <div style={{ width: '100%', height: '1px', background: 'linear-gradient(to right, transparent, rgba(200,169,110,0.6), transparent)', flexShrink: 0 }} />

      {/* 上半：LOGO 區 */}
      <div style={{ padding: '3rem 2rem 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* 裝飾符 */}
        <div style={{
          fontSize: '2.4rem', marginBottom: '1rem', opacity: 0.6,
          color: 'var(--gold)', fontFamily: 'var(--font-display)',
        }}>
          ◈
        </div>

        {/* 社名 */}
        <h1 style={{
          fontSize: '1.6rem', fontWeight: 700, margin: '0 0 0.2rem',
          letterSpacing: '0.12em', lineHeight: 1.3,
          fontFamily: 'var(--font-display)',
          background: 'linear-gradient(135deg, #9a7a2c, #e8c97a, #c8a96e, #e8c97a, #9a7a2c)',
          backgroundSize: '200% auto',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          animation: 'shimmer 4s linear infinite',
        }}>
          音無玄學棋牌社
        </h1>

        <p style={{ fontSize: '10px', color: 'rgba(200,169,110,0.5)', letterSpacing: '0.25em', margin: '0 0 0.5rem', fontFamily: 'var(--font-display)' }}>
          OTONASHI KOI CLUB
        </p>

        {/* 分隔 */}
        <div style={{ width: '80px', height: '1px', background: 'linear-gradient(to right, transparent, var(--gold), transparent)', margin: '1.2rem 0' }} />

        <p style={{ fontSize: '11px', color: 'rgba(200,169,110,0.45)', letterSpacing: '0.2em', margin: '0 0 1.8rem', fontFamily: 'var(--font-display)' }}>
          請相信科學
        </p>

        {/* Discord 登入 */}
        <a href={getDiscordLoginUrl()} style={{
          display: 'inline-flex', alignItems: 'center', gap: '10px',
          padding: '12px 28px',
          background: 'linear-gradient(135deg, #4752c4, #5865F2)',
          color: '#fff', borderRadius: '2px', fontSize: '0.9rem',
          fontWeight: 700, textDecoration: 'none', transition: 'all 0.22s ease',
          boxShadow: '0 4px 20px rgba(88,101,242,0.4)',
          letterSpacing: '0.06em', fontFamily: 'var(--font-display)',
          border: '1px solid rgba(120,140,255,0.3)',
        }}
          onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 28px rgba(88,101,242,0.55)'; }}
          onMouseOut={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(88,101,242,0.4)'; }}
        >
          <Icons.Discord />
          DISCORD 登入
        </a>

        <p style={{ marginTop: '1rem', color: 'rgba(200,169,110,0.2)', fontSize: '10px', letterSpacing: '0.12em', fontFamily: 'var(--font-display)' }}>
          LIMITED TO MEMBERS ONLY
        </p>

        {window.location.hostname === 'localhost' && (
          <button
            onClick={async () => {
              const id = prompt('Dev mock login — 輸入你的 Discord ID：', '1450019975031951370');
              if (!id) return;
              try {
                const data = await api.loginWithDiscord(`mock:${id}`);
                setToken(data.token);
                window.location.reload();
              } catch (err) {
                alert('Mock 登入失敗：' + err.message);
              }
            }}
            style={{
              marginTop: '10px', background: 'transparent',
              border: '1px dashed rgba(200,169,110,0.15)', color: 'rgba(200,169,110,0.3)',
              borderRadius: '2px', padding: '5px 14px',
              fontSize: '10px', cursor: 'pointer', letterSpacing: '0.08em',
            }}
          >
            DEV LOGIN
          </button>
        )}
      </div>

      {/* 分隔金線 */}
      <div style={{ width: '100%', height: '1px', background: 'linear-gradient(to right, transparent, rgba(200,169,110,0.2), transparent)', margin: '0 0 1.5rem' }} />

      {/* 社群規範 */}
      <div style={{ width: '100%', padding: '0 1.5rem', textAlign: 'left' }}>
        <p style={{ textAlign: 'center', fontSize: '9px', color: 'rgba(200,169,110,0.4)', letterSpacing: '0.25em', margin: '0 0 1.2rem', fontFamily: 'var(--font-display)' }}>
          — COMMUNITY GUIDELINES —
        </p>

        {[
          {
            num: '01', title: '請相信科學',
            lines: [
              '玄學雖有趣但就算再準不能盡信。',
              '對世間的人來說永遠都只是參考。',
              '重點還是在於自己做出的選擇。',
            ],
          },
          {
            num: '02', title: '維持禮貌',
            lines: [
              '「請多指教」跟「謝謝指教」是基礎！',
              '請勿做出種族或仇恨言論。',
              '不要刷版導致其他人無法正常閱讀。',
              '討論政治可以，但吵起來就會 ban 人。',
            ],
          },
        ].map((rule) => (
          <div key={rule.num} style={{
            background: 'rgba(200,169,110,0.03)',
            border: '1px solid rgba(200,169,110,0.1)',
            borderLeft: '2px solid rgba(200,169,110,0.4)',
            borderRadius: '0 4px 4px 0',
            padding: '12px 14px',
            marginBottom: '10px',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
              <span style={{ fontSize: '9px', color: 'var(--gold)', fontFamily: 'var(--font-display)', letterSpacing: '0.1em', opacity: 0.6 }}>{rule.num}</span>
              <span style={{ fontSize: '12px', color: 'var(--gold)', fontFamily: 'var(--font-display)', letterSpacing: '0.08em', fontWeight: 600 }}>{rule.title}</span>
            </div>
            {rule.lines.map((line, j) => (
              <p key={j} style={{ color: 'rgba(200,169,110,0.5)', fontSize: '11px', margin: '0 0 3px', lineHeight: 1.7 }}>{line}</p>
            ))}
          </div>
        ))}

        <p style={{ color: 'rgba(200,169,110,0.25)', fontSize: '10px', textAlign: 'center', margin: '1.2rem 0 0', letterSpacing: '0.08em', lineHeight: 1.8 }}>
          請保持友善，互相追求自己想追求的人事物。
        </p>
      </div>
    </div>
  );
}

// ===== 首頁 =====
const getDialogues = (name) => [
  `${name||'嗨~'} 晚上好啊~`,
  "你看起來好像有點累了？沒關係，這裡很安靜，我們可以一起休息一下。",
  "獨角獸的角是拿來拔斷的喔www",
];

function useTypewriter(text, speed = 40) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDisplayed('');
    setDone(false);
    if (!text) return;
    let i = 0;
    const timer = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) { clearInterval(timer); setDone(true); }
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);
  return { displayed, done };
}

function HomeTab({ onNavigate, unreadCount = 0, onOpenNotif }) {
  const [profile, setProfile] = useState(null);
  const [dialogueIdx, setDialogueIdx] = useState(0);
  const [cycleIdx, setCycleIdx] = useState(0);

  useEffect(() => {
    api.getProfile().then(setProfile).catch(() => {});
  }, []);

  const currentText = getDialogues(profile?.player?.displayName)[dialogueIdx];
  const { displayed, done } = useTypewriter(currentText, 45);

  const handleDialogueClick = () => {
    if (!done) return;
    if (dialogueIdx === 0) { setDialogueIdx(1); setCycleIdx(1); }
    else { const next = cycleIdx === 1 ? 2 : 1; setDialogueIdx(next); setCycleIdx(next); }
  };

  const hour = new Date().getHours();
  const greeting = hour < 6 ? 'LATE NIGHT' : hour < 12 ? 'GOOD MORNING' : hour < 18 ? 'GOOD AFTERNOON' : 'GOOD EVENING';
  const name = profile?.player?.displayName || '旅行者';
  const level = profile?.progress?.level || 1;
  const gold = profile?.wallet?.gold || 0;
  const diamond = profile?.wallet?.diamond || 0;

  const sideButtons = [
    { icon: '▶', label: '頻道', url: 'https://www.youtube.com/@音無恋' },
    { icon: ' X ', label: '推特', url: 'https://twitter.com/音無恋' },
    { icon: '⚔', label: '戰鬥', tab: 'combat' },
    { icon: '⬡', label: '背包', tab: 'inventory' },
    { icon: '◈', label: '商店', tab: 'shop' },
    { icon: '✦', label: '大廳', tab: 'chat' },
  ];

  return (
    <div style={{
      position: 'relative', height: '100%', overflow: 'hidden',
      background: 'linear-gradient(175deg, #04060e 0%, #080c1c 40%, #060e1a 100%)',
    }}>

      {/* ── 背景層 ── */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        {/* 頂部藍紫光暈 */}
        <div style={{ position: 'absolute', top: '-20%', left: '50%', transform: 'translateX(-50%)', width: '140%', height: '60%', background: 'radial-gradient(ellipse, rgba(60,40,160,0.25) 0%, transparent 70%)' }} />
        {/* 右上金光 */}
        <div style={{ position: 'absolute', top: '5%', right: '-10%', width: '50%', height: '40%', background: 'radial-gradient(ellipse, rgba(200,160,60,0.1) 0%, transparent 70%)' }} />
        {/* 底部暗漸層 */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '40%', background: 'linear-gradient(to top, #04060e 0%, transparent 100%)' }} />
        {/* 細線裝飾 */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: 'linear-gradient(to right, transparent, rgba(200,169,110,0.4), transparent)' }} />
      </div>

      {/* ── 頂部 HUD ── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
        padding: '14px 16px 0',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      }}>
        {/* 左：玩家 */}
        <div>
          <p style={{ margin: 0, fontSize: '9px', color: 'var(--gold)', letterSpacing: '0.2em', fontFamily: 'var(--font-display)', opacity: 0.8 }}>{greeting}</p>
          <p style={{ margin: '3px 0 0', fontSize: '1.05rem', fontWeight: 700, color: '#f0e6d3', letterSpacing: '0.05em', fontFamily: 'var(--font-display)' }}>{name}</p>
          <div style={{ marginTop: '5px' }}>
            <span style={{
              fontSize: '9px', letterSpacing: '0.12em', fontFamily: 'var(--font-display)',
              color: 'var(--gold)', border: '1px solid rgba(200,169,110,0.4)',
              padding: '2px 8px', borderRadius: '2px',
            }}>LV. {level}</span>
          </div>
        </div>

        {/* 右：貨幣 + 通知鈴鐺 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'flex-end' }}>
          {/* 鈴鐺按鈕 */}
          <button
            onClick={onOpenNotif}
            style={{
              position: 'relative', background: 'rgba(4,6,14,0.7)', backdropFilter: 'blur(8px)',
              border: '1px solid rgba(200,169,110,0.25)', borderRadius: '2px',
              padding: '3px 8px', cursor: 'pointer', lineHeight: 1,
              display: 'flex', alignItems: 'center', gap: '4px',
            }}
          >
            <span style={{ fontSize: '0.8rem' }}>🔔</span>
            {unreadCount > 0 && (
              <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
            )}
          </button>
          {[
            { icon: '💰', val: gold, color: '#e8c97a', border: 'rgba(200,169,110,0.3)' },
            { icon: '💎', val: diamond, color: '#7ab4ff', border: 'rgba(100,160,255,0.25)' },
          ].map(c => (
            <div key={c.icon} style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'rgba(4,6,14,0.7)', backdropFilter: 'blur(8px)',
              padding: '3px 10px 3px 8px', borderRadius: '2px',
              border: `1px solid ${c.border}`,
            }}>
              <span style={{ fontSize: '0.72rem' }}>{c.icon}</span>
              <span style={{ fontSize: '0.72rem', color: c.color, fontWeight: 700, letterSpacing: '0.04em', fontFamily: 'var(--font-display)' }}>{c.val.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 看板娘 ── */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 5 }}>
        {/* 地面光暈 */}
        <div style={{
          position: 'absolute', bottom: 'calc(var(--nav-height) + 2%)',
          left: '50%', transform: 'translateX(-50%)',
          width: '220px', height: '20px', borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(200,169,110,0.45) 0%, transparent 70%)',
          filter: 'blur(10px)',
        }} />
        <img
          src={`${import.meta.env.BASE_URL}chara.png`}
          alt="看板娘"
          style={{
            height: '80%',
            maxHeight: 'calc(100% - var(--nav-height) - 100px)',
            objectFit: 'contain',
            objectPosition: 'center bottom',
            marginBottom: 'calc(var(--nav-height) + 110px)',
            filter: 'drop-shadow(0 0 40px rgba(200,169,110,0.3)) drop-shadow(0 0 80px rgba(60,40,160,0.3))',
            userSelect: 'none', pointerEvents: 'none',
            WebkitMaskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)',
            maskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)',
          }}
        />
      </div>

      {/* ── 右側功能按鈕 ── */}
      <div style={{
        position: 'absolute', right: '10px',
        top: '50%', transform: 'translateY(-50%)',
        display: 'flex', flexDirection: 'column', gap: '8px',
        zIndex: 20,
      }}>
        {sideButtons.map((btn) => (
          <button
            key={btn.tab ?? btn.label}
            onClick={() => btn.url ? window.open(btn.url, '_blank', 'noopener,noreferrer') : onNavigate(btn.tab)}
            style={{
              width: '48px', height: '52px',
              background: 'rgba(4,6,14,0.75)', backdropFilter: 'blur(12px)',
              border: '1px solid rgba(200,169,110,0.2)',
              borderRadius: '2px', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: '3px', transition: 'all 0.18s ease',
              position: 'relative', overflow: 'hidden',
            }}
            onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(200,169,110,0.7)'; e.currentTarget.style.background = 'rgba(200,169,110,0.08)'; e.currentTarget.style.boxShadow = '0 0 12px rgba(200,169,110,0.2)'; }}
            onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(200,169,110,0.2)'; e.currentTarget.style.background = 'rgba(4,6,14,0.75)'; e.currentTarget.style.boxShadow = 'none'; }}
          >
            <span style={{ fontSize: '1.1rem', color: 'var(--gold)', lineHeight: 1 }}>{btn.icon}</span>
            <span style={{ fontSize: '9px', color: 'rgba(200,169,110,0.7)', letterSpacing: '0.08em', fontFamily: 'var(--font-display)' }}>{btn.label}</span>
          </button>
        ))}
      </div>

      {/* ── 底部對話框（HSR VN 風格）── */}
      <div
        onClick={handleDialogueClick}
        style={{
          position: 'absolute',
          bottom: 'calc(var(--nav-height) + 10px)',
          left: '10px', right: '10px',
          zIndex: 20, cursor: done ? 'pointer' : 'default',
        }}
      >
        {/* 橫線裝飾 */}
        <div style={{ height: '1px', background: 'linear-gradient(to right, transparent, rgba(200,169,110,0.5), transparent)', marginBottom: '0' }} />

        <div style={{
          background: 'rgba(4,6,14,0.88)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(200,169,110,0.25)',
          borderTop: 'none',
          borderRadius: '0 0 4px 4px',
          padding: '10px 14px 12px',
          position: 'relative',
        }}>
          {/* 角色名標籤 */}
          <div style={{
            position: 'absolute', top: '-14px', left: '0',
            background: 'rgba(4,6,14,0.95)',
            border: '1px solid rgba(200,169,110,0.4)',
            borderBottom: 'none',
            padding: '2px 14px',
            borderRadius: '4px 4px 0 0',
            fontSize: '10px', fontWeight: 700, color: 'var(--gold)',
            letterSpacing: '0.15em', fontFamily: 'var(--font-display)',
          }}>
            音無恋
          </div>

          {/* 對話文字 */}
          <p style={{
            margin: 0, fontSize: '0.85rem', color: '#f0e6d3',
            lineHeight: 1.75, letterSpacing: '0.04em', minHeight: '3em',
            fontFamily: 'var(--font-body)',
          }}>
            {displayed}
          </p>

          {/* 點擊提示 */}
          {done && (
            <div style={{
              position: 'absolute', bottom: '8px', right: '12px',
              color: 'var(--gold)', fontSize: '9px', letterSpacing: '0.15em',
              animation: 'pulse 1.4s ease-in-out infinite',
              fontFamily: 'var(--font-display)',
            }}>
              ▼ TAP
            </div>
          )}
        </div>
      </div>

      {/* ── 左下角版本標記 ── */}
      <div style={{
        position: 'absolute', bottom: 'calc(var(--nav-height) + 12px)', left: '14px',
        zIndex: 20, pointerEvents: 'none',
      }}>
        <p style={{ margin: 0, fontSize: '8px', color: 'rgba(200,169,110,0.3)', letterSpacing: '0.15em', fontFamily: 'var(--font-display)' }}>
          音無玄學棋牌社
        </p>
      </div>
    </div>
  );
}

const getAssetUrl = (url) => {
  if (!url) return null;
  // Cloudinary or other full URLs
  if (url.startsWith('http')) return url;
  
  // Local assets (e.g., from /data/items or /public)
  const path = url.startsWith('/') ? url : `/${url}`;
  
  // If we are on GitHub Pages, the origin is NOT the API origin.
  // API_ORIGIN is already set correctly in api.js.
  return `${API_ORIGIN}${path}`;
};

// HTML 特殊字元跳脫，防止 XSS
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

function ProfileTab({ onOpenSettings }) {
  const [data, setData] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [swappingSlot, setSwappingSlot] = useState(null); // { slotKey, label }
  const [enhanceCandidates, setEnhanceCandidates] = useState(null);
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [isEnhancing, setIsEnhancing] = useState(false);

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

  // 計算裝備加成（各屬性）
  const equipBonus = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
  for (const item of Object.values(equipment)) {
    if (!item?.equipStats) continue;
    for (const [k, v] of Object.entries(item.equipStats)) {
      if (k in equipBonus) equipBonus[k] += (v || 0);
    }
  }

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
    { key: 'head_top',    label: '頭上',  icon: '👒' },
    { key: 'head_mid',    label: '頭中',  icon: '🕶️' },
    { key: 'head_low',    label: '頭下',  icon: '🧣' },
    { key: 'armor',       label: '衣服',  icon: '👕' },
    { key: 'weapon',      label: '主武器', icon: '⚔️' },
    { key: 'shield',      label: '副手',  icon: '🛡️' },
    { key: 'garment',     label: '披肩',  icon: '🧥' },
    { key: 'shoes',       label: '鞋子',  icon: '👞' },
    { key: 'accessory_l', label: '左飾品', icon: '💍' },
    { key: 'accessory_r', label: '右飾品', icon: '💍' },
    { key: 'title_eq',    label: '稱號',  icon: '🏅' },
    { key: 'job_eq',      label: '職業',  icon: '📜' },
    { key: 'special_1',   label: '特殊①', icon: '✦' },
    { key: 'special_2',   label: '特殊②', icon: '✦' },
    { key: 'special_3',   label: '特殊③', icon: '✦' },
  ];

  return (
    <div className="app-screen" style={{ position: 'relative' }}>
      <header style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)', fontWeight: 600 }}>冒險者檔案 Profile</p>
          <h2 style={{ fontSize: '1.8rem' }}>{player.displayName}</h2>
        </div>
        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
          <button onClick={onOpenSettings} style={{
            background: 'transparent', border: '1px solid var(--glass-border)',
            color: 'var(--muted)', borderRadius: '8px', padding: '5px 8px',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
            fontSize: '12px', transition: 'all 0.2s',
          }}
            onMouseOver={e => { e.currentTarget.style.color = 'var(--gold)'; e.currentTarget.style.borderColor = 'var(--gold)'; }}
            onMouseOut={e => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.borderColor = 'var(--glass-border)'; }}
          >
            <Icons.Settings />
          </button>
          <span style={{ display: 'inline-block', background: 'var(--accent-light)', color: 'var(--accent-strong)', padding: '4px 12px', borderRadius: '12px', fontSize: '14px', fontWeight: 'bold' }}>{progress.playerTier} 級玩家</span>
        </div>
      </header>

      {/* 等級 & EXP */}
      <div className="card" style={{ padding: '14px 16px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: '22px', color: 'var(--gold-bright)', fontWeight: 700 }}>
              Lv. {progress.level}
            </span>
            {progress.isMaxLevel && (
              <span style={{ fontSize: '11px', color: 'var(--gold)', background: 'var(--gold-dim)', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--glass-border)' }}>MAX</span>
            )}
          </div>
          <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
            {progress.isMaxLevel
              ? '已達最高等級'
              : `${progress.exp} / ${progress.nextLevelExp} EXP`}
          </span>
        </div>
        {!progress.isMaxLevel && (
          <div style={{ height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${Math.min(100, Math.round((progress.exp / progress.nextLevelExp) * 100))}%`,
              background: 'linear-gradient(to right, var(--gold), var(--gold-bright))',
              borderRadius: '3px',
              transition: 'width 0.6s ease',
              boxShadow: '0 0 8px var(--gold-glow)',
            }} />
          </div>
        )}
        {!progress.isMaxLevel && (
          <div style={{ marginTop: '4px', fontSize: '10px', color: 'var(--muted)', textAlign: 'right' }}>
            還差 {progress.nextLevelExp - progress.exp} EXP 升級
          </div>
        )}
      </div>

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

      {/* 裝備欄 */}
      <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: 'var(--gold)', fontFamily: 'var(--font-display)', letterSpacing: '0.06em' }}>裝備欄位 (Equipment)</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
          {slots.flatMap((s, idx) => {
            const item = equipment[s.key];
            const cell = (
              <div
                key={s.key}
                onClick={() => setSwappingSlot(s)}
                style={{
                  aspectRatio: '1',
                  background: item ? 'var(--surface-hover)' : 'rgba(255,255,255,0.03)',
                  borderRadius: '12px',
                  border: item ? '1.5px solid var(--accent)' : '1px dashed var(--glass-border)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: '2px', cursor: 'pointer', position: 'relative', overflow: 'hidden',
                  transition: 'all 0.2s ease',
                  boxShadow: item ? '0 0 10px rgba(168,85,247,0.2)' : 'none'
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
            // 在第 10 格前插入金色分隔線（跨整列）
            if (idx === 10) {
              return [
                <div key="divider" style={{ gridColumn: '1 / -1', height: '1px', background: 'linear-gradient(to right, transparent, rgba(200,169,110,0.3), transparent)', margin: '2px 0' }} />,
                cell,
              ];
            }
            return cell;
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

          {/* 武器特效標籤 */}
          {(() => {
            const effects = [];
            const wt = stats.weaponType;
            if (wt === 'dagger') effects.push('🗡️ 匕首：連擊率 +20%');
            if (wt === 'axe_2h') effects.push('🪓 雙手斧：攻擊倍率 ×4');
            if (wt === 'staff_1h') effects.push('🪄 法杖：絕對命中、受兩次攻擊');
            if (wt === 'staff_2h') effects.push('🪄 雙手法杖：絕對命中、受兩次攻擊、攻擊倍率 ×5');
            if (stats.attackCount === 2) effects.push('⚔️ 雙持：每回合攻擊兩次');
            if (!effects.length) return null;
            return (
              <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {effects.map((fx, i) => (
                  <div key={i} style={{
                    fontSize: '11px', color: 'var(--gold)',
                    background: 'var(--gold-dim)',
                    border: '1px solid rgba(200,169,110,0.25)',
                    borderRadius: '4px',
                    padding: '4px 10px',
                    letterSpacing: '0.04em',
                  }}>{fx}</div>
                ))}
              </div>
            );
          })()}
        </div>

      {/* 基礎屬性 */}
      <div className="card">
        <div style={{ marginBottom: '12px' }}>
          <h4 style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>屬性配點 (Attributes)</h4>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px 16px', fontSize: '14px' }}>
          {[['STR','str'],['INT','int'],['AGI','agi'],['DEX','dex'],['VIT','vit'],['LUK','luk']].map(([label, key]) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: '8px' }}>
              <span style={{ color: 'var(--muted)' }}>{label}</span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
                <strong>{attributes[key]}</strong>
                {equipBonus[key] > 0 && <span style={{ fontSize: '11px', color: 'var(--gold)', fontWeight: 700 }}>+{equipBonus[key]}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 快速更換裝備 Modal */}
      {swappingSlot && (
        <div className="modal-overlay" onClick={() => { setSwappingSlot(null); setEnhanceCandidates(null); setSelectedMaterial(null); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '90%', maxWidth: '360px', borderRadius: '24px', padding: '20px' }}>
            <div className="modal-header" style={{ marginBottom: '20px' }}>
              <div>
                <h3 style={{ margin: 0 }}>部位操作：{swappingSlot.label}</h3>
                {equipment[swappingSlot.key] && (
                  <div style={{ marginTop: '4px' }}>
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--accent)' }}>目前裝備: {equipment[swappingSlot.key].itemName}</p>
                    {equipment[swappingSlot.key].equipStats && Object.values(equipment[swappingSlot.key].equipStats).some(v => v) && (
                      <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)' }}>
                        {Object.entries(equipment[swappingSlot.key].equipStats).filter(([, v]) => v).map(([k, v]) => `${k.toUpperCase()} +${v}`).join('　')}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <button className="close-btn" onClick={() => { setSwappingSlot(null); setEnhanceCandidates(null); setSelectedMaterial(null); }}>&times;</button>
            </div>

            <div className="modal-body" style={{ maxHeight: '500px', overflowY: 'auto' }}>
              {/* 強化區 */}
              {equipment[swappingSlot.key] && (equipment[swappingSlot.key].enhanceLevel ?? 0) < 3 && (
                <div style={{ marginBottom: '16px', padding: '16px', background: 'rgba(240,200,87,0.07)', borderRadius: '16px', border: '1px solid rgba(240,200,87,0.2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: enhanceCandidates ? '12px' : '0' }}>
                    <p style={{ margin: 0, fontSize: '13px', color: '#f0c857' }}>⚗️ 強化 {equipment[swappingSlot.key].itemName}（目前 +{equipment[swappingSlot.key].enhanceLevel ?? 0}）</p>
                    {!enhanceCandidates && (
                      <button className="btn" onClick={() => {
                        const inv = inventory || [];
                        const target = equipment[swappingSlot.key];
                        // 優先用 itemId 比對，其次用去除了 +n 的基底名稱比對
                        const candidates = inv.filter(i => 
                          i.itemType === 'equipment' && 
                          (i.itemId === target.itemId || i.itemName.replace(/ \+\d+$/, '') === target.itemName.replace(/ \+\d+$/, '')) && 
                          !i.isEquipped && 
                          i.uuid !== target.uuid
                        );
                        setEnhanceCandidates(candidates);
                        setSelectedMaterial(null);
                      }} style={{ background: '#f0c857', borderColor: '#f0c857', color: '#111', padding: '4px 12px', fontSize: '12px' }}>選材料</button>
                    )}
                  </div>
                  {enhanceCandidates && (
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '6px' }}>選擇強化材料 (同名未裝備)：</div>
                      {enhanceCandidates.length === 0 ? (
                        <div style={{ fontSize: '12px', color: 'var(--muted)', padding: '10px 0' }}>背包中沒有可作為材料的同名裝備。</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '150px', overflowY: 'auto', paddingRight: '4px' }} className="hide-scrollbar">
                          {enhanceCandidates.map(c => (
                            <label key={c.uuid} style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '8px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', cursor: 'pointer', border: selectedMaterial?.uuid === c.uuid ? '1px solid #f0c857' : '1px solid transparent' }}>
                              <input type="radio" name="enhanceMatProfile" checked={selectedMaterial?.uuid === c.uuid} onChange={() => setSelectedMaterial(c)} />
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '13px', color: '#fff' }}>{c.itemName}</div>
                                <div style={{ fontSize: '10px', color: 'var(--muted)' }}>強化等級: +{c.enhanceLevel || 0}</div>
                              </div>
                            </label>
                          ))}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                        <button className="btn" disabled={!selectedMaterial || isEnhancing} onClick={async () => {
                          if (!selectedMaterial) return;
                          if (!confirm(`確定消耗 ${selectedMaterial.itemName} 來強化嗎？\n(強化成功率 100%)`)) return;
                          try {
                            setIsEnhancing(true);
                            const res = await api.enhanceItem(equipment[swappingSlot.key].uuid, selectedMaterial.uuid);
                            alert(res.message || '強化成功！');
                            setEnhanceCandidates(null);
                            setSelectedMaterial(null);
                            setSwappingSlot(null);
                            loadAll();
                          } catch (err) {
                            alert('強化失敗: ' + err.message);
                          } finally { setIsEnhancing(false); }
                        }} style={{ background: '#f0c857', borderColor: '#f0c857', color: '#000', fontSize: '12px', padding: '6px 16px', fontWeight: 'bold' }}>確認強化</button>
                        <button className="btn" onClick={() => { setEnhanceCandidates(null); setSelectedMaterial(null); }} style={{ background: 'transparent', borderColor: 'rgba(255,255,255,0.2)', fontSize: '12px', padding: '6px 16px' }}>取消</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

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
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [isEnhancing, setIsEnhancing] = useState(false);
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

  const displayList = React.useMemo(() => {
    if (!inventory) return [];
    
    const filtered = inventory.filter(item => {
      if (category === 'all') return true;
      return item.itemType === category;
    });

    const grouped = filtered.reduce((acc, item) => {
      if (item.isEquipped) {
        acc.push({ ...item, stackCount: 1 });
        return acc;
      }
      
      const existing = acc.find(i => 
        !i.isEquipped && 
        i.itemId === item.itemId && 
        (i.enhanceLevel || 0) === (item.enhanceLevel || 0) &&
        i.itemType === item.itemType &&
        // 額外檢查屬性是否完全一致（針對獨特裝備）
        JSON.stringify(i.equipStats) === JSON.stringify(item.equipStats)
      );

      if (existing) {
        existing.stackCount = (existing.stackCount || 1) + 1;
      } else {
        acc.push({ ...item, stackCount: 1 });
      }
      return acc;
    }, []);

    return grouped.sort((a, b) => {
      if (a.isEquipped !== b.isEquipped) return a.isEquipped ? -1 : 1;
      return 0;
    });
  }, [inventory, category]);

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

  const autoSelectMaterial = (target) => {
    const material = inventory.find(i => 
      i.itemType === 'equipment' && 
      (i.itemId === target.itemId || i.itemName.replace(/ \+\d+$/, '') === target.itemName.replace(/ \+\d+$/, '')) && 
      !i.isEquipped && 
      i.uuid !== target.uuid
    );
    setSelectedMaterial(material || null);
    if (!material) alert("背包中沒有符合條件的材料裝備 (需同名且未裝備)");
  };

  const categories = [
    { key: 'all', label: '全部' },
    { key: 'equipment', label: '裝備' },
    { key: 'consumable', label: '消耗品' },
    { key: 'collectible', label: '收藏品' }
  ];

  return (
    <div className="app-screen" style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h2 style={{ marginBottom: '12px' }}>背包 Inventory</h2>
      
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', overflowX: 'auto', paddingBottom: '4px' }} className="hide-scrollbar">
        {categories.map(c => (
          <div 
            key={c.key} 
            onClick={() => setCategory(c.key)}
            style={{ 
              padding: '6px 14px', borderRadius: '20px', 
              background: category === c.key ? 'var(--accent)' : 'rgba(255,255,255,0.05)', 
              color: category === c.key ? '#fff' : '#888',
              cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap',
              border: '1px solid var(--glass-border)'
            }}
          >
            {c.label}
          </div>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: '20px' }}>
        {displayList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', opacity: 0.3 }}>📦 這裡空空如也...</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
            {displayList.map((item) => (
              <div
                key={item.uuid}
                onClick={() => { setActiveItem(item); setSelectedMaterial(null); }}
                style={{
                  aspectRatio: '1',
                  background: item.isEquipped ? 'rgba(200,169,110,0.08)' : 'rgba(255,255,255,0.03)',
                  border: item.isEquipped ? '1.5px solid var(--gold)' : '1px solid var(--glass-border)',
                  borderRadius: '10px', cursor: 'pointer',
                  position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden'
                }}
              >
                {/* 數量標記 */}
                {item.stackCount > 1 && (
                  <div style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(168,85,247,0.8)', color: '#fff', fontSize: '10px', fontWeight: 'bold', padding: '1px 5px', borderRadius: '6px', zIndex: 2 }}>
                    x{item.stackCount}
                  </div>
                )}
                {/* 強化等級標記 */}
                {item.enhanceLevel > 0 && (
                  <div style={{ position: 'absolute', top: '4px', left: '4px', background: 'rgba(0,0,0,0.5)', color: 'var(--gold)', fontSize: '9px', fontWeight: 'bold', padding: '1px 4px', borderRadius: '4px', zIndex: 2 }}>
                    +{item.enhanceLevel}
                  </div>
                )}
                {/* 已裝備圖示 */}
                {item.isEquipped && (
                  <div style={{ position: 'absolute', bottom: '18px', right: '4px', fontSize: '10px', zIndex: 2 }}>🛡️</div>
                )}
                
                <div style={{ width: '60%', height: '60%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {item.imageUrl ? (
                    <img src={getAssetUrl(item.imageUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : <span style={{fontSize:'20px', opacity: 0.3}}>📦</span>}
                </div>

                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)', padding: '2px 4px', textAlign: 'center' }}>
                  <div style={{ fontSize: '8px', color: '#f0e6d3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.itemName}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {activeItem && (
        <div className="modal-overlay" onClick={() => { setActiveItem(null); setSelectedMaterial(null); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '340px', borderRadius: '24px' }}>
            <div className="modal-header">
              <h3 style={{ margin: 0 }}>{activeItem.itemName}</h3>
              <button onClick={() => setActiveItem(null)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '20px' }}>&times;</button>
            </div>
            <div className="modal-body">
              <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                {activeItem.imageUrl && (
                  <img src={getAssetUrl(activeItem.imageUrl)} alt="" style={{ width: '80px', height: '80px', objectFit: 'contain', background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '10px', border: '1px solid var(--glass-border)', marginBottom: '12px' }} />
                )}
                <p style={{ color: 'var(--muted)', fontSize: '13px', lineHeight: 1.6 }}>{activeItem.itemDescription || '無詳細描述'}</p>
                {activeItem.equipStats && (
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                    {Object.entries(activeItem.equipStats).filter(([,v])=>v).map(([k,v]) => (
                      <span key={k} style={{ fontSize: '11px', color: 'var(--gold)', background: 'rgba(200,169,110,0.1)', padding: '2px 8px', borderRadius: '4px' }}>{k.toUpperCase()} +{v}</span>
                    ))}
                  </div>
                )}
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {activeItem.itemType === 'equipment' && (activeItem.enhanceLevel || 0) < 3 && (
                  <div style={{ background: 'rgba(200,169,110,0.05)', padding: '14px', borderRadius: '16px', border: '1px solid rgba(200,169,110,0.2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', color: 'var(--gold)', fontWeight: 'bold' }}>⚗️ 裝備強化 (+{activeItem.enhanceLevel || 0})</span>
                      <button className="btn" onClick={() => autoSelectMaterial(activeItem)} style={{ width: 'auto', padding: '4px 12px', fontSize: '11px', background: 'rgba(200,169,110,0.2)', color: 'var(--gold)', border: 'none' }}>自動選料</button>
                    </div>
                    {selectedMaterial && (
                      <div style={{ fontSize: '12px', marginBottom: '10px', color: 'var(--success)' }}>
                        使用材料: {selectedMaterial.itemName} (+{selectedMaterial.enhanceLevel || 0})
                      </div>
                    )}
                    <button className="btn" disabled={!selectedMaterial || isEnhancing} onClick={async () => {
                      try {
                        setIsEnhancing(true);
                        const res = await api.enhanceItem(activeItem.uuid, selectedMaterial.uuid);
                        alert(res.message || '強化成功！');
                        setSelectedMaterial(null);
                        setActiveItem(null);
                        loadInventory();
                      } catch (err) { alert(err.message); } finally { setIsEnhancing(false); }
                    }} style={{ background: 'var(--gold)', color: '#000', fontWeight: 'bold', border: 'none' }}>確認強化 (100% 成功)</button>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px' }}>
                  {activeItem.itemType === 'consumable' && <button className="btn" style={{flex:2, background: 'var(--success)', border: 'none', color: '#000'}} onClick={() => handleUse(activeItem)}>使用</button>}
                  {!activeItem.isEquipped && activeItem.itemType === 'equipment' && <button className="btn" style={{flex:2, background: 'var(--accent)', border: 'none'}} onClick={() => handleEquip(activeItem)}>穿戴</button>}
                  {activeItem.itemType === 'collectible' && activeItem.imageUrl && <button className="btn" style={{flex:2}} onClick={() => setPreviewImage(getAssetUrl(activeItem.imageUrl))}>檢視圖片</button>}
                  <button className="btn" style={{flex:1, borderColor: '#ff4d4f', color: '#ff4d4f', background: 'transparent'}} onClick={async () => {
                    if (confirm(`確定丟棄 ${activeItem.itemName}？`)) { await api.discardItem(activeItem.uuid); setActiveItem(null); loadInventory(); }
                  }}>丟棄</button>
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
  // nextBattleAt: timestamp from server (ms). null = no cooldown.
  const [nextBattleAt, setNextBattleAt] = useState(null);
  const [cdSecs, setCdSecs] = useState(0);
  const [rewardModalOpen, setRewardModalOpen] = useState(false);
  const logsEndRef = React.useRef(null);

  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') setBattleState(null);
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  // Countdown ticker
  useEffect(() => {
    if (!nextBattleAt) return;
    const tick = () => {
      const left = Math.ceil((nextBattleAt - Date.now()) / 1000);
      if (left <= 0) { setNextBattleAt(null); setCdSecs(0); }
      else setCdSecs(left);
    };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [nextBattleAt]);

  const fetchZones = () => {
    api.getCombatZones().then(data => {
      setZones(data);
      // Sync cooldown from server (in case of page refresh)
      const serverCd = data.find(z => z.nextBattleAt)?.nextBattleAt ?? null;
      if (serverCd && serverCd > Date.now()) {
        setNextBattleAt(prev => (!prev || serverCd > prev) ? serverCd : prev);
      }
    }).catch(console.error);
  };

  useEffect(() => {
    fetchZones();
    const timer = setInterval(fetchZones, 5000);
    return () => clearInterval(timer);
  }, []);

  const isOnCooldown = nextBattleAt && nextBattleAt > Date.now();

  const startBattle = async (zone) => {
    if (isBattling || isOnCooldown) return;
    try {
      setIsBattling(true);
      setBattleState({ logs: ["⚔️ 正在前往戰區..."], visibleLogs: ["⚔️ 正在前往戰區..."] });
      const result = await api.quickBattle(zone);

      // Apply server cooldown immediately
      if (result.nextBattleAt) setNextBattleAt(result.nextBattleAt);

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
      // 先跳脫 HTML，再套用允許的格式
      let formatted = escapeHtml(line);
      formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      // Discord 表情符號：跳脫後 <a:name:id> 變為 &lt;a:name:id&gt;
      formatted = formatted.replace(/&lt;(a?):(\w+):(\d+)&gt;/g, (match, animated, name, id) => {
        const ext = animated ? 'gif' : 'png';
        return `<img src="https://cdn.discordapp.com/emojis/${id}.${ext}" alt=":${name}:" class="battle-emoji" />`;
      });
      // 提到 (@)
      formatted = formatted.replace(/\[@(.*?)\]/g, '<span class="mention">@$1</span>');
      return <div key={idx} dangerouslySetInnerHTML={{ __html: formatted }} style={{ marginBottom: '4px' }} />;
    });
  };

  const getZoneData = (key) => zones.find(z => z.zone === key) || {};

  return (
    <div className="app-screen" style={{ position: 'relative' }}>
      <h2 style={{ marginBottom: '16px' }}>戰鬥區 Combat</h2>
      <p style={{ color: 'var(--muted)', fontSize: '13px', marginBottom: '20px', lineHeight: 1.5 }}>
        選擇你想挑戰的地圖區域。隨著等級提升，可以解鎖更強大的區域。
      </p>

      {[ 
        { key: 'normal', name: '新手區', lv: 'Lv.1 ~ 10', desc: '適合初學者的史萊姆與小型怪物出沒區域。', color: 'var(--success)' },
        { key: 'mid',    name: '次級區', lv: 'Lv.10 ~ 15', desc: '更危險的怪物巢穴，建議準備好裝備再前往。', color: 'var(--warn)' }
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
                <div style={{ display: 'flex', height: '120px', flexShrink: 0 }}>
                  {/* 怪物圖片區 */}
                  <div style={{
                    width: '100px',
                    flexShrink: 0,
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

            {/* 累計傷害排行 */}
            {data.damageLeaderboard && data.damageLeaderboard.length > 0 && (
              <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: '10px', padding: '10px 12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <p style={{ margin: '0 0 8px', fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                  ⚔️ 本輪累計傷害
                </p>
                {data.damageLeaderboard.map((entry, idx) => {
                  const totalDmg = data.damageLeaderboard.reduce((s, e) => s + e.damage, 0);
                  const pct = totalDmg > 0 ? (entry.damage / totalDmg) * 100 : 0;
                  const medals = ['🥇', '🥈', '🥉'];
                  return (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: idx < data.damageLeaderboard.length - 1 ? '6px' : 0 }}>
                      <span style={{ fontSize: '12px', width: '20px', textAlign: 'center' }}>{medals[idx] || `${idx + 1}`}</span>
                      <span style={{ flex: 1, fontSize: '12px', color: '#e8d8ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
                      <div style={{ width: '60px', height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: z.color, borderRadius: '2px' }} />
                      </div>
                      <span style={{ fontSize: '11px', color: z.color, fontWeight: 700, minWidth: '40px', textAlign: 'right' }}>{entry.damage.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <button className="btn" disabled={isBattling || isOnCooldown} onClick={() => startBattle(z.key)} style={{
              borderColor: z.color,
              color: isOnCooldown ? 'var(--muted)' : z.color,
              background: (isBattling || isOnCooldown) ? 'transparent' : `${z.color}10`,
              fontWeight: 'bold',
              letterSpacing: '1px'
            }}>
              {isBattling ? '戰鬥中...' : isOnCooldown ? `⏳ 冷卻中 ${cdSecs}s` : '⚔️ 進入該區域出戰'}
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
                
                {battleState.showResults && (() => {
                  const isWin = battleState.outcome === 'win';
                  const s = battleState.rewardSummary;
                  const hasReward = isWin && s && (s.gold > 0 || s.exp > 0 || (s.drops && s.drops.length > 0));
                  return (
                    <div style={{
                      padding: '20px', marginTop: '10px',
                      background: isWin ? 'rgba(241,196,15,0.08)' : 'rgba(231,76,60,0.08)',
                      border: `1px solid ${isWin ? 'rgba(241,196,15,0.3)' : 'rgba(231,76,60,0.3)'}`,
                      borderRadius: '16px', textAlign: 'center'
                    }}>
                      {/* 標題列：結果文字 + 燈泡按鈕 */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '12px' }}>
                        <h4 style={{ color: isWin ? '#f1c40f' : '#e74c3c', margin: 0, fontSize: '1.2rem' }}>
                          {isWin ? '🏆 戰鬥勝利！' :
                           battleState.outcome === 'error' ? '❌ 系統異常' :
                           battleState.outcome === 'lose' ? '💀 戰鬥失敗' : '⏸️ 戰略撤退'}
                        </h4>
                        {hasReward && (
                          <button
                            onClick={() => setRewardModalOpen(true)}
                            title="查看獎勵詳情"
                            style={{
                              background: 'rgba(241,196,15,0.15)',
                              border: '1px solid rgba(241,196,15,0.5)',
                              borderRadius: '50%',
                              width: '36px', height: '36px',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer', fontSize: '18px',
                              flexShrink: 0,
                              animation: 'rewardPulse 1.5s ease-in-out infinite',
                            }}
                          >💡</button>
                        )}
                      </div>

                      {/* 一般文字 rewardLines（非 win 時顯示） */}
                      {!isWin && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {Array.isArray(battleState.rewardLines) && battleState.rewardLines.map((line, i) => {
                            if (typeof line !== 'string') return null;
                            return (
                              <div key={i} style={{ fontSize: '13px', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: escapeHtml(line).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                            );
                          })}
                        </div>
                      )}

                      {/* win 時顯示簡短摘要 */}
                      {isWin && s && (
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', flexWrap: 'wrap', fontSize: '14px', marginBottom: hasReward ? '4px' : 0 }}>
                          {s.exp > 0 && <span style={{ color: '#a8e063' }}>⭐ +{s.exp} EXP{s.levelUps > 0 ? ` ✨ Lv.${s.newLevel}` : ''}</span>}
                          {s.gold > 0 && <span style={{ color: '#f1c40f' }}>💰 +{s.gold}</span>}
                          {s.drops && s.drops.length > 0 && <span style={{ color: '#a78bfa' }}>🎁 {s.drops.join('、')}</span>}
                        </div>
                      )}
                      {isWin && hasReward && (
                        <p style={{ margin: '6px 0 0', fontSize: '11px', color: 'var(--muted)' }}>點 💡 查看獎勵詳情</p>
                      )}

                      {!isBattling && (
                        <button className="btn btn-primary" onClick={() => setBattleState(null)} style={{ marginTop: '16px', width: '100%', padding: '10px' }}>
                          完成並關閉
                        </button>
                      )}
                    </div>
                  );
                })()}
                <div ref={logsEndRef} style={{ height: '20px' }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 獎勵詳情彈窗 */}
      {rewardModalOpen && battleState?.rewardSummary && (
        <div className="modal-overlay" onClick={() => setRewardModalOpen(false)} style={{ zIndex: 1100 }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '340px', width: '90%' }}>
            <div className="modal-header">
              <h3 style={{ fontSize: '1rem', color: '#f1c40f' }}>🏆 戰鬥獎勵</h3>
              <button onClick={() => setRewardModalOpen(false)} style={{ background: 'var(--surface-hover)', border: 'none', color: '#fff', width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
            <div className="modal-body" style={{ padding: '20px' }}>
              {(() => {
                const s = battleState.rewardSummary;
                const rows = [];
                if (s.exp > 0) rows.push(
                  <div key="exp" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--glass-border)' }}>
                    <span style={{ color: 'var(--muted)', fontSize: '13px' }}>⭐ 經驗值</span>
                    <span style={{ fontWeight: 700, color: '#a8e063', fontSize: '16px' }}>
                      +{s.exp}
                      {s.levelUps > 0 && <span style={{ marginLeft: '8px', fontSize: '12px', color: '#ffd700', background: 'rgba(255,215,0,0.15)', padding: '2px 8px', borderRadius: '4px' }}>✨ 升級！Lv.{s.newLevel}</span>}
                    </span>
                  </div>
                );
                if (s.gold > 0) rows.push(
                  <div key="gold" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--glass-border)' }}>
                    <span style={{ color: 'var(--muted)', fontSize: '13px' }}>💰 金幣</span>
                    <span style={{ fontWeight: 700, color: '#f1c40f', fontSize: '16px' }}>+{s.gold}</span>
                  </div>
                );
                if (s.drops && s.drops.length > 0) rows.push(
                  <div key="drops" style={{ padding: '12px 0' }}>
                    <div style={{ color: 'var(--muted)', fontSize: '13px', marginBottom: '8px' }}>🎁 掉落道具</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {s.drops.map((name, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: '8px', padding: '8px 12px' }}>
                          <span style={{ fontSize: '16px' }}>📦</span>
                          <span style={{ fontWeight: 600, color: '#c4b5fd', fontSize: '13px' }}>{name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
                return rows.length > 0 ? rows : <p style={{ color: 'var(--muted)', textAlign: 'center' }}>無獎勵資料</p>;
              })()}
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
  const [playerLevel, setPlayerLevel] = useState(1);
  const [playerTier, setPlayerTier] = useState(null);
  const [category, setCategory] = useState('all');

  const loadData = () => {
    Promise.all([
      api.getShopItems(),
      api.getProfile()
    ]).then(([shopItems, profile]) => {
      setItems(shopItems);
      setWallet(profile.wallet);
      setPlayerLevel(profile.progress?.level || 1);
      setPlayerTier(profile.progress?.playerTier || null);
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

      {filteredItems.length === 0
        ? <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px 0', fontSize: '13px' }}>目前該分類下沒有商品。</p>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
            {filteredItems.map(item => {
              const isDiamond = item.currency === 'diamond';
              const priceColor = isDiamond ? '#7ab4ff' : 'var(--gold)';
              const levelLocked = (item.reqLevel || 1) > playerLevel;
              const tierLocked = Array.isArray(item.allowedTiers) && item.allowedTiers.length > 0
                && !item.allowedTiers.includes(playerTier);
              const locked = levelLocked || tierLocked;
              return (
                <div
                  key={item.id}
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: `1px solid ${locked ? 'rgba(255,255,255,0.04)' : 'var(--glass-border)'}`,
                    borderRadius: '10px', overflow: 'hidden',
                    display: 'flex', flexDirection: 'column',
                    cursor: locked ? 'default' : 'pointer',
                    transition: 'all 0.18s ease',
                    opacity: locked ? 0.55 : 1,
                  }}
                  onMouseOver={e => { if (!locked) { e.currentTarget.style.borderColor = 'rgba(200,169,110,0.45)'; e.currentTarget.style.background = 'rgba(200,169,110,0.05)'; } }}
                  onMouseOut={e => { e.currentTarget.style.borderColor = locked ? 'rgba(255,255,255,0.04)' : 'var(--glass-border)'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                >
                  {/* 圖片區 */}
                  <div style={{ aspectRatio: '1', background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                    {item.imageUrl
                      ? <img src={getAssetUrl(item.imageUrl)} alt="" style={{ width: '70%', height: '70%', objectFit: 'contain', filter: locked ? 'grayscale(80%)' : 'none' }} />
                      : <span style={{ fontSize: '2rem', opacity: 0.2 }}>📦</span>
                    }
                    {/* 等級標籤 / 鎖定遮罩 */}
                    {locked ? (
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
                        <span style={{ fontSize: '1.1rem' }}>🔒</span>
                        <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', fontFamily: 'var(--font-display)', letterSpacing: '0.08em' }}>Lv.{item.reqLevel}</span>
                      </div>
                    ) : item.reqLevel > 1 && (
                      <div style={{ position: 'absolute', top: 4, left: 4, fontSize: '9px', color: 'var(--gold)', background: 'rgba(0,0,0,0.7)', padding: '1px 5px', borderRadius: '3px', fontFamily: 'var(--font-display)' }}>
                        Lv.{item.reqLevel}
                      </div>
                    )}
                  </div>
                  {/* 資訊區 */}
                  <div style={{ padding: '7px 8px 8px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <p style={{ margin: 0, fontSize: '11px', color: locked ? 'var(--muted)' : '#f0e6d3', fontWeight: 600, lineHeight: 1.3, wordBreak: 'break-all' }}>{item.name}</p>
                    <button
                      onClick={() => !locked && handleBuy(item)}
                      disabled={locked}
                      style={{
                        background: locked ? 'rgba(255,255,255,0.04)' : isDiamond ? 'rgba(100,160,255,0.1)' : 'rgba(200,169,110,0.1)',
                        border: `1px solid ${locked ? 'rgba(255,255,255,0.08)' : isDiamond ? 'rgba(100,160,255,0.3)' : 'rgba(200,169,110,0.3)'}`,
                        color: locked ? 'var(--muted)' : priceColor,
                        borderRadius: '4px', padding: '4px 0',
                        fontSize: '11px', fontWeight: 700,
                        cursor: locked ? 'default' : 'pointer',
                        width: '100%', fontFamily: 'var(--font-display)', letterSpacing: '0.05em',
                        transition: 'all 0.15s',
                      }}
                      onMouseOver={e => { if (!locked) e.currentTarget.style.background = isDiamond ? 'rgba(100,160,255,0.2)' : 'rgba(200,169,110,0.2)'; }}
                      onMouseOut={e => { if (!locked) e.currentTarget.style.background = isDiamond ? 'rgba(100,160,255,0.1)' : 'rgba(200,169,110,0.1)'; }}
                    >
                      {locked ? '未解鎖' : `${isDiamond ? '💎' : '💰'} ${item.price}`}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      }
    </div>
  );
}

function ChatTab() {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [myDisplayName, setMyDisplayName] = useState('');
  const [expressions, setExpressions] = useState({ stickers: [], emojis: [] });
  const [showPicker, setShowPicker] = useState(false);
  const [pickerTab, setPickerTab] = useState('emoji'); // 'emoji' | 'sticker'
  const messagesEndRef = React.useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    api.getProfile().then(data => {
      setMyDisplayName(data.player.displayName);
    }).catch(() => {});

    api.getChatExpressions().then(data => {
      setExpressions(data);
    }).catch(() => {});

          // 取得歷史紀錄
          api.getChatHistory().then(history => {
            const formatted = history.map(m => {
              let text = m.content;
              let author = m.author;
              
              if (m.isBot && text.startsWith("[Web] **")) {
                const match = text.match(/\[Web\] \*\*([\s\S]+?)\*\*: ([\s\S]+)/);
                if (match) {
                  author = match[1];
                  text = match[2];
                }
              }
              
              return {
                id: m.id,
                text: text,
                originalText: m.content,
                author: author,
                avatar: m.avatar,
                time: new Date(m.timestamp).toLocaleTimeString(),
                replyTo: m.replyTo || null,
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
          time: new Date(newMsg.timestamp).toLocaleTimeString(),
          replyTo: newMsg.replyTo || null,
        }];
      });
      setTimeout(scrollToBottom, 100);
    });

    return () => {
      eventSource.close();
    };
  }, []);

  const handleSend = async (overrideMsg) => {
    const text = overrideMsg ?? message;
    if (!text.trim()) return;
    try {
      await api.sendChatMessage(text);
      setMessages(prev => [...prev, {
        id: "temp-" + Date.now(),
        text,
        author: myDisplayName || "Me",
        time: new Date().toLocaleTimeString()
      }]);
      if (!overrideMsg) setMessage('');
      setTimeout(scrollToBottom, 50);
    } catch (err) {
      alert("發送失敗: " + err.message);
    }
  };

  const handleSendExpression = async (expr) => {
    setShowPicker(false);
    // emoji 用 code 插入文字；sticker 直接送圖片 URL
    if (expr.code) {
      // Discord emoji code，直接附加到目前訊息或單獨發送
      const text = message ? `${message} ${expr.code}` : expr.code;
      setMessage('');
      await handleSend(text);
    } else {
      // Sticker — 傳圖片連結
      await handleSend(expr.url);
    }
  };

  return (
    <div className="app-screen" style={{ height: '100%', paddingBottom: '16px', position: 'relative' }}>
      <header style={{ flexShrink: 0, marginBottom: '8px' }}>
        <h2 style={{ margin: 0, fontSize: '1.4rem' }}>城鎮大廳 Chat Lobby</h2>
        <p style={{ color: 'var(--muted)', fontSize: '12px', margin: '4px 0' }}>發送對話至 Discord 城鎮頻道</p>
      </header>

      <div style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: '16px', padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: 'inset 0 0 20px rgba(0,0,0,0.2)' }}>
        <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '11px', marginBottom: '8px' }}>--- 歷史紀錄 ---</div>
        
        {messages.map((m, idx) => {
          const isMe = m.author === myDisplayName || m.author === "Me";
          const isSystemBot = m.isBot && !m.text?.startsWith('[Web]');

          // 解析文字內容（先跳脫 HTML 防止 XSS）
          let parsedText = escapeHtml(m.text || '');
          // Discord emoji
          parsedText = parsedText.replace(/&lt;(a?):(\w+):(\d+)&gt;/g, (_, animated, name, id) => {
            const ext = animated ? 'gif' : 'png';
            return `<img src="https://cdn.discordapp.com/emojis/${id}.${ext}" alt=":${name}:" class="chat-emoji" />`;
          });
          // Discord CDN / media 圖片連結（貼圖）→ 渲染成圖片
          parsedText = parsedText.replace(
            /(https:\/\/(?:media|cdn)\.discordapp\.(?:net|com)\/(?:stickers|attachments)\/[^\s"<>]+\.(?:png|gif|jpg|jpeg|webp)(?:\?[^\s"<>]*)?)/gi,
            (url) => `<img src="${url}" alt="sticker" style="max-width:140px;max-height:140px;border-radius:8px;display:block;margin-top:4px;" />`
          );
          // **粗體** markdown
          parsedText = parsedText.replace(/\*\*(.*?)\*\*/g, '<strong style="color:#f0e6d3">$1</strong>');
          // 提到
          parsedText = parsedText.replace(/\[@(.*?)\]/g, '<span class="mention">@$1</span>');

          // ── 系統廣播（Bot 非 Web 轉發）→ 橫幅樣式 ──
          if (isSystemBot) {
            return (
              <div key={m.id || idx} style={{
                alignSelf: 'stretch',
                background: 'rgba(200,169,110,0.06)',
                border: '1px solid rgba(200,169,110,0.25)',
                borderLeft: '3px solid rgba(200,169,110,0.7)',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '13px',
                color: '#f0e6d3',
                lineHeight: 1.6,
              }}
                dangerouslySetInnerHTML={{ __html: parsedText }}
              />
            );
          }

          return (
            <div key={m.id || idx} style={{ display: 'flex', gap: '10px', alignSelf: isMe ? 'flex-end' : 'flex-start', flexDirection: isMe ? 'row-reverse' : 'row' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: isMe ? 'rgba(200,169,110,0.3)' : 'var(--surface-hover)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold', overflow: 'hidden', border: `1px solid ${isMe ? 'rgba(200,169,110,0.5)' : 'var(--glass-border)'}` }}>
                {m.avatar ? <img src={m.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : m.author.substring(0, 2).toUpperCase()}
              </div>
              <div style={{ alignItems: isMe ? 'flex-end' : 'flex-start', display: 'flex', flexDirection: 'column', maxWidth: '85%' }}>
                <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {!isMe && <span style={{ fontWeight: 'bold', color: 'var(--gold)' }}>{m.author}</span>}
                  <span>{m.time}</span>
                </div>
                {m.replyTo && (
                  <div style={{
                    fontSize: '11px', color: 'var(--muted)',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid var(--glass-border)',
                    borderLeft: '3px solid rgba(200,169,110,0.5)',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    marginBottom: '4px',
                    maxWidth: '100%',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                  }}>
                    <span style={{ color: 'var(--gold)', fontWeight: 600 }}>↩ {m.replyTo.author}</span>
                    {m.replyTo.content && <span style={{ marginLeft: '6px', opacity: 0.7 }}>{m.replyTo.content.slice(0, 60)}{m.replyTo.content.length > 60 ? '…' : ''}</span>}
                  </div>
                )}
                <div
                  style={{
                    background: isMe ? 'rgba(200,169,110,0.18)' : 'rgba(255,255,255,0.05)',
                    color: '#f0e6d3',
                    padding: '10px 14px',
                    borderRadius: isMe ? '14px 0 14px 14px' : '0 14px 14px 14px',
                    fontSize: '14px',
                    wordBreak: 'break-word',
                    whiteSpace: 'pre-line',
                    lineHeight: 1.6,
                    border: `1px solid ${isMe ? 'rgba(200,169,110,0.3)' : 'var(--glass-border)'}`,
                  }}
                  dangerouslySetInnerHTML={{ __html: parsedText }}
                />
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* 表情/貼圖選擇器 */}
      {showPicker && (
        <div style={{
          position: 'absolute', bottom: '58px', left: '12px', right: '12px',
          background: 'rgba(6,8,15,0.97)', border: '1px solid var(--glass-border)',
          borderRadius: '12px', zIndex: 50, overflow: 'hidden',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.6)',
        }}>
          {/* Tab 列 */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--glass-border)' }}>
            {[{ key: 'emoji', label: '表情' }, { key: 'sticker', label: '貼圖' }].map(t => (
              <button key={t.key} onClick={() => setPickerTab(t.key)} style={{
                flex: 1, padding: '8px', background: 'none', border: 'none',
                color: pickerTab === t.key ? 'var(--gold)' : 'var(--muted)',
                borderBottom: pickerTab === t.key ? '2px solid var(--gold)' : '2px solid transparent',
                cursor: 'pointer', fontSize: '12px', fontFamily: 'var(--font-display)',
                letterSpacing: '0.08em', transition: 'color 0.15s',
              }}>{t.label}</button>
            ))}
            <button onClick={() => setShowPicker(false)} style={{
              background: 'none', border: 'none', color: 'var(--muted)',
              cursor: 'pointer', padding: '8px 12px', fontSize: '14px',
            }}>✕</button>
          </div>

          {/* 內容 */}
          <div style={{ maxHeight: '180px', overflowY: 'auto', padding: '8px' }}>
            {pickerTab === 'emoji' && (
              expressions.emojis.length === 0
                ? <p style={{ color: 'var(--muted)', fontSize: '12px', textAlign: 'center', padding: '20px 0' }}>無伺服器表情</p>
                : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                    {expressions.emojis.map(e => (
                      <button key={e.id} onClick={() => handleSendExpression(e)} title={`:${e.name}:`} style={{
                        background: 'none', border: 'none', borderRadius: '6px', cursor: 'pointer',
                        padding: '4px', transition: 'background 0.15s', aspectRatio: '1',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                        onMouseOver={e2 => e2.currentTarget.style.background = 'rgba(200,169,110,0.12)'}
                        onMouseOut={e2 => e2.currentTarget.style.background = 'none'}
                      >
                        <img src={e.url} alt={e.name} style={{ width: '28px', height: '28px', objectFit: 'contain' }} />
                      </button>
                    ))}
                  </div>
            )}
            {pickerTab === 'sticker' && (
              expressions.stickers.length === 0
                ? <p style={{ color: 'var(--muted)', fontSize: '12px', textAlign: 'center', padding: '20px 0' }}>無伺服器貼圖</p>
                : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                    {expressions.stickers.filter(s => !s.isLottie).map(s => (
                      <button key={s.id} onClick={() => handleSendExpression(s)} title={s.name} style={{
                        background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)',
                        borderRadius: '8px', cursor: 'pointer', padding: '6px',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
                        transition: 'border-color 0.15s',
                      }}
                        onMouseOver={e2 => e2.currentTarget.style.borderColor = 'rgba(200,169,110,0.5)'}
                        onMouseOut={e2 => e2.currentTarget.style.borderColor = 'var(--glass-border)'}
                      >
                        <img src={s.url} alt={s.name} style={{ width: '56px', height: '56px', objectFit: 'contain' }} />
                        <span style={{ fontSize: '8px', color: 'var(--muted)', textAlign: 'center', wordBreak: 'break-all' }}>{s.name}</span>
                      </button>
                    ))}
                  </div>
            )}
          </div>
        </div>
      )}

      {/* 輸入列 */}
      <div style={{ marginTop: '12px', display: 'flex', gap: '6px', flexShrink: 0, alignItems: 'center' }}>
        {/* 表情按鈕 */}
        <button onClick={() => setShowPicker(p => !p)} style={{
          background: showPicker ? 'rgba(200,169,110,0.12)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${showPicker ? 'rgba(200,169,110,0.5)' : 'var(--glass-border)'}`,
          borderRadius: '10px', cursor: 'pointer', padding: '0 10px', height: '44px',
          fontSize: '18px', transition: 'all 0.15s', flexShrink: 0,
        }}>🎭</button>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="發送訊息至 Discord..."
          style={{ flex: 1, padding: '11px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--glass-border)', color: '#f0e6d3', fontSize: '14px', outline: 'none' }}
        />
        <button className="btn btn-primary" onClick={() => handleSend()} style={{ width: 'auto', padding: '0 16px', height: '44px', flexShrink: 0 }}>送</button>
      </div>
    </div>
  );
}

// ===== 設定分頁 =====
function SettingsTab({ audioRef, bgmMuted, onToggleBgm, volume, onVolumeChange, onLogout }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 音樂區塊 */}
      <div className="card" style={{ marginBottom: 0 }}>
        <p style={{ margin: '0 0 14px', fontSize: '0.8rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>背景音樂</p>

        {/* 開關 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
          <span style={{ fontSize: '0.95rem' }}>{bgmMuted ? '🔇 已靜音' : '🔈 播放中'}</span>
          <button onClick={onToggleBgm} style={{
            padding: '6px 18px', borderRadius: '20px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
            background: bgmMuted ? 'var(--surface-hover)' : 'var(--accent)',
            color: '#fff', border: 'none', transition: 'all 0.2s',
          }}>
            {bgmMuted ? '開啟' : '關閉'}
          </button>
        </div>

        {/* 音量滑桿 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--muted)' }}>
            <span>音量</span>
            <span>{Math.round(volume * 100)}%</span>
          </div>
          <input type="range" min="0" max="1" step="0.01" value={volume}
            onChange={e => onVolumeChange(parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
          />
        </div>
      </div>

      {/* 登出 */}
      <div className="card" style={{ marginBottom: 0 }}>
        <p style={{ margin: '0 0 14px', fontSize: '0.8rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>帳號</p>
        <button className="btn" onClick={onLogout}
          style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}>
          登出
        </button>
      </div>
    </div>
  );
}

// ── 每週任務分頁 ─────────────────────────────────────────────
function WeeklyQuestTab() {
  const [quests, setQuests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getWeeklyQuests();
      setQuests(data || []);
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const claim = async (questId) => {
    setClaiming(questId);
    setMsg(null);
    try {
      const reward = await api.claimWeeklyReward(questId);
      const parts = [];
      if (reward.gold)          parts.push(`${reward.gold} 🪙`);
      if (reward.diamond)       parts.push(`${reward.diamond} 💎`);
      if (reward.rewardItemName) parts.push(reward.rewardItemName);
      setMsg({ type: 'ok', text: `✅ 已領取「${reward.questTitle}」獎勵：${parts.join('、') || '—'}` });
      await load();
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally {
      setClaiming(null);
    }
  };

  const weekLabel = (() => {
    const now = new Date();
    const jan1 = new Date(now.getFullYear(), 0, 1);
    const week = Math.ceil(((now - jan1) / 86400000 + jan1.getDay() + 1) / 7);
    return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
  })();

  return (
    <div className="app-screen" style={{ overflowY: 'auto', paddingBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 6px' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--gold)' }}>📋 每週任務</h2>
        <span style={{ fontSize: '11px', color: 'var(--muted)' }}>{weekLabel}</span>
      </div>

      {msg && (
        <div style={{
          margin: '8px 16px', padding: '10px 14px', borderRadius: '8px', fontSize: '13px',
          background: msg.type === 'ok' ? 'rgba(74,222,128,0.12)' : 'rgba(239,68,68,0.12)',
          color: msg.type === 'ok' ? '#4ade80' : '#f87171',
          border: `1px solid ${msg.type === 'ok' ? 'rgba(74,222,128,0.25)' : 'rgba(239,68,68,0.25)'}`,
        }}>{msg.text}</div>
      )}

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>載入中…</div>
      ) : quests.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>本週尚無任務</div>
      ) : (
        <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {quests.map(({ quest, current, claimed, done }) => {
            const pct = Math.min(100, Math.round((current / Math.max(quest.target, 1)) * 100));
            const rewards = [];
            if (quest.rewardGold)    rewards.push(`${quest.rewardGold} 🪙`);
            if (quest.rewardDiamond) rewards.push(`${quest.rewardDiamond} 💎`);
            if (quest.rewardItemId)  rewards.push('道具');
            return (
              <div key={quest.id} className="card" style={{ padding: '14px 16px', marginBottom: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: claimed ? 'var(--muted)' : 'var(--text)' }}>
                      {quest.title}
                    </div>
                    {quest.description && (
                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>{quest.description}</div>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)', textAlign: 'right', whiteSpace: 'nowrap', marginLeft: '8px' }}>
                    {rewards.length ? rewards.join(' ') : '—'}
                  </div>
                </div>

                {/* 進度條 */}
                <div style={{ height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', marginBottom: '8px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: '3px', transition: 'width 0.4s',
                    width: `${pct}%`,
                    background: claimed ? 'rgba(200,169,110,0.3)' : done ? 'var(--gold)' : 'var(--accent)',
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    {current} / {quest.target}
                  </span>
                  {claimed ? (
                    <span style={{ fontSize: '12px', color: 'var(--muted)' }}>✅ 已領取</span>
                  ) : done ? (
                    <button className="btn" onClick={() => claim(quest.id)} disabled={claiming === quest.id}
                      style={{ padding: '4px 14px', fontSize: '12px', opacity: claiming === quest.id ? 0.6 : 1 }}>
                      {claiming === quest.id ? '領取中…' : '🎁 領取獎勵'}
                    </button>
                  ) : (
                    <span style={{ fontSize: '12px', color: 'var(--muted)' }}>🔲 進行中</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState('home');
  const [isInitializing, setIsInitializing] = useState(true);
  const [loginError, setLoginError] = useState(null); // null | 'NOT_GUILD_MEMBER' | 'ERROR'
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showMoreDrawer, setShowMoreDrawer] = useState(false);
  const [showWeeklyTab, setShowWeeklyTab] = useState(false);
  const [rewardToast, setRewardToast] = useState(null); // { monsterName, gold, exp, drops }
  const [rewardToastOpen, setRewardToastOpen] = useState(false);
  const [notifications, setNotifications] = useState([]); // 通知歷史紀錄
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const audioRef = useRef(null);
  const [bgmMuted, setBgmMuted] = useState(false);
  const [volume, setVolume] = useState(0.35);

  const toggleBgm = () => {
    if (!audioRef.current) return;
    if (bgmMuted) {
      audioRef.current.play().catch(() => {});
    } else {
      audioRef.current.pause();
    }
    setBgmMuted(m => !m);
  };

  const handleVolumeChange = (v) => {
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  };

  const handleLogout = () => {
    setToken(null);
    setIsAuthenticated(false);
  };

  // 全域 SSE + polling fallback：監聽獎勵通知
  useEffect(() => {
    if (!isAuthenticated) return;
    const toastTimerRef = { current: null };

    function handleReward(summary) {
      const notif = { ...summary, id: Date.now(), time: new Date().toLocaleTimeString() };
      setNotifications(prev => [notif, ...prev].slice(0, 50));
      setUnreadCount(c => c + 1);
      setRewardToast(notif);
      setRewardToastOpen(true);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setRewardToastOpen(false), 5000);
    }

    // SSE（本機直連有效）
    const es = api.createChatStream(() => {}, { onReward: handleReward });

    // Polling fallback（每 8 秒，Cloudflare 等 proxy 環境用）
    const pollInterval = setInterval(async () => {
      try {
        const items = await api.pollNotifications();
        if (Array.isArray(items)) items.forEach(handleReward);
      } catch (_) {}
    }, 8000);

    return () => {
      es.close();
      clearInterval(pollInterval);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [isAuthenticated]);

  // 背景音樂：首次使用者互動後自動播放
  useEffect(() => {
    const audio = new Audio(`${import.meta.env.BASE_URL}op.ogg`);
    audio.loop = true;
    audio.volume = 0.35;
    audioRef.current = audio;

    const tryPlay = () => {
      if (!audioRef.current) return;
      audioRef.current.play().catch(() => {});
    };
    window.addEventListener('pointerdown', tryPlay, { once: true });
    window.addEventListener('keydown', tryPlay, { once: true });

    return () => {
      window.removeEventListener('pointerdown', tryPlay);
      window.removeEventListener('keydown', tryPlay);
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  // Check URL for ?code= (Discord OAuth Callback)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const authCode = urlParams.get('code');

    if (authCode) {
      api.loginWithDiscord(authCode).then(data => {
        setToken(data.token);
        window.history.replaceState({}, document.title, import.meta.env.BASE_URL || '/');
        setIsAuthenticated(true);
        setIsInitializing(false);
      }).catch(err => {
        console.error("Login failed", err);
        window.history.replaceState({}, document.title, import.meta.env.BASE_URL || '/');
        if (err.code === 'NOT_GUILD_MEMBER') {
          setLoginError('NOT_GUILD_MEMBER');
        } else {
          setLoginError('ERROR');
        }
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

  if (loginError === 'NOT_GUILD_MEMBER') return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', padding: '2.5rem 2rem', textAlign: 'center',
      background: 'linear-gradient(175deg, #04060e 0%, #08091a 50%, #060c18 100%)',
      gap: 0,
    }}>
      <div style={{ width: '100%', height: '1px', position: 'absolute', top: 0, background: 'linear-gradient(to right, transparent, rgba(200,169,110,0.6), transparent)' }} />

      <div style={{ fontSize: '3rem', marginBottom: '1.2rem', opacity: 0.7 }}>🚪</div>

      <h2 style={{
        fontFamily: 'var(--font-display)', fontSize: '1.3rem', letterSpacing: '0.1em',
        background: 'linear-gradient(135deg, #c8a96e, #e8c97a)',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        margin: '0 0 0.6rem',
      }}>
        尚未加入社群
      </h2>

      <div style={{ width: '60px', height: '1px', background: 'linear-gradient(to right, transparent, var(--gold), transparent)', margin: '0.8rem 0 1rem' }} />

      <p style={{ fontSize: '13px', color: 'rgba(200,169,110,0.5)', lineHeight: 1.8, margin: '0 0 0.4rem', letterSpacing: '0.04em' }}>
        這裡是限社員使用的空間。
      </p>
      <p style={{ fontSize: '13px', color: 'rgba(200,169,110,0.4)', lineHeight: 1.8, margin: '0 0 2rem', letterSpacing: '0.04em' }}>
        加入 Discord 伺服器後就可以一起玩囉！
      </p>

      <a href="https://discord.gg/xnCSmQazfr" target="_blank" rel="noopener noreferrer" style={{
        display: 'inline-flex', alignItems: 'center', gap: '10px',
        padding: '13px 28px',
        background: 'linear-gradient(135deg, #4752c4, #5865F2)',
        color: '#fff', borderRadius: '2px', fontSize: '0.9rem',
        fontWeight: 700, textDecoration: 'none',
        boxShadow: '0 4px 20px rgba(88,101,242,0.4)',
        letterSpacing: '0.08em', fontFamily: 'var(--font-display)',
        border: '1px solid rgba(120,140,255,0.3)',
        transition: 'all 0.2s',
        marginBottom: '1rem',
      }}
        onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 28px rgba(88,101,242,0.55)'; }}
        onMouseOut={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(88,101,242,0.4)'; }}
      >
        <Icons.Discord />
        加入音無玄學棋牌社
      </a>

      <button onClick={() => setLoginError(null)} style={{
        background: 'transparent', border: 'none',
        color: 'rgba(200,169,110,0.3)', fontSize: '11px',
        cursor: 'pointer', letterSpacing: '0.08em', fontFamily: 'var(--font-display)',
        padding: '6px',
      }}>
        ← 返回登入頁
      </button>
    </div>
  );

  if (!isAuthenticated) return <LoginScreen />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'home' && <HomeTab onNavigate={setActiveTab} unreadCount={unreadCount} onOpenNotif={() => { setUnreadCount(0); setShowNotifModal(true); }} />}
        {activeTab === 'profile' && <ProfileTab onOpenSettings={() => setShowSettingsModal(true)} />}
        {activeTab === 'inventory' && <InventoryTab />}
        {activeTab === 'combat' && <CombatTab />}
        {activeTab === 'shop' && <ShopTab />}
        {activeTab === 'chat' && <ChatTab />}
      </div>

      {/* 設定 Modal（A：從角色頁 ⚙️ 觸發）*/}
      {showSettingsModal && (
        <div className="modal-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxHeight: '70vh' }}>
            <div className="modal-header">
              <span style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: '14px', letterSpacing: '0.1em' }}>設定</span>
              <button onClick={() => setShowSettingsModal(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '20px', lineHeight: 1 }}>✕</button>
            </div>
            <div className="modal-body">
              <SettingsTab
                audioRef={audioRef}
                bgmMuted={bgmMuted}
                onToggleBgm={toggleBgm}
                volume={volume}
                onVolumeChange={handleVolumeChange}
                onLogout={() => { setShowSettingsModal(false); handleLogout(); }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 每週任務全螢幕覆蓋 */}
      {showWeeklyTab && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 210, background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', borderBottom: '1px solid var(--glass-border)' }}>
            <button onClick={() => setShowWeeklyTab(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: 0 }}>←</button>
            <span style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: '14px', letterSpacing: '0.08em' }}>每週任務</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <WeeklyQuestTab />
          </div>
        </div>
      )}

      {/* 更多抽屜（B：從導覽列 ··· 觸發）*/}
      {showMoreDrawer && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200 }} onClick={() => setShowMoreDrawer(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            position: 'absolute', bottom: 'var(--nav-height)', left: 0, right: 0,
            background: 'rgba(8,10,22,0.98)', borderTop: '1px solid var(--glass-border)',
            borderRadius: '16px 16px 0 0',
            padding: '8px 0 4px',
            boxShadow: '0 -8px 40px rgba(0,0,0,0.7)',
            animation: 'modal-up 0.22s cubic-bezier(0.16,1,0.3,1)',
          }}>
            {/* 拖曳指示條 */}
            <div style={{ width: '36px', height: '3px', background: 'rgba(200,169,110,0.25)', borderRadius: '2px', margin: '0 auto 12px' }} />
            <p style={{ margin: '0 20px 8px', fontSize: '10px', color: 'var(--muted)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>更多功能</p>

            {/* 設定入口 */}
            <div onClick={() => { setShowMoreDrawer(false); setShowSettingsModal(true); }} style={{
              display: 'flex', alignItems: 'center', gap: '14px',
              padding: '14px 20px', cursor: 'pointer', transition: 'background 0.15s',
            }}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(200,169,110,0.07)'}
              onMouseOut={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ color: 'var(--gold)', display: 'flex' }}><Icons.Settings /></span>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>設定</div>
                <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '1px' }}>音樂、音量、帳號</div>
              </div>
            </div>

            <div style={{ height: '1px', background: 'var(--line)', margin: '0 20px' }} />

            {/* 每週任務 */}
            <div onClick={() => { setShowMoreDrawer(false); setShowWeeklyTab(true); }} style={{
              display: 'flex', alignItems: 'center', gap: '14px',
              padding: '14px 20px', cursor: 'pointer', transition: 'background 0.15s',
            }}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(200,169,110,0.07)'}
              onMouseOut={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ color: 'var(--gold)', display: 'flex', fontSize: '18px' }}>📋</span>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>每週任務</div>
                <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '1px' }}>查看進度、領取獎勵</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 其他玩家擊殺獎勵 Toast（LINE 風格從頂部滑入）*/}
      {rewardToast && (
        <div
          className={`notif-toast ${rewardToastOpen ? 'entering' : 'leaving'}`}
          onClick={() => setRewardToastOpen(false)}
          style={{ display: rewardToast ? 'flex' : 'none' }}
        >
          {/* 左側 icon */}
          <div style={{ fontSize: '22px', lineHeight: 1, flexShrink: 0, marginTop: '1px' }}>🔔</div>
          {/* 內容 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
              <span style={{ fontSize: '11px', color: 'var(--gold)', fontWeight: 700, letterSpacing: '0.08em' }}>
                獲得怪物討伐獎勵
              </span>
              {rewardToast.monsterName && (
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>— {rewardToast.monsterName}</span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--muted)', flexShrink: 0 }}>{rewardToast.time}</span>
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {rewardToast.exp > 0 && (
                <span style={{ fontSize: '12px', color: '#60c0ff' }}>
                  ✨ +{rewardToast.exp.toLocaleString()} EXP
                  {rewardToast.levelUps > 0 && <span style={{ color: '#ffd700', marginLeft: '4px' }}>▲LV+{rewardToast.levelUps}</span>}
                </span>
              )}
              {rewardToast.gold > 0 && (
                <span style={{ fontSize: '12px', color: 'var(--gold)' }}>💰 +{rewardToast.gold.toLocaleString()}</span>
              )}
              {rewardToast.drops && rewardToast.drops.length > 0 && (
                <span style={{ fontSize: '12px', color: '#a88cff' }}>
                  📦 {rewardToast.drops.map(d => d.name || d).join(', ')}
                </span>
              )}
            </div>
          </div>
          <span style={{ fontSize: '14px', color: 'var(--muted)', flexShrink: 0, alignSelf: 'flex-start' }}>✕</span>
        </div>
      )}

      {/* 通知歷史 Modal */}
      {showNotifModal && (
        <div className="modal-overlay" onClick={() => setShowNotifModal(false)} style={{ zIndex: 800 }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxHeight: '75vh' }}>
            <div className="modal-header">
              <span style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: '14px', letterSpacing: '0.1em' }}>
                🔔 通知紀錄
              </span>
              <button onClick={() => setShowNotifModal(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '20px', lineHeight: 1 }}>✕</button>
            </div>
            <div className="modal-body" style={{ padding: '12px' }}>
              {notifications.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '13px', padding: '24px 0' }}>尚無通知</p>
              ) : notifications.map(n => (
                <div key={n.id} style={{
                  padding: '10px 12px', marginBottom: '8px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: '8px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--gold)', fontWeight: 700 }}>
                      {n.monsterName || '怪物'} 討伐獎勵
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--muted)' }}>{n.time}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {n.exp > 0 && <span style={{ fontSize: '12px', color: '#60c0ff' }}>✨ +{n.exp.toLocaleString()} EXP{n.levelUps > 0 ? ` ▲LV+${n.levelUps}` : ''}</span>}
                    {n.gold > 0 && <span style={{ fontSize: '12px', color: 'var(--gold)' }}>💰 +{n.gold.toLocaleString()}</span>}
                    {n.drops && n.drops.length > 0 && <span style={{ fontSize: '12px', color: '#a88cff' }}>📦 {n.drops.map(d => d.name || d).join(', ')}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className="bottom-nav">
        <div className={`nav-item ${activeTab === 'home' ? 'active' : ''}`} onClick={() => setActiveTab('home')}>
          <Icons.Home />
          <span>首頁</span>
        </div>
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
        <div className={`nav-item ${showMoreDrawer ? 'active' : ''}`} onClick={() => setShowMoreDrawer(d => !d)}>
          <Icons.More />
          <span>更多</span>
        </div>
      </nav>
    </div>
  );
}
