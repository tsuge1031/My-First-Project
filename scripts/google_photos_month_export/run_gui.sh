#!/bin/bash
# Apple 同梱の Python 3.9 では Tk が起動直後に abort することがあるため、
# Homebrew / python.org などの新しい Python を自動で選んで venv を用意して GUI を起動する。

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

try_tk() {
  local py="$1"
  [[ -x "$py" ]] || return 1
  "$py" -c "import tkinter as tk; r=tk.Tk(); r.withdraw(); r.destroy()" >/dev/null 2>&1
}

find_working_python() {
  local c
  # python.org インストーラ（macOS）の典型パス
  local fw
  for fw in \
    /Library/Frameworks/Python.framework/Versions/3.13/bin/python3.13 \
    /Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12 \
    /Library/Frameworks/Python.framework/Versions/3.11/bin/python3.11
  do
    if try_tk "$fw"; then
      echo "$fw"
      return 0
    fi
  done
  for c in \
    "${HOMEBREW_PREFIX:-/opt/homebrew}/bin/python3.13" \
    "${HOMEBREW_PREFIX:-/opt/homebrew}/bin/python3.12" \
    "${HOMEBREW_PREFIX:-/opt/homebrew}/bin/python3.11" \
    /opt/homebrew/bin/python3.13 \
    /opt/homebrew/bin/python3.12 \
    /opt/homebrew/bin/python3.11 \
    /usr/local/bin/python3.13 \
    /usr/local/bin/python3.12 \
    /usr/local/bin/python3.11 \
    "$(command -v python3.13 2>/dev/null)" \
    "$(command -v python3.12 2>/dev/null)" \
    "$(command -v python3.11 2>/dev/null)"
  do
    [[ -n "$c" ]] || continue
    if try_tk "$c"; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

if ! GOOD_PY="$(find_working_python)"; then
  echo "Tk（tkinter）が使える Python 3.11+ が見つかりませんでした。"
  echo ""
  echo "【Homebrew で python@3.12 を入れた場合】Tk は別途が必要です。次を実行してください:"
  echo "  brew install python-tk@3.12"
  echo "  その後: cd \"$DIR\" && ./run_gui.sh"
  echo ""
  echo "【まだ Python 3.11+ が無い場合】"
  echo "  brew install python@3.12 && brew install python-tk@3.12"
  echo "  または https://www.python.org/downloads/ から macOS 用 Python 3.12+ をインストール"
  exit 1
fi

echo "使用する Python: $GOOD_PY"

need_venv_rebuild=0
if [[ ! -x .venv/bin/python3 ]]; then
  need_venv_rebuild=1
elif ! try_tk ".venv/bin/python3"; then
  echo "既存の .venv 内の Python では Tk が動きません。.venv を作り直します。"
  need_venv_rebuild=1
fi

if [[ "$need_venv_rebuild" -eq 1 ]]; then
  rm -rf .venv
  "$GOOD_PY" -m venv .venv
fi

# shellcheck source=/dev/null
source .venv/bin/activate
python3 -m pip install -q --upgrade pip >/dev/null 2>&1 || true
pip install -q -r requirements.txt

exec python3 export_gui.py
