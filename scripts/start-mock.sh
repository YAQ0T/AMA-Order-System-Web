#!/usr/bin/env bash
# For working on screens (Mac / Linux / Git Bash): a fake API with sample data
# (tools/mock-api.js) and the Vite dev server. No database, no Telegram -
# nothing real is touched. Ctrl+C stops both.
# Log in as admin / maker1 / taker1 / taker2 / acc1 with any password.
set -e
cd "$(dirname "$0")/.."

[ -d client/node_modules ] || (cd client && npm install)

trap 'kill 0' EXIT
node tools/mock-api.js &
(cd client && npm run dev) &

echo "Mock API: http://localhost:6001"
echo "Client:   http://localhost:5173   (log in as admin, maker1, taker1, taker2 or acc1 - any password)"
echo "Ctrl+C stops both."
wait
