#!/usr/bin/env python3
"""
Google フォト（Photos Library API）で指定年月（撮影日）の写真・動画を取得し、
オリジナル相当（baseUrl + =d）で Mac のダウンロードフォルダ直下に
「yyyy-MM」名のフォルダを作成して保存する。

前提: Google Cloud で OAuth クライアント（デスクトップ）を作成し、
      本ディレクトリに client_secret.json を置く（ファイル名は --client-secrets で変更可）。

ログインはブラウザ経由の OAuth のみ（アカウントパスワードをアプリに保存しない）。
"""

from __future__ import annotations

import argparse
import calendar
import os
import re
import shutil
import sys
import threading
import time
from collections.abc import Callable
from pathlib import Path

import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/photoslibrary.readonly"]
PHOTOS_READONLY_SCOPE = SCOPES[0]
API_BASE = "https://photoslibrary.googleapis.com/v1"

MIME_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "image/avif": ".avif",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "video/3gpp": ".3gp",
    "video/x-msvideo": ".avi",
}


def script_dir() -> Path:
    return Path(__file__).resolve().parent


def default_downloads_dir() -> Path:
    return Path.home() / "Downloads"


def month_folder_name(year: int, month: int) -> str:
    return f"{year}-{month:02d}"


def sanitize_filename(name: str, max_len: int = 180) -> str:
    name = name.strip().replace("\x00", "")
    name = re.sub(r'[<>:"/\\|?*]', "_", name)
    if len(name) > max_len:
        root, ext = os.path.splitext(name)
        name = root[: max_len - len(ext) - 8] + "__trunc" + ext
    return name or "file"


def last_day_of_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def load_credentials(client_secrets: Path, token_path: Path) -> Credentials:
    creds: Credentials | None = None
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not client_secrets.exists():
                raise FileNotFoundError(
                    f"{client_secrets} が見つかりません。\n"
                    "Google Cloud Console で「デスクトップアプリ」の OAuth クライアントを作成し、\n"
                    "JSON をダウンロードしてこのパスに保存してください。"
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(client_secrets), SCOPES)
            creds = flow.run_local_server(port=0, prompt="consent")
        token_path.write_text(creds.to_json(), encoding="utf-8")
    return creds


def ensure_photos_scope(creds: Credentials) -> None:
    """トークンにフォト読み取りスコープが含まれるか（無いと API が insufficient authentication scopes で 403）。"""
    granted = set(creds.scopes or [])
    if PHOTOS_READONLY_SCOPE in granted:
        return
    show = list(creds.scopes) if creds.scopes else "（スコープ情報なし・古い token の可能性）"
    raise PermissionError(
        "トークンに Google フォト用スコープが含まれていません。\n"
        "（Google のメッセージ: Request had insufficient authentication scopes）\n\n"
        "次を順に試してください:\n"
        "1. Google Cloud Console → OAuth 同意画面（または Google 認証プラットフォーム）\n"
        "   →「データアクセス」「スコープ」で、次を手動追加して保存:\n"
        f"   {PHOTOS_READONLY_SCOPE}\n"
        "2. このフォルダの token.json を削除\n"
        "3. 本アプリで再度「ダウンロード開始」し、許可画面で「Google フォトの閲覧」等を許可\n\n"
        f"（いまのトークンのスコープ: {show}）"
    )


def _raise_photos_api_http_error(r: requests.Response) -> None:
    detail = (r.text or "").strip()[:4000]
    msg = f"Photos API がエラーを返しました (HTTP {r.status_code}).\n\n--- Google 応答 ---\n{detail}"
    if r.status_code == 403:
        msg += (
            "\n\n--- よくある対処（403） ---\n"
            "1. API とサービス → ライブラリ →「Google Photos Library API」を有効化\n"
            "2. OAuth 同意画面（データアクセス / スコープ）で次を手動追加して保存:\n"
            f"   {PHOTOS_READONLY_SCOPE}\n"
            "3. google_photos_month_export フォルダ内の token.json を削除\n"
            "4. 再度「ダウンロード開始」してブラウザで許可し直す\n"
        )
        if "insufficient authentication scopes" in detail.lower():
            msg += (
                "\n\n--- 2025年3月以降の Google フォト API 変更について ---\n"
                "同意や token が正しくても、ライブラリ全体に対する mediaItems.search は\n"
                "ポリシー上サポートされなくなり、このエラーが出続けることがあります。\n"
                "詳細: 同フォルダの GOOGLE_PHOTOS_API_CHANGES.md\n"
                "公式: https://developers.google.com/photos/support/updates\n"
            )
    raise RuntimeError(msg)


