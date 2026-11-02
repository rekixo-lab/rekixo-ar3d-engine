-- Project-scoped Client Admin ID/password credentials, independent of Engine Owner.
-- Existing clients, grants, invitations and sessions remain unchanged.
-- Only SHA-256/PBKDF2 password hashes and random salts are persisted.
CREATE TABLE IF NOT EXISTS project_client_passwords_3d (
 client_id TEXT PRIMARY KEY REFERENCES project_client_directory_3d(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
 login_type TEXT NOT NULL CHECK(login_type IN ('mobile','email')),
 login_id TEXT NOT NULL,
 password_salt TEXT NOT NULL CHECK(length(password_salt)=32),
 password_hash TEXT NOT NULL CHECK(length(password_hash)=64),
 password_version INTEGER NOT NULL DEFAULT 1 CHECK(password_version>0),
 must_change_password INTEGER NOT NULL DEFAULT 1 CHECK(must_change_password IN (0,1)),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 last_login_at TEXT,
 FOREIGN KEY(client_id,project_id)
 REFERENCES project_client_grants_3d(client_id,project_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_client_password_login
 ON project_client_passwords_3d(project_id,login_id);
CREATE INDEX IF NOT EXISTS idx_project_client_password_active
 ON project_client_passwords_3d(project_id,active);

-- Atomic, bounded login rate windows. IP and login keys are SHA-256 digests.
-- No raw IP address or login identifier is stored here.
CREATE TABLE IF NOT EXISTS project_client_login_attempts_3d (
 key_hash TEXT PRIMARY KEY CHECK(length(key_hash)=64),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 window_start INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_client_login_attempts_expire
 ON project_client_login_attempts_3d(window_start);

CREATE TRIGGER IF NOT EXISTS trg_client_password_project_guard
BEFORE INSERT ON project_client_passwords_3d
WHEN NOT EXISTS(
 SELECT 1 FROM project_client_directory_3d c
 JOIN project_client_grants_3d g
 ON g.client_id=c.id AND g.project_id=c.project_id
 WHERE c.id=NEW.client_id AND c.project_id=NEW.project_id
 AND c.access_state='not_provisioned' AND g.active=1 AND g.role='client_admin'
)
BEGIN SELECT RAISE(ABORT,'Client password credentials require an active same-project Client Admin grant'); END;
