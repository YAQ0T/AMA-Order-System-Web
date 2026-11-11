#!/bin/bash
# Double-click: a DEMO copy of the system to try things on - its own database,
# port 6060, Telegram off, sample accounts and orders. The real system and its
# data are not touched. It runs while this window is open; close it (or press
# Ctrl+C) to stop it. See scripts/launch.js (demo).
cd "$(dirname "$0")" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js is not installed on this Mac."
  echo "  Install the LTS version from https://nodejs.org and run this again."
  echo
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

node scripts/launch.js demo
status=$?
echo
read -n 1 -s -r -p "Press any key to close this window..."
echo
exit $status
