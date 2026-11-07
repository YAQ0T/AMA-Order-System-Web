#!/usr/bin/env bash
# For developers (Mac / Linux / Git Bash): starts the API (auto-restarts on
# code changes) and the Vite dev server (live reload). Ctrl+C stops both.
#   API:    http://localhost:6001      Client: http://localhost:5173
#
# It uses server/.env as it is, so the DATABASE IS THE REAL ONE on this
# computer. Telegram is switched off (npm run dev sets TELEGRAM=off): only one
# program may read the bot's messages, and that is the real system.
# Not for running the system - that is "Start AMA". To work on screens without
# a database, use scripts/start-mock.sh instead.
set -e
cd "$(dirname "$0")/.."

[ -d server/node_modules ] || (cd server && npm install)
[ -d client/node_modules ] || (cd client && npm install)

trap 'kill 0' EXIT
(cd server && npm run dev) &
(cd client && npm run dev) &

echo "API:    http://localhost:6001   (real database, Telegram off)"
echo "Client: http://localhost:5173"
echo "Ctrl+C stops both."
wait
