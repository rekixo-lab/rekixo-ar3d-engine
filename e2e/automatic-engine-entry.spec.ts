import { expect, test } from "@playwright/test";

const project = {
  id: "e2e-project-id",
  slug: "e2e-project",
  name: "Automatic Engine E2E",
  status: "draft",
  updatedAt: "2026-10-07T00:00:00.000Z",
  assetCount: 0,
};

const reviewPayload = {
  project,
  authoritySuggestion: {
    status: "operator-review-required",
    sourceFileId: null,
    reason: "No verified source files yet.",
  },
  suggestions: [],
  latestPack: null,
  operatorApprovalRequired: true,
  immutableAfterSeal: true,
};

function json(body: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

test("legacy Studio URL enters the Automatic Engine without exposing authoring UI", async ({
  page,
}) => {
  // The control-center shell authenticates and resolves the active project before
  // rendering Source Pack. Keep this smoke test isolated from a real admin session.
  await page.route("**/3Dprojects/api/cloud/session", (route) =>
    route.fulfill(
      json({
        configured: true,
        databaseReady: true,
        authenticated: true,
        user: { email: "e2e@rekixo.test" },
      }),
    ),
  );
  await page.route(/\/3Dprojects\/api\/cloud\/projects\?/, (route) =>
    route.fulfill(
      json({
        projects: [project],
        total: 1,
        nextOffset: 1,
        hasMore: false,
      }),
    ),
  );
  await page.route(
    "**/3Dprojects/api/cloud/projects/e2e-project/releases",
    (route) => route.fulfill(json({ releases: [] })),
  );
  await page.route(
    "**/3Dprojects/api/cloud/projects/e2e-project/geo-releases",
    (route) =>
      route.fulfill(
        json({
          schemaReady: true,
          experienceId: null,
          draftRevision: null,
          previewVerified: false,
          previewVerification: null,
          activeRelease: null,
          releases: [],
        }),
      ),
  );
  await page.route(
    "**/3Dprojects/api/cloud/projects/e2e-project/source-pack-review",
    (route) => route.fulfill(json(reviewPayload)),
  );

  await page.goto("/3Dprojects/studio?project=e2e-project");

  await expect(page).toHaveURL(/\/3Dprojects\/source-pack\?project=e2e-project$/);
  await expect(page.getByRole("heading", { name: "3D Model", exact: true })).toBeVisible();
  await expect(page.getByText("Start your 3D model")).toBeVisible();
  await expect(page.getByText("Upload a GLB or FBX. Old versions remain safe.")).toBeVisible();

  await expect(page.getByLabel("Smart 3D project builder")).toHaveCount(0);
  await expect(page.getByLabel("3D editor tools")).toHaveCount(0);
});
