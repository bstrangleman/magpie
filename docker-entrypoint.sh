#!/bin/sh
# Runs as root just long enough to hand the data directory to PUID:PGID, then drops privileges.
# Unraid creates appdata folders as root and expects containers to run as nobody:users (99:100).
set -e

if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-1000}"
  PGID="${PGID:-1000}"
  umask "${UMASK:-022}"
  mkdir -p "$DATA_DIR"
  if [ "$(stat -c %u:%g "$DATA_DIR")" != "$PUID:$PGID" ]; then
    echo "Setting owner of $DATA_DIR to $PUID:$PGID"
    chown -R "$PUID:$PGID" "$DATA_DIR" || echo "Warning: could not change owner of $DATA_DIR" >&2
  fi
  exec su-exec "$PUID:$PGID" "$@"
fi

# Started with --user: run as that user.
exec "$@"
