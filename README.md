# My-First-Project

## フォルダ構成

```
My-First-Project/
├── sites/        # Cloudflare Pages 等に載せる独立サイト（例: odoranyasonson-blog）
├── src/          # ★ SSoT原本（Markdownファイルのみ。ここだけ編集する）
├── dist/
│   ├── html/     # src/ から生成されたHTMLファイル（直接編集しない）
│   └── pptx/     # src/ から生成されたPPTXファイル（直接編集しない）
├── scripts/      # 生成スクリプト（generate_slides.py など）
├── index.html    # サイトエントリーポイント
├── approval.html # 承認フロー
└── README.md
```

## SSoT（Single Source of Truth）運用ルール

### 鉄則① 編集は必ず `src/` 内の `.md` ファイルで行う

- HTMLやPPTXを直接編集しない
- 内容を変更したい場合は対応する `.md` を更新し、そこから再生成する

### 鉄則② `dist/` の中身は「生成物」として扱う

- 手動で直接書き換えない
- `scripts/generate_slides.py` などのスクリプトで生成・更新する

### 鉄則③ ファイル命名規則

| 種別 | 命名規則 | 例 |
|---|---|---|
| 日付あり資料 | `YYYYMMDD_タイトル.拡張子` | `20260328_ClaudeCode社内導入提案_役員向け.md` |
| 永続コンテンツ | `タイトル.拡張子` | `profile.md`, `tsuzuki-denki.md` |

## ファイル対応表（原本 → 生成物）

| 原本（src/） | 生成物（dist/） |
|---|---|
| `profile.md` | `dist/html/20260403_つげの_プロフィール.html` |
| `tsuzuki-denki.md` | `dist/html/tsuzuki-denki.html` |
| `20260328_ClaudeCode社内導入提案_役員向け.md` | `dist/html/20260328_ClaudeCode社内導入提案_役員向け.html` |
| `20260328_ClaudeCode社内導入提案_役員向け.md` | `dist/html/20260328_ClaudeCode社内導入提案_図解.html` |
| `20260328_ClaudeCode社内導入提案_役員向け.md` | `dist/pptx/20260328_ClaudeCode社内導入提案_役員向け.pptx` |
| `20260403_図解skill工夫点_解説.md` | `dist/html/20260403_図解skill工夫点_解説.html` |
| `20260403_静的サイトホスティングサービス比較.md` | `dist/html/20260403_静的サイトホスティング比較_図解.html` |
