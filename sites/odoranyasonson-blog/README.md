# odoranyasonson-blog（Cloudflare Pages 向け・新デザイン）

WordPress 公式エクスポート（XML）から **静的 HTML** を生成し、[Cloudflare Pages](https://pages.cloudflare.com/) に載せるためのフォルダです。  
見た目は WordPress テーマから **別デザイン**（ダーク基調・明朝見出し・カード一覧）にしています。

## 1. サイトを生成する（XML → HTML）

Phase A で取得した **エクスポート XML** のパスを指定して実行します。

```bash
cd /Users/tsuge/Desktop/My-First-Project
python3 scripts/build_odoranyasonson_site.py "/あなたの/Downloads/odoranyasonson.WordPress.2026-xx-xx.xml"
```

成功すると、このディレクトリに次が出力されます。

- `index.html` … 記事一覧（新デザイン）
- `posts/*.html` … 各記事

`css/theme.css` と `js/theme.js` は **上書きされません**（デザインの SSoT）。

### 画像が消える場合

本文内の画像 URL が `https://odoranyasonson.com/wp-content/...` のままなら、**元サイトが生きている間は表示**されます。  
WING を止めたあとに画像も自前で持ちたい場合は、`wp-content/uploads` をこのリポジトリの `sites/odoranyasonson-blog/media/` などに置き、XML 生成後に URL を置換する必要があります（別途相談可）。

## 2. 手元でプレビュー

```bash
cd /Users/tsuge/Desktop/My-First-Project/sites/odoranyasonson-blog
python3 -m http.server 8765
```

ブラウザで `http://127.0.0.1:8765/` を開く。

## 3. Cloudflare Pages に載せる（本人作業）

1. Cloudflare ダッシュボード → **Workers & Pages** → **Create** → **Pages** → **Direct Upload** または **Connect to Git**。
2. **プロジェクトのルート**をこのフォルダ `sites/odoranyasonson-blog` に合わせる（Git 連携ならリポジトリ内のサブディレクトリをルートに指定）。
3. **ビルド不要**の場合: アップロードするのは **生成後のフォルダ一式**（`index.html` / `posts/` / `css/` / `js/`）。
4. **Git 連携で毎回ビルド**する場合: ビルドコマンドに  
   `python3 scripts/build_odoranyasonson_site.py path/to/export.xml`  
   のようにすると CI 上では XML の置き場が要るので、通常は **ローカルで生成してから commit** する運用が簡単です。
5. カスタムドメイン `odoranyasonson.com` を Pages に紐づけ（既存の DNS 手順書に従う）。

## 4. デザインをさらに変えたいとき

- **色・余白・フォント**: `css/theme.css` の `:root` と `.hero` / `.post-card` を編集。
- **一覧の文言・キャッチ**: `scripts/build_odoranyasonson_site.py` 内の `hero_desc` 文字列。
