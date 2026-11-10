#!/bin/bash
# Logical backup of every service database. One folder per round:
#   /backups/<UTC timestamp>/<db>.sql.gz + SHA256SUMS
# Modes:
#   loop (default)  back up now, then every BACKUP_INTERVAL_SECONDS
#   once            run a single round and exit (non-zero on failure)
set -euo pipefail

DATABASES="user_db task_db planning_db notification_db analytics_db"
DIR=/backups
INTERVAL=${BACKUP_INTERVAL_SECONDS:-86400}
KEEP=${BACKUP_KEEP:-7}
HOST=${MYSQL_HOST:-mysql}
# MYSQL_PWD keeps the password out of the process list.
export MYSQL_PWD="${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD is required}"

log() {
  printf '{"ts":"%s","level":"%s","service":"backup","event":"%s"%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "${3:-}"
}

wait_for_mysql() {
  for _ in $(seq 1 30); do
    mysqladmin -h "$HOST" -uroot ping --silent >/dev/null 2>&1 && return 0
    sleep 2
  done
  log error mysql_unreachable
  return 1
}

once() {
  wait_for_mysql
  local stamp tmp started
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  tmp="$DIR/.$stamp.partial"
  started=$(date +%s)
  trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp"
  for db in $DATABASES; do
    # --single-transaction: consistent InnoDB snapshot without locking writers.
    mysqldump -h "$HOST" -uroot --single-transaction --quick --routines --triggers --events \
      --set-gtid-purged=OFF --databases "$db" | gzip -6 >"$tmp/$db.sql.gz"
    gzip -t "$tmp/$db.sql.gz"
  done
  (cd "$tmp" && sha256sum ./*.sql.gz >SHA256SUMS)
  # A round becomes visible only when complete.
  mv "$tmp" "$DIR/$stamp"
  trap - EXIT
  log info backup_completed ",\"round\":\"$stamp\",\"seconds\":$(($(date +%s) - started)),\"bytes\":$(du -sb "$DIR/$stamp" | cut -f1)"
  # Retention: keep the newest $KEEP rounds.
  ls -1d "$DIR"/2*/ 2>/dev/null | sort | head -n "-$KEEP" | while read -r old; do
    rm -rf "$old"
    log info backup_pruned ",\"round\":\"$(basename "$old")\""
  done
}

case "${1:-loop}" in
  once) once ;;
  loop)
    trap 'exit 0' TERM INT
    log info backup_scheduler_started ",\"intervalSeconds\":$INTERVAL,\"keep\":$KEEP"
    while true; do
      # Each round runs in a child process so a failed round does not stop the scheduler.
      "$0" once || log error backup_failed
      sleep "$INTERVAL" & wait $!
    done
    ;;
  *) echo "usage: backup.sh [loop|once]" >&2; exit 2 ;;
esac
