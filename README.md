# 興嘉國小學年會議紀錄系統 V2.1（手動帳號登入版）

本版已改為「手動建立帳號＋密碼」登入，不再使用 Google OAuth Client ID。

- 試算表名稱：學年會議
- Spreadsheet ID：`1NJxdiy7Jo1xQW6RnkYS5DINbr19GBVj9-xIih3kghvs`
- 前端：GitHub Pages
- 後端：Google Apps Script Web App
- 登入：系統自建帳號／密碼
- 密碼：加鹽 SHA-256 雜湊後存放，不保存明碼
- Session：登入成功後簽發 8 小時權杖，僅保存權杖雜湊
- 資料：Google 試算表
- 圖片：Google Drive
- PDF：Apps Script 即時產生

## 主要功能

1. 教師以教務處建立的帳號與密碼登入。
2. 教師只可新增、檢視與編修自己所屬學年的會議紀錄。
3. 可儲存草稿或「存檔送出」，送出後仍可依權限再次編修。
4. 管理者可檢視、編修全校各學年紀錄。
5. 教務、學務、總務、輔導主任及校長可檢視全部紀錄，並填寫自己處室的回覆。
6. 管理者可在線上新增帳號、設定角色與學年、重設密碼、啟用或停用帳號。
7. 新帳號或被重設密碼的帳號，首次登入會強制修改密碼。
8. 支援出席者簽到圖檔與 2–4 張會議照片及照片說明。
9. 可匯出單筆 PDF，或依「學年度＋學年＋學期（可選）」匯出彙整 PDF。
10. AuditLog 保留登入、登出、新增、編修、回覆及帳號管理紀錄。

## 一、Google Apps Script 部署

1. 開啟 Google 試算表「學年會議」。
2. 擴充功能 → Apps Script。
3. 將本資料夾 `Code.gs` 全部貼入。
4. 專案設定中啟用顯示 `appsscript.json`，並以本資料夾版本取代。
5. `DRIVE_FOLDER_ID` 可先留白，第一次執行 `setupSystem()` 會自動建立照片資料夾。
6. 手動執行 `setupSystem()` 一次並授權。
7. 再手動執行 `createInitialAdmin()` 一次建立初始管理者。
8. 部署 → 新增部署 → 網頁應用程式。
   - 執行身分：我
   - 存取權：建議依學校 Workspace 政策選擇可使用此 Web App 的對象；若 GitHub Pages 跨網域呼叫遇到限制，可依校內政策調整。
9. 複製部署後 `/exec` 網址。
10. 將 `/exec` 網址填入 `config.js` 的 `GAS_URL`。

> 若 V2.0 曾建立舊版 `Users`（email 欄位）工作表，V2.1 的 `setupSystem()` 會先將它改名為 `Users_V2_Backup_日期時間`，保留舊資料，再建立新版 Users。

## 二、初始管理者

執行 `createInitialAdmin()` 後，會建立：

- 帳號：`admin`
- 暫用密碼：`ChangeMe@115`

第一次登入會要求立即修改密碼。

正式上線後請勿繼續使用上述暫用密碼。

## 三、Users 帳號表

欄位：

`username | passwordHash | salt | name | role | grade | active | mustChangePassword | updatedAt | lastLoginAt`

角色：

- `teacher`：教師，grade 必須填 1–6
- `admin`：系統管理者
- `academic`：教務主任
- `student_affairs`：學務主任
- `general_affairs`：總務主任
- `counseling`：輔導主任
- `principal`：校長

請優先從網站的「帳號管理」新增帳號，不建議手動填入 `passwordHash` 與 `salt`。

## 四、帳號安全

- 密碼至少 8 碼，且需同時包含英文字母與數字。
- 系統使用隨機 salt + SHA-256 產生 `passwordHash`，試算表不保存明碼密碼。
- 連續登入失敗達 5 次，該帳號會暫停嘗試 10 分鐘。
- Session 有效時間預設 8 小時。
- 停用帳號或管理者重設密碼時，該帳號現有 Session 會被清除。
- 若要提升到更高強度，可再改用 Google Identity / Firebase Authentication；目前版本以校內低複雜度部署為優先。

## 五、GitHub Pages

上傳 Repository 根目錄：

- `index.html`
- `styles.css`
- `app.js`
- `config.js`

`config.js`：

```js
window.APP_CONFIG = {
  SCHOOL_NAME: '嘉義市西區興嘉國民小學',
  SCHOOL_NAME_EN: 'Sing Chia Elementary School',
  GAS_URL: 'https://script.google.com/macros/s/AKfycbzatki4gwED6S7IFQwsY_ctuXAP4Q5zTmRfXOrcg1EWfYYv518ZJ4ydeDJS3WoWVzfnqg/exec',
  DEFAULT_SCHOOL_YEAR: 115
};
```

GitHub → Settings → Pages → Deploy from a branch → `main / root`。

## 六、PDF 輸出

PDF 內容包含：

- 學年度、學期、學年、會議次數
- 日期時間、主席、會議記錄、地點、出席者
- 報告事項與討論議題
- 會議記錄／議題討論
- 教務、學務、總務、輔導、校長回覆
- 出席者簽到圖檔
- 會議活動照片與照片說明

「學年 PDF」只彙整狀態為「已送出」的紀錄。

## 七、建議帳號規劃

可採用固定職務帳號，例如：

| 帳號 | 顯示名稱 | 角色 | 學年 |
|---|---|---|---|
| grade1 | 一年級學年主任 | teacher | 1 |
| grade2 | 二年級學年主任 | teacher | 2 |
| grade3 | 三年級學年主任 | teacher | 3 |
| grade4 | 四年級學年主任 | teacher | 4 |
| grade5 | 五年級學年主任 | teacher | 5 |
| grade6 | 六年級學年主任 | teacher | 6 |
| academic | 教務主任 | academic | |
| student | 學務主任 | student_affairs | |
| general | 總務主任 | general_affairs | |
| counseling | 輔導主任 | counseling | |
| principal | 校長 | principal | |
| admin | 系統管理者 | admin | |

## 八、更新 Apps Script 時注意

每次修改 `Code.gs` 後，若使用「部署版本」的 Web App，請在 Apps Script：

部署 → 管理部署作業 → 編輯 → 建立新版本 → 部署。

否則 GitHub 前端仍可能連到舊版後端程式。
