#!/bin/bash
# Run by the mysql image entrypoint once, on an empty data volume (primary and replica),
# while the temporary server listens on its socket only. Executable on purpose: some
# Docker file shares report every file as executable, so it must work when executed.
# One database and one account per service; passwords come from the environment
# (see .env.example), with development defaults for a local checkout.
set -eu
MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=socket -uroot <<-EOSQL
	CREATE DATABASE IF NOT EXISTS user_db;
	CREATE USER IF NOT EXISTS 'user_app'@'%' IDENTIFIED BY '${USER_DB_PASSWORD:-local_user_change_me}';
	GRANT ALL PRIVILEGES ON user_db.* TO 'user_app'@'%';
	CREATE DATABASE IF NOT EXISTS task_db;
	CREATE USER IF NOT EXISTS 'task_app'@'%' IDENTIFIED BY '${TASK_DB_PASSWORD:-local_task_change_me}';
	GRANT ALL PRIVILEGES ON task_db.* TO 'task_app'@'%';
	CREATE DATABASE IF NOT EXISTS planning_db;
	CREATE USER IF NOT EXISTS 'planning_app'@'%' IDENTIFIED BY '${PLANNING_DB_PASSWORD:-local_planning_change_me}';
	GRANT ALL PRIVILEGES ON planning_db.* TO 'planning_app'@'%';
	CREATE DATABASE IF NOT EXISTS notification_db;
	CREATE USER IF NOT EXISTS 'notification_app'@'%' IDENTIFIED BY '${NOTIFICATION_DB_PASSWORD:-local_notification_change_me}';
	GRANT ALL PRIVILEGES ON notification_db.* TO 'notification_app'@'%';
	CREATE DATABASE IF NOT EXISTS analytics_db;
	CREATE USER IF NOT EXISTS 'analytics_app'@'%' IDENTIFIED BY '${ANALYTICS_DB_PASSWORD:-local_analytics_change_me}';
	GRANT ALL PRIVILEGES ON analytics_db.* TO 'analytics_app'@'%';
EOSQL
