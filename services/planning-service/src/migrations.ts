import { inboxMigration, outboxMigration } from '@studybalance/service-kit';

export const migrations = [
  {
    name: '001_task_projection',
    sql: `CREATE TABLE task_projection (
      task_id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      subject_id CHAR(36) NULL,
      due_date DATE NOT NULL,
      remaining_minutes INT NOT NULL,
      done TINYINT(1) NOT NULL,
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      version INT NOT NULL,
      KEY idx_task_projection_user (user_id)
    )`,
  },
  {
    name: '002_preferences_projection',
    sql: `CREATE TABLE preferences_projection (
      user_id CHAR(36) PRIMARY KEY,
      rest_minutes INT NOT NULL DEFAULT 10,
      daily_limit_minutes INT NOT NULL DEFAULT 240,
      timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
      version INT NOT NULL DEFAULT 0
    )`,
  },
  {
    name: '003_study_sessions',
    sql: `CREATE TABLE study_sessions (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      task_id CHAR(36) NOT NULL,
      date DATE NOT NULL,
      start_minute INT NOT NULL,
      minutes INT NOT NULL,
      status ENUM('planned','done') NOT NULL DEFAULT 'planned',
      actual_minutes INT NULL,
      version INT NOT NULL DEFAULT 1,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_sessions_user_date (user_id, date),
      KEY idx_sessions_task (task_id)
    )`,
  },
  {
    name: '004_simulations',
    sql: `CREATE TABLE simulations (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      scenario ENUM('afternoon','whole') NOT NULL,
      date DATE NOT NULL,
      result JSON NOT NULL,
      basis JSON NOT NULL,
      status ENUM('preview','applied','stale') NOT NULL DEFAULT 'preview',
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      applied_at DATETIME(3) NULL,
      KEY idx_simulations_user (user_id, created_at)
    )`,
  },
  { name: '005_inbox', sql: inboxMigration },
  { name: '006_outbox', sql: outboxMigration },
  {
    name: '007_preferences_session_minutes',
    sql: 'ALTER TABLE preferences_projection ADD COLUMN session_minutes INT NOT NULL DEFAULT 50',
  },
  {
    name: '008_task_priority',
    sql: "ALTER TABLE task_projection ADD COLUMN priority ENUM('high','normal') NOT NULL DEFAULT 'normal'",
  },
  {
    name: '009_availability_projection',
    sql: `CREATE TABLE availability_projection (
      user_id CHAR(36) PRIMARY KEY,
      windows JSON NOT NULL,
      busy JSON NOT NULL,
      version INT NOT NULL
    )`,
  },
  {
    name: '010_simulations_custom_range',
    sql: 'ALTER TABLE simulations MODIFY scenario VARCHAR(16) NOT NULL',
  },
  {
    name: '011_plan_proposals',
    sql: `CREATE TABLE plan_proposals (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      date DATE NOT NULL,
      result JSON NOT NULL,
      basis JSON NOT NULL,
      status ENUM('preview','applied','stale') NOT NULL DEFAULT 'preview',
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      applied_at DATETIME(3) NULL,
      KEY idx_plan_proposals_user (user_id, created_at)
    )`,
  },
];
