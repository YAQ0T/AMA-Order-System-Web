#!/bin/bash
# Double-click: the online link (Cloudflare tunnel) - connect, start, stop, test, log. See scripts/tunnel.js.
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

node scripts/tunnel.js
status=$?
# The menu waits for a key itself; this keeps an unexpected error readable.
if [ $status -ne 0 ]; then
  echo
  read -n 1 -s -r -p "Press any key to close this window..."
  echo
fi
exit $status
