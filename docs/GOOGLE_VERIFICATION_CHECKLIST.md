# Google OAuth Verification 申請完整指南

> **目的**：將 equipmentGAME 的 YouTube OAuth app 從 **Testing** 升級為 **Production / Verified**，永久解決 broadcaster refresh_token 每 7 天失效問題。
>
> **預估時程**：準備 1-2 天，Google 審核 2-8 週（敏感 scope 通常較久）
>
> **適用 scope**：`https://www.googleapis.com/auth/youtube.channel-memberships.creator`（**Sensitive Scope** — 需完整 verification）

---

## 📋 申請前置 Checklist

### A. 域名與網頁準備
- [ ] **公開可訪問的首頁** → `https://otonashikoi.org/`
  - 需清楚說明服務名稱、功能、用途
  - 至少包含：服務簡介、功能截圖 / 影片、聯絡方式
- [ ] **隱私權政策** → `https://otonashikoi.org/privacy`
  - 用 `docs/PRIVACY_POLICY.md` 內容
  - 需明確提到 Google API 使用方式（已寫好第 4 條）
- [ ] **服務條款** → `https://otonashikoi.org/terms`（選擇性，建議有）
  - 用 `docs/TERMS_OF_SERVICE.md` 內容
- [ ] **域名所有權驗證**
  - 至 [Google Search Console](https://search.google.com/search-console)
  - Add Property → URL Prefix → `https://otonashikoi.org`
  - 用 HTML file / DNS TXT / meta tag 任一方式驗證
  - **必須通過驗證**才能在 OAuth 設定填入 authorized domain

### B. Google Cloud Console 設定
- [ ] 至 [Google Cloud Console](https://console.cloud.google.com/) 開啟你的 project
- [ ] **APIs & Services** → **Enabled APIs**：確認已啟用 `YouTube Data API v3`
- [ ] **APIs & Services** → **OAuth consent screen**：
  - User Type：**External**
  - App name：**equipmentGAME**
  - User support email：**otonashikoi1228@gmail.com**
  - App logo：**上傳 120x120 PNG**（建議含遊戲 Logo + 文字）
  - App domain：
    - Application home page → `https://otonashikoi.org`
    - Application privacy policy link → `https://otonashikoi.org/privacy`
    - Application terms of service link → `https://otonashikoi.org/terms`
  - Authorized domains → `otonashikoi.org`（需先在 Search Console 驗證）
  - Developer contact information → `otonashikoi1228@gmail.com`
- [ ] **Scopes** 頁面：新增以下 scope
  - `.../auth/userinfo.email`（non-sensitive）
  - `.../auth/userinfo.profile`（non-sensitive）
  - `.../auth/youtube.readonly`（restricted，需理由）
  - `.../auth/youtube.channel-memberships.creator`（restricted，需詳細理由）

### C. App Logo 設計建議
- 尺寸：**120 × 120 px**
- 格式：**PNG**（建議透明背景）
- 內容：包含 equipmentGAME logo 圖樣 + 可選的文字
- 風格建議：可用 Higgsfield AI 生成（提示詞範例：「Game logo icon, 120x120, transparent background, JRPG style, sword and shield emblem, equipmentGAME text」）

---

## 🎥 Demo Video 腳本（必繳）

Google 要求一段 **YouTube unlisted 影片**，展示：
1. OAuth 流程實際運作
2. 取得的 scope 如何在服務中使用
3. 用戶能看到 OAuth 同意畫面
4. 隱私政策連結可訪問

**建議長度**：**2-4 分鐘**（不超過 5 分鐘）

### 影片分段腳本

#### 【段 1 — 服務介紹（30 秒）】
> 「Hi, I'm the developer of equipmentGAME, a Discord game bot at https://otonashikoi.org. 
> 
> This is a multiplayer RPG that integrates with Discord, Twitch, and YouTube. Players can link their YouTube account so the game can grant them exclusive in-game rewards based on their channel membership status.」

畫面：開啟 `https://otonashikoi.org/`，捲動展示首頁

#### 【段 2 — Production URL 展示（15 秒）】
> 「Here is the production website at otonashikoi.org. You can clearly see the app name, the privacy policy link at the bottom, and the terms of service.」

畫面：滾到 footer 露出 privacy / terms 連結，點開隱私權頁面看一眼

#### 【段 3 — OAuth Flow（90 秒）】
> 「Let me demonstrate the YouTube OAuth flow. As a player, I go to settings and click 'Link YouTube'.」

畫面：登入服務 → /settings → 點 YouTube 連結

> 「This redirects me to Google's official OAuth consent screen. You can see Google asks me to grant the equipmentGAME application access to my YouTube account membership data.」

畫面：Google OAuth consent 畫面（顯示 scope）

> 「After clicking Allow, I'm redirected back to equipmentGAME where the YouTube account is now linked.」

畫面：授權後跳回 /settings 顯示綁定成功

#### 【段 4 — Scope 使用展示（60 秒）】
> 「Now let's see how the requested scope is used. The system uses the `youtube.channel-memberships.creator` scope to check if the player is a member of a specific YouTube channel — the channel owner of the streamer running this Discord server.」

畫面：開啟某玩家面板，顯示「YouTube 會員 ✓」標籤

> 「If they are a member, the player receives exclusive in-game rewards like bonus gold and rare items. The scope is used ONLY for this membership verification. We do not read videos, comments, playlists, or any other YouTube data.」

畫面：展示獎勵發放截圖 / Discord 通知

#### 【段 5 — Privacy & Data Handling（30 秒）】
> 「All data handling is described in our privacy policy at otonashikoi.org/privacy. We follow Google's Limited Use policy strictly. We do not transfer YouTube data to third parties, do not use it for advertising, and do not allow human review except as required by law.」

畫面：再次秀隱私政策頁面，捲到「Google API 使用聲明」段落

#### 【段 6 — 結尾（15 秒）】
> 「Thank you for reviewing equipmentGAME. If you have any questions, please contact otonashikoi1228 at gmail.com.」

畫面：服務首頁 + 聯絡 email

### 影片錄製建議

| 項目 | 建議 |
|---|---|
| 錄影軟體 | OBS Studio（免費） |
| 解析度 | 1080p 或更高 |
| 上傳 | YouTube → **Unlisted**（不要 Public，不要 Private） |
| 標題 | `equipmentGAME OAuth Verification Demo` |
| 描述 | 「Demo video for Google OAuth verification of equipmentGAME (otonashikoi.org). Scope: youtube.channel-memberships.creator」 |

---

## 📝 Scope 使用理由（OAuth 申請表單必填）

填寫 **OAuth Consent Screen** → **Scopes** → 每個敏感 scope 的「Justification」時：

### `youtube.readonly` 理由（英文版）
```
The equipmentGAME service uses this scope to retrieve the user's YouTube
channel ID and display name during the initial account linking process.
This information is used solely to identify the user's YouTube account
within our game database. We do not access videos, playlists, comments,
or subscription data.
```

### `youtube.channel-memberships.creator` 理由（英文版）
```
The equipmentGAME service uses this scope to verify whether a player is
a current channel member of specific streamer/creator channels associated
with our Discord server. Membership status is checked at sign-in and
periodically refreshed. We use this information exclusively to grant
in-game rewards (bonus gold, exclusive items) to verified channel members.

The membership verification happens server-side via the
`youtube.channelMemberships.list` endpoint with the `mode=all_current`
filter. We only check whether the user is a member — we do NOT access:
- Member-only video content
- Subscriber/member email addresses
- Membership tier names beyond what's strictly necessary to determine eligibility
- Any data from non-participating YouTube channels

The granted token is securely stored, encrypted at rest, and never
transmitted to third parties. Users can revoke access at any time via
https://myaccount.google.com/permissions or our in-app settings.
```

---

## 🗂️ 申請流程步驟

### Step 1：完成 Cloud Console 所有設定
按上方 Section B 把每一欄填齊、Logo 上傳、Authorized domain 通過驗證。

### Step 2：點「Publish App」
在 OAuth consent screen 頁面，點 **Publish App** → 確認進入 **In production** 但 **未驗證**狀態。

### Step 3：申請 Verification
頁面會顯示 **Submit for verification** 按鈕，點下去後 Google 會引導你填寫：
- 每個敏感 scope 的 justification（貼上方範例）
- Demo video YouTube 連結
- 確認隱私政策、首頁、條款 URL 可訪問

### Step 4：送出後等待
- Google 會寄信給 `otonashikoi1228@gmail.com`
- 一般 **2-8 週**內回覆
- 可能要求補件（最常見：影片不清楚 / scope 理由不充分 / 隱私政策缺少 Limited Use 聲明）

### Step 5：補件循環
若被要求補件，**24-48 小時內**回覆能加快流程。
被要求最多的補件：
- 影片沒清楚展示 OAuth consent screen 上的「Continue」按鈕
- 隱私政策沒明確提到 `youtube.channel-memberships.creator`
- 沒有展示 scope 在實際 UI 中的使用畫面

---

## ⚠️ 常見退件原因

| 問題 | 預防方式 |
|---|---|
| 域名未驗證 | Search Console 必須先通過 |
| 隱私政策缺 Google Limited Use 段落 | 已在 `PRIVACY_POLICY.md` 第 4 條寫入 |
| 影片無法觀看 | 確認上傳為 **Unlisted**（不要 Private） |
| 影片沒展示 OAuth 同意畫面 | 嚴格按上方段 3 腳本錄 |
| App logo 未上傳或不符規格 | 必須 120×120 PNG，內容清楚 |
| Production URL 不可訪問 | 確認 cloudflared tunnel 持續運作 |
| Scope 理由太模糊 | 用上方提供的英文範本 |
| 過去 30 天沒有 OAuth 流量 | 確保已有實際使用者授權記錄 |

---

## 🔍 申請後監控

通過後請定期：
- 每月確認 [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent) 狀態仍為 **Verified**
- 留意 Google 政策更新郵件（特別是 `noreply-cloudsupport@google.com`）
- 不要刪除已上傳的影片
- 隱私政策更新時，**重新提交 verification**（小修改可不重提，大修改必重提）

---

## 📊 對照：Verified vs Unverified

| 項目 | Testing（未驗證） | Production（已驗證） |
|---|---|---|
| Refresh token 壽命 | **7 天** | **永久**（除非用戶撤銷、改密碼、90 天不用） |
| 用戶上限 | 100 名測試帳號 | 無上限 |
| 警告畫面 | 「未經 Google 驗證」紅字警告 | 無 |
| User Cap 規定 | 需手動 invite 測試用戶 | 任何人可登入 |
| 適合場景 | 開發測試 | 正式營運 |

---

## 🆘 緊急聯絡

- Google OAuth verification 客服：透過 Cloud Console → Help → Submit Case
- 一般 Cloud 帳號問題：https://support.google.com/cloud
- 申請進度追蹤：申請後可在 OAuth consent screen 看到狀態列

---

## ✅ Final Checklist 印出來逐項打勾

- [ ] Search Console 已驗證 `otonashikoi.org`
- [ ] `https://otonashikoi.org/` 公開可訪問
- [ ] `https://otonashikoi.org/privacy` 公開可訪問（含 Google Limited Use 聲明）
- [ ] `https://otonashikoi.org/terms` 公開可訪問
- [ ] OAuth consent screen 所有欄位填齊
- [ ] App Logo 120×120 PNG 已上傳
- [ ] Authorized domain 加入 `otonashikoi.org`
- [ ] 兩個敏感 scope 已加入並填寫 justification
- [ ] Demo video 已錄製 + 上傳為 Unlisted
- [ ] Publish App → 確認進入 Production
- [ ] Submit for verification → 等回信
- [ ] Email 信箱保持暢通 24/7（補件要快回）
