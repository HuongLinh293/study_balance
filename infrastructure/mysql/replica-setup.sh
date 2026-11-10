#!/bin/bash
# One-shot: make mysql-replica a GTID replica of mysql. Idempotent: does nothing
# when replication is already healthy; otherwise re-seeds the replica from a
# consistent dump of the primary and starts replication.
set -euo pipefail

DATABASES="user_db task_db planning_db notification_db analytics_db"
PRIMARY=${PRIMARY_HOST:-mysql}
REPLICA=${REPLICA_HOST:-mysql-replica}
export MYSQL_PWD="${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD is required}"
REPL_PASSWORD="${MYSQL_REPLICATION_PASSWORD:?MYSQL_REPLICATION_PASSWORD is required}"

log() {
  printf '{"ts":"%s","level":"%s","service":"replica-setup","event":"%s"%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "${3:-}"
}
p() { mysql -h "$PRIMARY" -uroot -N "$@"; }
r() { mysql -h "$REPLICA" -uroot -N "$@"; }

# "<io state> <sql state>" or empty when replication was never configured.
replication_state() {
  r -e "SELECT c.SERVICE_STATE, a.SERVICE_STATE
        FROM performance_schema.replication_connection_status c
        JOIN performance_schema.replication_applier_status a USING (CHANNEL_NAME)
        WHERE CHANNEL_NAME = ''" | tr '\t' ' '
}

state=$(replication_state)
if [[ "$state" == "ON ON" ]]; then
  log info replica_already_running
  exit 0
fi
log info replica_seeding ",\"previousState\":\"${state:-none}\""

# Replication account on the primary (sql_log_bin=0: the replica gets its own copy below).
p -e "SET sql_log_bin = 0;
      CREATE USER IF NOT EXISTS 'repl'@'%' IDENTIFIED BY '$REPL_PASSWORD';
      ALTER USER 'repl'@'%' IDENTIFIED BY '$REPL_PASSWORD';
      GRANT REPLICATION SLAVE ON *.* TO 'repl'@'%';"

drops=""
for db in $DATABASES; do drops+="DROP DATABASE IF EXISTS \`$db\`; "; done
r -e "STOP REPLICA; RESET REPLICA ALL;
      SET GLOBAL super_read_only = OFF; SET GLOBAL read_only = OFF;
      SET sql_log_bin = 0; $drops
      RESET BINARY LOGS AND GTIDS;"

# --set-gtid-purged=ON records which primary transactions the dump already contains,
# so auto-positioning resumes exactly after the snapshot.
# shellcheck disable=SC2086
mysqldump -h "$PRIMARY" -uroot --single-transaction --quick --routines --triggers --events \
  --set-gtid-purged=ON --databases $DATABASES | r

r -e "CHANGE REPLICATION SOURCE TO
        SOURCE_HOST = '$PRIMARY', SOURCE_PORT = 3306,
        SOURCE_USER = 'repl', SOURCE_PASSWORD = '$REPL_PASSWORD',
        SOURCE_AUTO_POSITION = 1, SOURCE_SSL = 1, GET_SOURCE_PUBLIC_KEY = 1,
        SOURCE_CONNECT_RETRY = 10;
      START REPLICA;
      SET PERSIST read_only = ON;
      SET PERSIST super_read_only = ON;"

for _ in $(seq 1 30); do
  state=$(replication_state)
  if [[ "$state" == "ON ON" ]]; then
    log info replica_started ",\"gtidExecuted\":\"$(r -e 'SELECT @@gtid_executed' | tr -d '\n')\""
    exit 0
  fi
  sleep 1
done
log error replica_start_failed ",\"state\":\"$state\""
r -e "SHOW REPLICA STATUS\G" | grep -E 'Running|Last_.*Error' >&2 || true
exit 1
