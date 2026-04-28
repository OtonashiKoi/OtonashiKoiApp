# Equipment RPG App

Flutter 原生橫向 APP，用現有 Node/Discord 遊戲 API 當後端。

## 目前完成

- 橫向沉浸式首頁
- 玩家資料、金幣、鑽石、背包、怪物區資料 API 對接
- 怪物區切換
- 底部功能入口與右下出戰按鈕
- 出戰呼叫 `/api/combat/quick-battle`

## 建置方式

這台機器目前沒有 Flutter SDK，所以尚未產生 `android/`、`ios/` 平台資料夾。到有 Flutter 的環境後執行：

```powershell
cd c:\Users\appsk\Documents\Github\equipmentGAME\mobile-rpg-app
flutter create --platforms=android,ios .
flutter pub get
flutter run --dart-define=API_BASE_URL=http://127.0.0.1:5566
```

手機實機測試時，`API_BASE_URL` 要改成電腦在區網中的 IP，例如：

```powershell
flutter run --dart-define=API_BASE_URL=http://192.168.1.10:5566
```
