#!/bin/bash
# 旧名互換: 運用は Takeout 前提のため、Takeout ヘルパー GUI を起動します。
# （Library API 版は ./run_gui.sh で起動可能ですが、403 になる可能性があります）
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
exec ./run_takeout_guide.sh
