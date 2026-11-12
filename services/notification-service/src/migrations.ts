import { inboxMigration } from '@studybalance/service-kit';

export const migrations = [
  {
    name: '001_task_projection',
    sql: `CREATE TABLE task_projection (
      task_id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      title VARCHAR(120) NOT NULL,
      due_date DATE NOT NULL,
      remaining_minutes INT NOT NULL,
      done TINYINT(1) NOT NULL,
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      version INT NOT NULL,
      KEY idx_ntask_user_due (user_id, due_date)
    )`,
  },
  {
    name: '002_session_projection',
    sql: `CREATE TABLE session_projection (
      session_id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      date DATE NOT NULL,
      status ENUM('planned','done') NOT NULL,
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      version INT NOT NULL,
      KEY idx_nsession_user_date (user_id, date)
    )`,
  },
  {
    name: '003_preferences_projection',
    sql: `CREATE TABLE preferences_projection (
      user_id CHAR(36) PRIMARY KEY,
      reminders TINYINT(1) NOT NULL DEFAULT 1,
      timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
      version INT NOT NULL DEFAULT 0
    )`,
  },
  {
    name: '004_notifications',
    sql: `CREATE TABLE notifications (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      kind ENUM('deadline','plan') NOT NULL,
      dedupe_key VARCHAR(160) NOT NULL,
      task_id CHAR(36) NULL,
      title VARCHAR(200) NOT NULL,
      body VARCHAR(500) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      read_at DATETIME(3) NULL,
      UNIQUE KEY uq_notifications_dedupe (user_id, dedupe_key),
      KEY idx_notifications_user (user_id, created_at)
    )`,
  },
  { name: '005_inbox', sql: inboxMigration },
  {
    name: '006_session_times',
    sql: 'ALTER TABLE session_projection ADD COLUMN task_id CHAR(36) NULL, ADD COLUMN start_minute INT NULL, ADD COLUMN minutes INT NULL',
  },
  { name: '007_session_reminders', sql: "ALTER TABLE notifications MODIFY kind ENUM('deadline','plan','session') NOT NULL" },
];
