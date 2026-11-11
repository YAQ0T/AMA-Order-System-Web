#!/bin/bash
# Double-click to update the AMA Order System to the newest version on GitHub.
# Your settings (server/.env), backups and logs are kept, a backup of the data
# is taken first, and a running system is started again. See scripts/launch.js.
#
# Everything is inside one { ... } block: bash reads the whole block before
# running it, so the update can safely replace this very file.
{
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

node scripts/launch.js update
status=$?
echo
read -n 1 -s -r -p "Press any key to close this window..."
echo
exit $status
}
