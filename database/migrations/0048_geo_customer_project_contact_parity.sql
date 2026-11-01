-- Extend Engine-owned project contact profile without altering old releases or 2D Platform.
ALTER TABLE project_profiles_3d ADD COLUMN project_number TEXT NOT NULL DEFAULT '';
ALTER TABLE project_profiles_3d ADD COLUMN owner_name TEXT NOT NULL DEFAULT '';
-- Opt-in only: never accidentally publish old admin/owner contact records.
ALTER TABLE project_profiles_3d ADD COLUMN public_contacts_enabled INTEGER NOT NULL DEFAULT 0
  CHECK(public_contacts_enabled IN (0,1));
