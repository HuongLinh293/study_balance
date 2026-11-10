import { outboxMigration } from '@studybalance/service-kit';

export const migrations = [
  {
    name: '001_subjects',
    sql: `CREATE TABLE subjects (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      name VARCHAR(80) NOT NULL,
      short_name VARCHAR(30) NOT NULL,
      color ENUM('pink','blue','yellow','green') NOT NULL,
      teacher VARCHAR(60) NOT NULL DEFAULT '',
      credits INT NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_subjects_user (user_id)
    )`,
  },
  {
    name: '002_tasks',
    sql: `CREATE TABLE tasks (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      subject_id CHAR(36) NULL,
      title VARCHAR(120) NOT NULL,
      due_date DATE NOT NULL,
      remaining_minutes INT NOT NULL,
      priority ENUM('high','normal') NOT NULL DEFAULT 'normal',
      done TINYINT(1) NOT NULL DEFAULT 0,
      note VARCHAR(2000) NOT NULL DEFAULT '',
      version INT NOT NULL DEFAULT 1,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_tasks_user_due (user_id, due_date),
      CONSTRAINT fk_tasks_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL
    )`,
  },
  {
    name: '003_subtasks',
    sql: `CREATE TABLE subtasks (
      id CHAR(36) PRIMARY KEY,
      task_id CHAR(36) NOT NULL,
      title VARCHAR(120) NOT NULL,
      position INT NOT NULL,
      done TINYINT(1) NOT NULL DEFAULT 0,
      KEY idx_subtasks_task (task_id, position),
      CONSTRAINT fk_subtasks_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )`,
  },
  {
    name: '004_progress_updates',
    sql: `CREATE TABLE progress_updates (
      id CHAR(36) PRIMARY KEY,
      task_id CHAR(36) NOT NULL,
      user_id CHAR(36) NOT NULL,
      session_id CHAR(36) NULL UNIQUE,
      minutes INT NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY idx_progress_task (task_id),
      CONSTRAINT fk_progress_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )`,
  },
  { name: '005_outbox', sql: outboxMigration },
];
