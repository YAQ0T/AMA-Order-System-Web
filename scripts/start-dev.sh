#!/usr/bin/env bash
# Starts the API and the Vite dev server together. Ctrl+C stops both.
set -e
cd "$(dirname "$0")/.."

[ -d server/node_modules ] || (cd server && npm install)
[ -d client/node_modules ] || (cd client && npm install)

trap 'kill 0' EXIT
(cd server && npm run dev) &
(cd client && npm run dev) &

echo "API:    http://localhost:6001"
echo "Client: http://localhost:5173"
wait
