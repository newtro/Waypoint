#!/bin/sh
set -eu
state=/var/lib/waypoint-relay/relay.sqlite
destination=/var/lib/waypoint-relay/backups
key=/etc/waypoint-relay/backup.key
stamp=$(date -u +%Y%m%dT%H%M%SZ)
temporary="$destination/.relay-$stamp.sqlite"
encrypted="$destination/relay-$stamp.sqlite.enc"
manifest="$destination/relay-$stamp.sha256"
trap 'rm -f "$temporary" "$encrypted.tmp"' EXIT
mkdir -p "$destination"
sqlite3 "$state" ".backup '$temporary'"
sqlite3 "$temporary" 'PRAGMA quick_check;' | grep -qx ok
node /usr/local/libexec/waypoint-relay-backup-crypto.mjs encrypt "$temporary" "$encrypted.tmp" "$key"
chmod 600 "$encrypted.tmp"
mv "$encrypted.tmp" "$encrypted"
sha256sum "$encrypted" | sed "s#  $destination/#  #" > "$manifest"
chmod 600 "$manifest"
# Daily execution plus up to 20 minutes of timer jitter keeps this conservative
# 12-day cutoff below the frozen 14-day maximum even after a missed-day boundary.
find "$destination" -type f \( -name 'relay-*.sqlite.enc' -o -name 'relay-*.sha256' \) -mmin +17280 -delete
