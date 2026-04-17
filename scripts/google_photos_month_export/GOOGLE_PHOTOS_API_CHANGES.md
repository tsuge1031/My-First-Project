# 重要: Google フォト API の仕様変更（2025年3月以降）

[公式の変更説明（英語）](https://developers.google.com/photos/support/updates)

## このツールで起きていること

**`photoslibrary.readonly` スコープは、ライブラリ全体に対する `mediaItems.search` などの用途から削除されました。**  
そのため、同意画面にスコープを正しく追加し、`token.json` にもスコープが載っていても、API は次のように返します。

- HTTP **403**
- `Request had insufficient authentication scopes`  
  （「スコープが足りない」という表現ですが、**そのスコープではもうその操作が許可されない**、という意味に近いです）

## 公式が示す方向性

- **ライブラリ全体から写真を選ばせたい** → **[Google Photos Picker API](https://developers.google.com/photos/picker/guides/get-started-picker)** への移行（ユーザーが Google フォト上で選択し、アプリが選ばれた分だけ取得）
- **ライブラリ API** は、主に **このアプリがアップロードしたメディア** の管理向け（`photoslibrary.readonly.appcreateddata` など）

## つまり「月ごとに全部ダウンロード」は？

**従来どおり Library API だけで「撮影日が某月のライブラリ全体を自動検索して一括保存」することは、Google の現行ポリシーでは実現できません。**

現実的な代替は次のとおりです。

| 方法 | 内容 |
|------|------|
| **[Google Takeout](https://takeout.google.com/)** | ブラウザからエクスポート（月単位の細かい指定は UI 次第）。一括バックアップ向け。 |
| **Picker API** | アプリからは「選択した分だけ」取得。月の全件を無操作で取る用途には向きません。 |
| **別ストレージ** | 今後アップロードする分だけ Library API で管理、など用途を変える。 |

## このリポジトリのスクリプトについて

`export_month.py` / `export_gui.py` は **変更前の Library API 前提**で書かれています。  
**動作保証の対象外**として扱い、新規開発では上記公式ドキュメントに沿った設計を検討してください。

**本プロジェクトの推奨運用は Takeout です。** 手順は **[TAKEOUT_GUIDE.md](./TAKEOUT_GUIDE.md)**、起動用ショートカットは **`Launch-Takeout-Guide.command`** / **`Launch-Photos-Export.command`** を参照してください。
