-- Development credentials only; init runs once on an empty MySQL volume.
CREATE DATABASE IF NOT EXISTS user_db;
CREATE USER IF NOT EXISTS 'user_app'@'%' IDENTIFIED BY 'local_user_change_me';
GRANT ALL PRIVILEGES ON user_db.* TO 'user_app'@'%';
CREATE DATABASE IF NOT EXISTS task_db;
CREATE USER IF NOT EXISTS 'task_app'@'%' IDENTIFIED BY 'local_task_change_me';
GRANT ALL PRIVILEGES ON task_db.* TO 'task_app'@'%';
CREATE DATABASE IF NOT EXISTS planning_db;
CREATE USER IF NOT EXISTS 'planning_app'@'%' IDENTIFIED BY 'local_planning_change_me';
GRANT ALL PRIVILEGES ON planning_db.* TO 'planning_app'@'%';
CREATE DATABASE IF NOT EXISTS notification_db;
CREATE USER IF NOT EXISTS 'notification_app'@'%' IDENTIFIED BY 'local_notification_change_me';
GRANT ALL PRIVILEGES ON notification_db.* TO 'notification_app'@'%';
CREATE DATABASE IF NOT EXISTS analytics_db;
CREATE USER IF NOT EXISTS 'analytics_app'@'%' IDENTIFIED BY 'local_analytics_change_me';
GRANT ALL PRIVILEGES ON analytics_db.* TO 'analytics_app'@'%';
