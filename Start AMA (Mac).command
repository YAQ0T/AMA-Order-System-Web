#!/bin/bash
# Double-click to start the AMA Order System. See scripts/launch.js.
cd "$(dirname "$0")" || exit 1

# Finder runs this without your shell profile, so add the usual places Node
# lives (the nodejs.org installer, Homebrew, nvm).
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

node scripts/launch.js start
status=$?
echo
read -n 1 -s -r -p "Press any key to close this window..."
echo
exit $status
