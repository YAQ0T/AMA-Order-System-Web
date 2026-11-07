#!/usr/bin/env bash
# Stops the mock API and the client started by start-mock.sh. Same job as
# stop-dev.sh (both free ports 6001 and 5173, and never touch the real system),
# so it simply runs that; this name exists to match start-mock.sh.
exec "$(dirname "$0")/stop-dev.sh" "$@"
