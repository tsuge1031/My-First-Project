#!/usr/bin/env python3
"""Google フォト Takeout 運用向けの簡易ヘルパー（標準ライブラリのみ）。"""

from __future__ import annotations

import subprocess
import sys
import webbrowser
from pathlib import Path
import tkinter as tk
from tkinter import messagebox, scrolledtext, ttk

TAKEOUT_URL = "https://takeout.google.com/"


def downloads_dir() -> Path:
    return Path.home() / "Downloads"


def script_dir() -> Path:
    return Path(__file__).resolve().parent


def open_in_finder(p: Path) -> None:
    if sys.platform == "darwin":
        subprocess.run(["open", str(p)], check=False)
    else:
        subprocess.run(["xdg-open", str(p)], check=False)


def open_guide_md() -> None:
    md = script_dir() / "TAKEOUT_GUIDE.md"
    if not md.exists():
        messagebox.showinfo("ファイルなし", f"見つかりません:\n{md}")
        return
    if sys.platform == "darwin":
        subprocess.run(["open", "-a", "TextEdit", str(md)], check=False)
    else:
        open_in_finder(md)


def main() -> None:
    root = tk.Tk()
    root.title("Google フォト（Takeout 運用）")
    root.minsize(520, 420)

    pad = ttk.Frame(root, padding=12)
    pad.pack(fill=tk.BOTH, expand=True)

    ttk.Label(
        pad,
        text="この PC では「ライブラリ全体を API で月別取得」が難しいため、公式の Takeout でバックアップする運用です。",
        wraplength=480,
    ).pack(anchor=tk.W)

    body = (
        "【手順の要点】\n"
        "1. 「Takeout を開く」で takeout.google.com にアクセス\n"
        "2. データの選択で「Google フォト」だけオン（他はオフでも可）\n"
        "3. 形式・分割サイズを選び「書き出しの実行」\n"
        "4. メールのリンクから ZIP をダウンロードし、Mac で解凍\n"
        "5. 解凍後は Takeout/Google Photos/ 以下にファイルが並びます\n\n"
        "【月だけに絞りたい場合】\n"
        "Takeout は「特定の月だけ」に細かく合わせにくいです。"
        "まとめて書き出したあと、写真.app や Finder で撮影日順に整理するのが現実的です。\n\n"
        f"詳細: {script_dir() / 'TAKEOUT_GUIDE.md'}"
    )

    txt = scrolledtext.ScrolledText(pad, height=14, wrap=tk.WORD, font=("Hiragino Sans", 13))
    txt.pack(fill=tk.BOTH, expand=True, pady=(10, 10))
    txt.insert(tk.END, body)
    txt.configure(state=tk.DISABLED)

    row = ttk.Frame(pad)
    row.pack(fill=tk.X)

    def open_takeout() -> None:
        webbrowser.open(TAKEOUT_URL)

    ttk.Button(row, text="Takeout を開く", command=open_takeout).pack(side=tk.LEFT, padx=(0, 8))
    ttk.Button(row, text="ダウンロードフォルダを開く", command=lambda: open_in_finder(downloads_dir())).pack(
        side=tk.LEFT, padx=(0, 8)
    )
    ttk.Button(row, text="手順（Markdown）を開く", command=open_guide_md).pack(side=tk.LEFT)

    ttk.Label(pad, text=f"Takeout: {TAKEOUT_URL}", foreground="#555").pack(anchor=tk.W, pady=(8, 0))

    root.mainloop()


if __name__ == "__main__":
    main()
