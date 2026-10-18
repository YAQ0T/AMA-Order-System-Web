#!/bin/bash
# Double-click to turn "start the system when I log in" on or off. See scripts/launch.js.
cd "$(dirname "$0")" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js is not installed on this Mac."
  echo
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

node scripts/launch.js autostart
status=$?
echo
read -n 1 -s -r -p "Press any key to close this window..."
echo
exit $status
