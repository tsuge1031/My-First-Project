# OAuth クライアント（client_secret.json）の作り方

> **Takeout 運用では OAuth は不要です。** 以下は **旧 Library API 版（`export_gui.py`）を試す場合だけ** 参照してください。

> **2025年3月以降:** スコープや `token.json` が正しくても、**ライブラリ全体の検索（`mediaItems.search`）は Google のポリシーで利用できない**ことがあります。まず **[GOOGLE_PHOTOS_API_CHANGES.md](./GOOGLE_PHOTOS_API_CHANGES.md)** を読んでください。

**実ファイルは Google が発行します。** Cloud Console で作成し、ダウンロードした JSON をこのフォルダに **`client_secret.json`** という名前で置いてください（拡張子は `.json`）。

## 前提チェック

- ダウンロードしたい **Google フォトと同じ Google アカウント**の Gmail を控えておく（後で「テストユーザー」に追加）。
- ブラウザで [Google Cloud Console](https://console.cloud.google.com/) にログインできること。

## 手順

### 1. プロジェクトを用意

1. Cloud Console 左上のプロジェクト選択 → **新しいプロジェクト**（または既存を選択）。
2. プロジェクト名は任意（例: `google-photos-export`）。

### 2. API を有効化

1. **API とサービス** → **ライブラリ**。
2. 「**Google Photos Library API**」を検索 → **有効にする**。

### 3. OAuth 同意画面

1. **API とサービス** → **OAuth 同意画面**。
2. ユーザータイプで **外部** を選び、作成を進める（個人利用で問題ありません）。
3. **アプリ名**・**ユーザーサポートメール**・**デベロッパーの連絡先メール** を入力して保存。
   - **アプリ名は Google の商標や公式サービス名を使わない**でください。次のような名前は弾かれやすいです: `Google フォト…`、`Gmail…`、`Google Photos…` など。
   - 個人利用なら、**中立的な名前**にすると通りやすいです（例: `月別フォト保存`、 `Photo export (personal)`、自分のニックネーム＋`フォトツール`）。
   - エラー「**アプリの名前が Google の要件を満たしていない**」が出たら、**アプリ情報の画面に戻りアプリ名だけ変更**してから再度「作成」してください。
4. **スコープ（データアクセス）を必ず追加する**（ここが空だと、アプリ起動後に **Photos API が HTTP 403** になります）。
   - **Google 認証プラットフォーム** または **OAuth 同意画面** で **「データアクセス」「スコープ」** などの画面を開く。
   - **「スコープを追加または削除」** または **「スコープを追加」** で、次の **1 行まるごと**を手動追加する（「機密性の高いスコープ」に分類されます）:  
     `https://www.googleapis.com/auth/photoslibrary.readonly`
   - 保存する。
5. **テストユーザー** に、**フォトをダウンロードしたい Google アカウントの Gmail**（例: ログインに使う `***@gmail.com`）を **必ず追加**して保存。  
   - **ここに入れていないアカウント**で許可画面に進むと、ブラウザに **「審査プロセスを完了していません」「403: access_denied」** と出ます。これは審査未完了ではなく **テストユーザー外** のときの典型です。  
   - 個人利用では **本番の Google 検証（審査）を申請する必要はありません**（テストユーザー＋テスト公開のままでよい）。

### 4. OAuth クライアント ID（デスクトップ）

1. **API とサービス** → **認証情報**。
2. **認証情報を作成** → **OAuth クライアント ID**。
3. アプリケーションの種類: **デスクトップアプリ**。
4. 名前は任意 → **作成**。
5. 表示されたダイアログで **JSON をダウンロード**。

### 5. ファイルの配置

1. ダウンロードしたファイル（例: `client_secret_123456789.apps.googleusercontent.com.json`）を Finder で開く。
2. **`google_photos_month_export` フォルダ**に移動し、名前を **`client_secret.json`** に変更する。  
   - 中身は Google が出したままでよい（`installed` キーが入っている形式）。

### 6. 動作確認

```bash
cd /Users/tsuge/Desktop/My-First-Project/scripts/google_photos_month_export
./run_gui.sh
```

「ダウンロード開始」でブラウザが開き、Google の許可画面が出れば成功です。

**スコープを後から追加した場合**は、`google_photos_month_export` フォルダ内の **`token.json` を削除**してから、もう一度「ダウンロード開始」し、**許可画面で改めてすべて許可**してください（古いトークンにフォト用スコープが含まれないため）。

## うまくいかないとき

| 現象 | 対処 |
|------|------|
| OAuth 構成作成時「**アプリの名前が Google の要件を満たしていない**」 | **アプリ名**から「Google」「Gmail」「Google フォト」等の商標・公式に見える表現を外し、上記のような中立名に変更して再試行。 |
| 「**審査プロセスを完了していません**」「**403: access_denied**」 | **審査の申請は不要**なことが多い。**OAuth 同意画面 → 対象（Audience）→ テストユーザー** に、**いまブラウザでログインしている Gmail と同じアドレス**を追加して保存。数分待ってから、シークレットウィンドウで再度「ダウンロード開始」。 |
| `access_denied` / 403（一般） | **テストユーザー** に該当 Gmail を追加したか、別プロジェクトのクライアントを使っていないか確認。 |
| アプリ内 **`HTTPError: 403`** / `mediaItems:search` | **Google Photos Library API** が有効か確認。**同意画面のスコープ**に `https://www.googleapis.com/auth/photoslibrary.readonly` を追加済みか確認。**`token.json` を削除**して再ログイン。 |
| `invalid_client` | JSON が壊れていないか、`client_secret.json` の名前・場所を確認。 |
| API が無効 | **Google Photos Library API** を有効化し直す。 |

## セキュリティ

- **`client_secret.json` と `token.json` を Git にコミットしないでください。**
