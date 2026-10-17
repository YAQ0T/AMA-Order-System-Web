#!/usr/bin/env bash
# Stops whatever is serving the API (6001) and the client (5173).
#
# start-dev.sh traps EXIT and stops both on Ctrl+C, so this is for the case
# where it was backgrounded, the terminal was closed, or a server was started
# by hand and left running.
#
# Only kills the process if it is actually node, mirroring the port fallback in
# the Flutter repo's stop_ama.command.

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

stop_port() {
  local name="$1" port="$2" found=""

  local pids
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  else
    pids="$(netstat -ano 2>/dev/null | awk -v p=":$port" '$0 ~ p && /LISTENING/ {print $5}' | sort -u || true)"
  fi

  for pid in $pids; do
    [ -z "$pid" ] && continue

    local comm=""
    if command -v ps >/dev/null 2>&1; then
      comm="$(ps -p "$pid" -o comm= 2>/dev/null || true)"
    fi

    if [ -n "$comm" ] && [[ "$comm" != *node* ]]; then
      log "Port $port is held by $comm (PID $pid), not node - left alone."
      found=1
      continue
    fi

    if kill "$pid" 2>/dev/null; then
      for _ in 1 2 3 4 5; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
      done
      kill -9 "$pid" 2>/dev/null || true
      log "Stopped $name (PID $pid on port $port)."
      found=1
    fi
  done

  [ -z "$found" ] && log "No $name running on port $port."
  return 0
}

stop_port "API" 6001
stop_port "client" 5173
log "Stop command finished."
