#!/bin/bash
# Takeout ヘルパー GUI（標準ライブラリのみ）— venv や pip は不要。
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

try_tk() {
  local py="$1"
  [[ -x "$py" ]] || return 1
  "$py" -c "import tkinter as tk; r=tk.Tk(); r.withdraw(); r.destroy()" >/dev/null 2>&1
}

find_working_python() {
  local c fw
  for fw in \
    /Library/Frameworks/Python.framework/Versions/3.13/bin/python3.13 \
    /Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12 \
    /Library/Frameworks/Python.framework/Versions/3.11/bin/python3.11
  do
    if try_tk "$fw"; then echo "$fw"; return 0; fi
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
    if try_tk "$c"; then echo "$c"; return 0; fi
  done
  return 1
}

if ! GOOD_PY="$(find_working_python)"; then
  echo "Tk が使える Python 3.11+ が見つかりませんでした。"
  echo "  brew install python@3.12 && brew install python-tk@3.12"
  echo "  または https://www.python.org/downloads/ から Python 3.12+ をインストール"
  exit 1
fi

echo "使用する Python: $GOOD_PY"
exec "$GOOD_PY" "$DIR/takeout_guide_gui.py"
