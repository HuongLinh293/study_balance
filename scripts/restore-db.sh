#!/bin/bash
# Restore service databases from a backup round made by infrastructure/backup/backup.sh.
#
#   scripts/restore-db.sh [--yes] [ROUND] [DB ...]
#
# ROUND: folder name in backups/ (default: newest). DB: user_db, task_db, ... (default: all five).
# Restore a whole round together: projections and event versions in one service must match
# the data in the others. Restoring a single database is meant for development only.
set -euo pipefail
cd "$(dirname "$0")/.."

ALL="user_db task_db planning_db notification_db analytics_db"
yes=false
if [[ "${1:-}" == "--yes" ]]; then yes=true; shift; fi

round=${1:-}
[[ -n "$round" ]] && shift
if [[ -z "$round" ]]; then
  round=$(ls -1 backups 2>/dev/null | grep -E '^[0-9]{8}T[0-9]{6}Z$' | sort | tail -n 1 || true)
fi
dir="backups/$round"
[[ -n "$round" && -d "$dir" ]] || { echo "Backup round not found: ${round:-<none>} (see backups/)" >&2; exit 1; }

dbs=${*:-$ALL}
for db in $dbs; do
  [[ " $ALL " == *" $db "* ]] || { echo "Unknown database: $db" >&2; exit 1; }
  [[ -f "$dir/$db.sql.gz" ]] || { echo "Missing $dir/$db.sql.gz" >&2; exit 1; }
done

echo "Checking checksums in ${dir}..."
if command -v sha256sum >/dev/null; then (cd "$dir" && sha256sum -c --quiet SHA256SUMS)
else (cd "$dir" && shasum -a 256 -c --quiet SHA256SUMS); fi

if ! $yes; then
  read -r -p "Replace [$dbs] with backup $round? Current data in these databases is lost. [y/N] " answer
  [[ "$answer" == y || "$answer" == Y ]] || { echo "Cancelled."; exit 1; }
fi

# Stop only the owning services that are running in Compose (with `npm run dev`, stop them yourself).
running=$(docker compose ps --services --status running)
stopped=()
for db in $dbs; do
  svc="${db%_db}-service"
  if grep -qx "$svc" <<<"$running"; then stopped+=("$svc"); fi
done
if ((${#stopped[@]})); then
  echo "Stopping ${stopped[*]}..."
  docker compose stop "${stopped[@]}"
fi

for db in $dbs; do
  echo "Restoring $db..."
  { echo "DROP DATABASE IF EXISTS \`$db\`;"; gunzip -c "$dir/$db.sql.gz"; } |
    docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot'
done

if ((${#stopped[@]})); then
  echo "Starting ${stopped[*]}..."
  docker compose start "${stopped[@]}"
fi
echo "Restored [$dbs] from $round."
