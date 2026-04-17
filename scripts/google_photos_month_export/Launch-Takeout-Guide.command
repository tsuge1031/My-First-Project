#!/bin/bash
# Finder からダブルクリックで Takeout ヘルパー GUI を起動
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
exec ./run_takeout_guide.sh
