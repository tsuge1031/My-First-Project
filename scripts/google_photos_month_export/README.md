# Google フォトのバックアップ（**Takeout 前提・推奨**）

**運用は [Google Takeout](https://takeout.google.com/) に寄せます。** OAuth や開発者向け API は不要です。

## まず読む

- **手順の本文:** [TAKEOUT_GUIDE.md](./TAKEOUT_GUIDE.md)
- **なぜ API 版をやめたか:** [GOOGLE_PHOTOS_API_CHANGES.md](./GOOGLE_PHOTOS_API_CHANGES.md)

## クイック起動（Mac）

1. Finder でこのフォルダを開く。  
2. **`Launch-Takeout-Guide.command`** をダブルクリック（初回は **右クリック → 開く**）。  
3. ウィンドウの **「Takeout を開く」** からブラウザで書き出しを進める。

ターミナルから:

```bash
cd scripts/google_photos_month_export
chmod +x run_takeout_guide.sh Launch-Takeout-Guide.command   # 初回のみ
./run_takeout_guide.sh
```

**`Launch-Photos-Export.command`** も、同じ **Takeout ヘルパー** を起動します（旧名のままのショートカット向け）。

---

## 旧: Library API 版（`export_gui.py` / `export_month.py`）

2025年3月以降の Google フォト API 方針により、**ライブラリ全体を月単位に検索して取得する方式は実質利用できません**（403 等）。参考として残しています。

試す場合のみ [OAUTH_SETUP.md](./OAUTH_SETUP.md) のとおり `client_secret.json` が必要です。起動は `./run_gui.sh`（venv と `pip install -r requirements.txt` が必要）。

---

## セキュリティ（API 版を使う場合のみ）

- `client_secret.json` と `token.json` を **Git に含めない** でください。
