#!/usr/bin/env bash
# Production build: compiles the client so the server can serve it from client/dist.
set -e
cd "$(dirname "$0")/.."

(cd client && npm install && npm run build)
echo
echo "Built. Now run:  cd server && npm start"
echo "The server will serve the client on its own port."
