import { outboxMigration } from '@studybalance/service-kit';
import { DEFAULT_WINDOWS } from './modules/availability/defaults.js';

export const migrations = [
  {
    name: '001_users',
    sql: `CREATE TABLE users (
      id CHAR(36) PRIMARY KEY,
      email VARCHAR(254) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(60) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    )`,
  },
  {
    name: '002_refresh_tokens',
    sql: `CREATE TABLE refresh_tokens (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      family_id CHAR(36) NOT NULL,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at DATETIME(3) NOT NULL,
      revoked_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY idx_refresh_family (family_id),
      CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  },
  {
    name: '003_preferences',
    sql: `CREATE TABLE preferences (
      user_id CHAR(36) PRIMARY KEY,
      session_minutes INT NOT NULL DEFAULT 50,
      rest_minutes INT NOT NULL DEFAULT 10,
      daily_limit_minutes INT NOT NULL DEFAULT 240,
      reminders TINYINT(1) NOT NULL DEFAULT 1,
      timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
      note VARCHAR(500) NOT NULL DEFAULT '',
      version INT NOT NULL DEFAULT 1,
      CONSTRAINT fk_preferences_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  },
  { name: '004_outbox', sql: outboxMigration },
  {
    name: '005_availability',
    sql: `CREATE TABLE availability (
      user_id CHAR(36) PRIMARY KEY,
      windows JSON NOT NULL,
      version INT NOT NULL DEFAULT 1,
      CONSTRAINT fk_availability_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  },
  {
    name: '006_availability_defaults',
    sql: `INSERT IGNORE INTO availability (user_id, windows) SELECT id, CAST(? AS JSON) FROM users`,
    params: [JSON.stringify(DEFAULT_WINDOWS)],
  },
  {
    name: '007_busy_periods',
    sql: `CREATE TABLE busy_periods (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      date DATE NOT NULL,
      start_minute INT NOT NULL,
      end_minute INT NOT NULL,
      label VARCHAR(80) NOT NULL DEFAULT '',
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY idx_busy_user_date (user_id, date),
      CONSTRAINT fk_busy_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  },
  {
    name: '008_google_connections',
    sql: `CREATE TABLE google_connections (
      user_id CHAR(36) PRIMARY KEY,
      google_subject VARCHAR(255) NOT NULL,
      email VARCHAR(254) NOT NULL,
      refresh_cipher TEXT NULL,
      calendar_id VARCHAR(1024) NULL,
      selected_calendars JSON NOT NULL,
      last_sync_at DATETIME(3) NULL,
      last_attempt_at DATETIME(3) NULL,
      error_code VARCHAR(64) NULL,
      conflict_count INT NOT NULL DEFAULT 0,
      CONSTRAINT fk_google_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  },
  {
    name: '009_google_oauth_states',
    sql: `CREATE TABLE google_oauth_states (
      state_hash CHAR(64) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      browser_hash CHAR(64) NOT NULL,
      verifier_cipher TEXT NOT NULL,
      expires_at DATETIME(3) NOT NULL,
      KEY idx_google_state_expiry (expires_at),
      CONSTRAINT fk_google_state_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  },
  {
    name: '010_google_busy',
    sql: `CREATE TABLE google_busy (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      date DATE NOT NULL,
      start_minute INT NOT NULL,
      end_minute INT NOT NULL,
      KEY idx_google_busy_date (user_id, date),
      CONSTRAINT fk_google_busy_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  },
  {
    name: '011_google_exports',
    sql: `CREATE TABLE google_exports (
      user_id CHAR(36) NOT NULL,
      session_id CHAR(36) NOT NULL,
      event_id VARCHAR(128) NOT NULL,
      fingerprint CHAR(64) NULL,
      date DATE NOT NULL,
      PRIMARY KEY (user_id, session_id),
      CONSTRAINT fk_google_export_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  },
  {
    name: '012_google_busy_summary',
    sql: `ALTER TABLE google_busy ADD COLUMN summary VARCHAR(255) NOT NULL DEFAULT 'Bận · Google Calendar'`,
  },
  {
    name: '013_user_auth_provider_and_role',
    sql: `ALTER TABLE users
      ADD COLUMN auth_provider VARCHAR(20) NOT NULL DEFAULT 'local',
      ADD COLUMN google_id VARCHAR(255) NULL,
      ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'student',
      ADD KEY idx_users_google_id (google_id)`,
  },
];
