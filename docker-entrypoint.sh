#!/bin/sh
set -e

# The /data volume is a host bind mount on most deployments (e.g. Unraid's
# /mnt/user/appdata/script-dashboard). If the host path was created by root
# or by a different uid than the in-container 'appuser' (1001), the FastAPI
# process cannot write the SQLite DB and crashes on startup with
# "attempt to write a readonly database". Normalise ownership here — this
# runs as root via supervisord's launch, before privileges are dropped.
chown -R appuser:appuser /data /var/log/app 2>/dev/null || true

exec "$@"
