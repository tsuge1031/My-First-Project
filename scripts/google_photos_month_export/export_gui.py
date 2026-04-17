#!/usr/bin/env python3
"""Google フォト指定月ダウンロード — tkinter GUI（macOS 想定）。"""

from __future__ import annotations

import queue
import subprocess
import sys
import threading
import tkinter as tk
from datetime import date
from pathlib import Path
from tkinter import messagebox, ttk

# どのディレクトリから起動しても import できるようにする
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from export_month import default_downloads_dir, export_month_to_folder, month_folder_name, script_dir


def main() -> None:
    root = tk.Tk()
    root.title("Google フォト（月別・撮影日）")
    root.minsize(520, 380)

    sd = script_dir()
    client_secrets = sd / "client_secret.json"
    token_path = sd / "token.json"
    downloads = default_downloads_dir()

    today = date.today()
    frm = ttk.Frame(root, padding=12)
    frm.pack(fill=tk.BOTH, expand=True)

    ttk.Label(frm, text="撮影日が該当する月の写真・動画を、オリジナル相当で保存します。").pack(anchor=tk.W)
    ttk.Label(frm, text=f"保存先: {downloads}/yyyy-MM/").pack(anchor=tk.W, pady=(0, 8))

    row = ttk.Frame(frm)
    row.pack(fill=tk.X, pady=4)
    ttk.Label(row, text="年").pack(side=tk.LEFT, padx=(0, 8))
    year_var = tk.IntVar(value=today.year)
    year_spin = ttk.Spinbox(row, from_=1990, to=2035, width=8, textvariable=year_var)
    year_spin.pack(side=tk.LEFT, padx=(0, 16))
    ttk.Label(row, text="月").pack(side=tk.LEFT, padx=(0, 8))
    month_var = tk.IntVar(value=today.month)
    month_spin = ttk.Spinbox(row, from_=1, to=12, width=6, textvariable=month_var)
    month_spin.pack(side=tk.LEFT)

    prog = ttk.Progressbar(frm, mode="determinate", maximum=100)
    prog.pack(fill=tk.X, pady=(12, 4))
    status_var = tk.StringVar(value="準備完了")
    ttk.Label(frm, textvariable=status_var).pack(anchor=tk.W)

    log_frame = ttk.LabelFrame(frm, text="ログ", padding=4)
    log_frame.pack(fill=tk.BOTH, expand=True, pady=(8, 0))
    log_text = tk.Text(log_frame, height=12, wrap=tk.WORD, state=tk.DISABLED, font=("Menlo", 11))
    scroll = ttk.Scrollbar(log_frame, command=log_text.yview)
    log_text.configure(yscrollcommand=scroll.set)
    log_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
    scroll.pack(side=tk.RIGHT, fill=tk.Y)

    q: queue.Queue[tuple[str, object]] = queue.Queue()
    cancel_ev = threading.Event()
    worker: threading.Thread | None = None

    def append_log(line: str) -> None:
        log_text.configure(state=tk.NORMAL)
        log_text.insert(tk.END, line + "\n")
        log_text.see(tk.END)
        log_text.configure(state=tk.DISABLED)

    def set_busy(busy: bool) -> None:
        start_btn.configure(state=tk.DISABLED if busy else tk.NORMAL)
        cancel_btn.configure(state=tk.NORMAL if busy else tk.DISABLED)
        year_spin.configure(state=tk.DISABLED if busy else tk.NORMAL)
        month_spin.configure(state=tk.DISABLED if busy else tk.NORMAL)

    def poll_queue() -> None:
        try:
            while True:
                kind, payload = q.get_nowait()
                if kind == "log":
                    append_log(str(payload))
                elif kind == "status":
                    status_var.set(str(payload))
                elif kind == "progress":
                    cur, total, _name = payload  # type: ignore[misc]
                    if total > 0:
                        prog["maximum"] = total
                        prog["value"] = cur
                elif kind == "done":
                    set_busy(False)
                    cancel_ev.clear()
                    prog["value"] = 0
                    messagebox.showinfo("完了", str(payload))
                elif kind == "error":
                    set_busy(False)
                    cancel_ev.clear()
                    prog["value"] = 0
                    messagebox.showerror("エラー", str(payload))
        except queue.Empty:
            pass
        root.after(120, poll_queue)

    def run_export() -> None:
        if not client_secrets.exists():
            messagebox.showerror(
                "設定が必要です",
                f"{client_secrets}\nが見つかりません。\nREADME の手順で OAuth JSON を配置してください。",
            )
            return

        year = int(year_var.get())
        month = int(month_var.get())
        if not 1 <= month <= 12:
            messagebox.showwarning("入力エラー", "月は 1〜12 を指定してください。")
            return

        cancel_ev.clear()
        set_busy(True)
        prog["value"] = 0
        status_var.set("処理中…")

        def task() -> None:
            try:

                def on_progress(cur: int, total: int, name: str) -> None:
                    q.put(("progress", (cur, total, name)))
                    q.put(("status", f"{cur} / {total} — {name}"))

                ok, skipped, dest = export_month_to_folder(
                    year,
                    month,
                    downloads=downloads,
                    client_secrets=client_secrets,
                    token_path=token_path,
                    sleep=0.15,
                    on_log=lambda m: q.put(("log", m)),
                    on_progress=on_progress,
                    cancel_event=cancel_ev,
                )
                q.put(("done", f"成功 {ok} 件、スキップ {skipped} 件\n\n保存先:\n{dest}"))
            except FileNotFoundError as e:
                q.put(("error", str(e)))
            except PermissionError as e:
                q.put(("error", str(e)))
            except Exception as e:
                q.put(("error", f"{type(e).__name__}: {e}"))

        nonlocal worker
        worker = threading.Thread(target=task, daemon=True)
        worker.start()

    def cancel_export() -> None:
        cancel_ev.set()
        status_var.set("キャンセル要求を送りました…")

    def open_folder() -> None:
        year = int(year_var.get())
        month = int(month_var.get())
        path = downloads / month_folder_name(year, month)
        if not path.is_dir():
            messagebox.showinfo("フォルダなし", f"まだありません:\n{path}")
            return
        if sys.platform == "darwin":
            subprocess.run(["open", str(path)], check=False)
        else:
            subprocess.run(["xdg-open", str(path)], check=False)

    btn_row = ttk.Frame(frm)
    btn_row.pack(fill=tk.X, pady=(12, 0))
    start_btn = ttk.Button(btn_row, text="ダウンロード開始", command=run_export)
    start_btn.pack(side=tk.LEFT, padx=(0, 8))
    cancel_btn = ttk.Button(btn_row, text="キャンセル", command=cancel_export, state=tk.DISABLED)
    cancel_btn.pack(side=tk.LEFT, padx=(0, 8))
    ttk.Button(btn_row, text="フォルダを開く", command=open_folder).pack(side=tk.LEFT)

    poll_queue()
    root.mainloop()


if __name__ == "__main__":
    main()
