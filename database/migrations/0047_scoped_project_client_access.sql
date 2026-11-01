-- Explicit, owner-provisioned, project-scoped client access.
-- Directory proposals remain inert until a revocable, one-time grant is made.
-- Raw invite/session bearer secrets are NEVER stored in D1.
CREATE TABLE IF NOT EXISTS project_client_grants_3d (
 client_id TEXT PRIMARY KEY REFERENCES project_client_directory_3d(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('viewer','editor','approver','client_admin')),
 epoch INTEGER NOT NULL DEFAULT 1 CHECK(epoch>0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 granted_by TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_client_grants_project ON project_client_grants_3d(project_id,active);
CREATE TABLE IF NOT EXISTS project_client_invitations_3d (
 token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
 client_id TEXT NOT NULL REFERENCES project_client_directory_3d(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
 grant_epoch INTEGER NOT NULL CHECK(grant_epoch>0),
 issued_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 redeemed_nonce TEXT,
 CHECK(expires_at>issued_at)
);
CREATE INDEX IF NOT EXISTS idx_client_invitation_target ON project_client_invitations_3d(project_id,client_id);
CREATE TABLE IF NOT EXISTS project_client_sessions_3d (
 token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
 client_id TEXT NOT NULL REFERENCES project_client_directory_3d(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
 grant_epoch INTEGER NOT NULL CHECK(grant_epoch>0),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 revoked_at INTEGER,
 CHECK(expires_at>created_at)
);
CREATE INDEX IF NOT EXISTS idx_client_session_project ON project_client_sessions_3d(project_id,client_id,expires_at);
CREATE TRIGGER IF NOT EXISTS trg_client_grant_owner
BEFORE INSERT ON project_client_grants_3d
WHEN NOT EXISTS(SELECT 1 FROM project_client_directory_3d c
 WHERE c.id=NEW.client_id AND c.project_id=NEW.project_id
 AND c.access_state='not_provisioned')
BEGIN SELECT RAISE(ABORT,'Project client grant ownership mismatch'); END;
CREATE TRIGGER IF NOT EXISTS trg_client_grant_owner_update
BEFORE UPDATE ON project_client_grants_3d
WHEN NEW.project_id<>OLD.project_id OR NEW.client_id<>OLD.client_id
 OR NOT EXISTS(SELECT 1 FROM project_client_directory_3d c
  WHERE c.id=NEW.client_id AND c.project_id=NEW.project_id
  AND c.access_state='not_provisioned')
BEGIN SELECT RAISE(ABORT,'Project client grant is not valid'); END;
CREATE TRIGGER IF NOT EXISTS trg_client_invite_owner
BEFORE INSERT ON project_client_invitations_3d
WHEN NOT EXISTS(SELECT 1 FROM project_client_grants_3d g
 WHERE g.client_id=NEW.client_id AND g.project_id=NEW.project_id
 AND g.epoch=NEW.grant_epoch AND g.active=1)
BEGIN SELECT RAISE(ABORT,'Client invite must be bound to an active grant'); END;
CREATE TRIGGER IF NOT EXISTS trg_client_session_owner
BEFORE INSERT ON project_client_sessions_3d
WHEN NOT EXISTS(SELECT 1 FROM project_client_grants_3d g
 WHERE g.client_id=NEW.client_id AND g.project_id=NEW.project_id
 AND g.epoch=NEW.grant_epoch AND g.active=1)
BEGIN SELECT RAISE(ABORT,'Client session must be bound to an active grant'); END;
