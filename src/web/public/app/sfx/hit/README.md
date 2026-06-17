# 武器打擊音效 (戰鬥打出傷害時播放)

把音檔放這裡,檔名固定為下列 7 個(格式建議 mp3,單檔建議 < 100KB、長度 0.1~0.4 秒):

| 檔名 | 用途 | 對應武器種類 |
|---|---|---|
| `sword.mp3`  | 劍   | sword_1h / sword_2h |
| `axe.mp3`    | 斧   | axe_1h / axe_2h |
| `mace.mp3`   | 槌   | mace_1h / mace_2h |
| `dagger.mp3` | 匕首 | dagger |
| `staff.mp3`  | 法杖 | staff_1h / staff_2h |
| `bow.mp3`    | 弓   | bow |
| `default.mp3`| 預設 | 沒武器/未知武器(空手) |
| `monster.mp3`| 受擊 | 怪物攻擊玩家時的通用受擊音 |

- 沒放的檔案會自動靜音(不報錯),放上去重新整理就有聲。
- 音量/開關吃設定頁的「音效」設定(`sfxOn` / `sfxVol`)。
- 暴擊時音量會自動略大。
