CREATE TABLE IF NOT EXISTS engine_project_domains_3d (
 hostname TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects_3d(id) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK(status IN ('pending','active','disabled')),
 challenge TEXT NOT NULL CHECK(length(challenge)=64),
 verified_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_engine_domains_project ON engine_project_domains_3d(project_id,status);
