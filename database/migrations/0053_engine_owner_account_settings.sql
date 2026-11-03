-- Owner-controlled login credentials. Environment secrets remain initial bootstrap.
-- Increment engine_admin_security.session_version on any update to revoke all cookies.
CREATE TABLE IF NOT EXISTS engine_admin_owner_credentials_3d (
  id TEXT PRIMARY KEY CHECK(id='owner'),
  email TEXT NOT NULL CHECK(length(email) BETWEEN 3 AND 254),
  password_salt TEXT NOT NULL CHECK(length(password_salt)>=20),
  password_hash TEXT NOT NULL CHECK(length(password_hash)>=40),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at TEXT NOT NULL
);
