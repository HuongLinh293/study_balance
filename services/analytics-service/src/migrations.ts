import { inboxMigration } from '@studybalance/service-kit';

export const migrations = [
  {
    name: '001_task_facts',
    sql: `CREATE TABLE task_facts (
      task_id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      subject_id CHAR(36) NULL,
      done TINYINT(1) NOT NULL,
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      version INT NOT NULL,
      KEY idx_task_facts_user (user_id)
    )`,
  },
  {
    name: '002_session_facts',
    sql: `CREATE TABLE session_facts (
      session_id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      task_id CHAR(36) NOT NULL,
      date DATE NOT NULL,
      actual_minutes INT NOT NULL,
      completed_at DATETIME(3) NOT NULL,
      KEY idx_session_facts_user_date (user_id, date)
    )`,
  },
  {
    name: '003_preferences_projection',
    sql: `CREATE TABLE preferences_projection (
      user_id CHAR(36) PRIMARY KEY,
      timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
      version INT NOT NULL DEFAULT 0
    )`,
  },
  { name: '004_inbox', sql: inboxMigration },
  { name: '005_session_planned', sql: 'ALTER TABLE session_facts ADD COLUMN planned_minutes INT NULL' },
  { name: '006_task_due_dates', sql: 'ALTER TABLE task_facts ADD COLUMN due_date DATE NULL, ADD COLUMN completed_on DATE NULL' },
];