def search_month(
    session: requests.Session,
    year: int,
    month: int,
    page_size: int = 100,
) -> list[dict]:
    last = last_day_of_month(year, month)
    body: dict = {
        "pageSize": page_size,
        "filters": {
            "dateFilter": {
                "ranges": [
                    {
                        "startDate": {"year": year, "month": month, "day": 1},
                        "endDate": {"year": year, "month": month, "day": last},
                    }
                ]
            }
        },
    }
    items: list[dict] = []
    page_token: str | None = None
    while True:
        if page_token:
            body["pageToken"] = page_token
        elif "pageToken" in body:
            del body["pageToken"]
        r = session.post(f"{API_BASE}/mediaItems:search", json=body, timeout=120)
        if not r.ok:
            print(r.text, file=sys.stderr)
            _raise_photos_api_http_error(r)
        data = r.json()
        items.extend(data.get("mediaItems") or [])
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return items


def pick_filename(item: dict, index: int) -> str:
    meta = item.get("mediaMetadata") or {}
    mime = meta.get("mimeType") or "application/octet-stream"
    ext = MIME_EXT.get(mime, "")
    base = item.get("filename")
    if base:
        base = sanitize_filename(base)
        if not os.path.splitext(base)[1] and ext:
            base += ext
        return base
    return f"{item.get('id', f'item_{index}')}{ext}"


def download_item(session: requests.Session, item: dict, dest_dir: Path, index: int) -> Path:
    base_url = item.get("baseUrl")
    if not base_url:
        raise ValueError("baseUrl がありません")
    url = base_url + "=d"
    name = pick_filename(item, index)
    out = dest_dir / name
    if out.exists():
        stem, suf = os.path.splitext(name)
        out = dest_dir / f"{stem}__{item.get('id', index)}{suf}"
    headers = dict(session.headers)
    r = session.get(url, headers=headers, stream=True, timeout=300)
    if not r.ok:
        print(r.text, file=sys.stderr)
        r.raise_for_status()
    with open(out, "wb") as f:
        for chunk in r.iter_content(chunk_size=1024 * 1024):
            if chunk:
                f.write(chunk)
    return out


def export_month_to_folder(
    year: int,
    month: int,
    *,
    downloads: Path | None = None,
    client_secrets: Path | None = None,
    token_path: Path | None = None,
    sleep: float = 0.15,
    on_log: Callable[[str], None] | None = None,
    on_progress: Callable[[int, int, str], None] | None = None,
    cancel_event: threading.Event | None = None,
) -> tuple[int, int, Path]:
    """
    戻り値: (成功件数, スキップ件数, 出力フォルダパス)
    """
    if downloads is None:
        downloads = default_downloads_dir()
    if client_secrets is None:
        client_secrets = script_dir() / "client_secret.json"
    if token_path is None:
        token_path = script_dir() / "token.json"

    def log(msg: str) -> None:
        if on_log:
            on_log(msg)

    creds = load_credentials(client_secrets, token_path)
    ensure_photos_scope(creds)
    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {creds.token}"})

    log(f"{year}年{month}月（撮影日）を検索しています…")
    items = search_month(session, year, month)
    dest = downloads / month_folder_name(year, month)
    downloads.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)

    if not items:
        log("該当するメディアがありませんでした（空のフォルダを作成しました）。")
        return 0, 0, dest

    log(f"{len(items)} 件を {dest} に保存します（オリジナル相当 =d）。")
    ok = 0
    skipped = 0
    for i, item in enumerate(items):
        if cancel_event and cancel_event.is_set():
            log("キャンセルされました。")
            break
        name_hint = pick_filename(item, i)
        try:
            path = download_item(session, item, dest, i)
            ok += 1
            log(f"[{i + 1}/{len(items)}] {path.name}")
            if on_progress:
                on_progress(i + 1, len(items), path.name)
        except Exception as e:
            skipped += 1
            log(f"スキップ: {name_hint} — {e}")
        time.sleep(sleep)

    log(f"完了: 成功 {ok} / スキップ {skipped} → {dest}")
    return ok, skipped, dest


def main() -> None:
    sd = script_dir()
    parser = argparse.ArgumentParser(
        description="Google フォトの指定月（撮影日）を ~/Downloads/yyyy-MM/ に保存"
    )
    parser.add_argument("year", type=int, help="年（例: 2024）")
    parser.add_argument("month", type=int, help="月（1〜12）")
    parser.add_argument(
        "--downloads",
        type=Path,
        default=default_downloads_dir(),
        help="親フォルダ（既定: ~/Downloads）。その下に yyyy-MM を作成",
    )
    parser.add_argument(
        "--client-secrets",
        type=Path,
        default=sd / "client_secret.json",
        help="OAuth クライアント JSON のパス",
    )
    parser.add_argument(
        "--token",
        type=Path,
        default=sd / "token.json",
        help="保存するトークンファイル",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.15,
        help="ダウンロード間の秒数（レート制限緩和）",
    )
    args = parser.parse_args()

    if not 1 <= args.month <= 12:
        print("month は 1〜12 で指定してください。", file=sys.stderr)
        sys.exit(1)

    try:
        export_month_to_folder(
            args.year,
            args.month,
            downloads=args.downloads,
            client_secrets=args.client_secrets,
            token_path=args.token,
            sleep=args.sleep,
            on_log=print,
        )
    except FileNotFoundError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
    except (PermissionError, RuntimeError) as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
