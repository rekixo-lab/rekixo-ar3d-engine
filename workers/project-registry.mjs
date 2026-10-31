// Engine project registry presentation; pure formatting and scoped lookup.
export function cloudProjectRow(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    location: row.location ?? undefined,
    status: row.status,
    projectKind: row.project_kind || "legacy",
    updatedAt: row.updated_at,
    draftRevision:
      row.draft_revision === null || row.draft_revision === undefined
        ? undefined
        : Number(row.draft_revision),
    assetCount: Number(row.asset_count || 0),
  };
}

export async function projectBySlug(env, slug) {
  return env.DB.prepare(
    `SELECT id,slug,name,location,status,project_kind,updated_at,active_release_id
       FROM projects_3d
      WHERE slug=?
      LIMIT 1`,
  ).bind(slug).first();
}
