const origin = 'https://admin.rekixo.com';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(path, kind, attempts = 5) {
  let diagnostic = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const url = new URL(path, origin);
    url.searchParams.set("_rekixo_verify", `${Date.now()}-${attempt}`);
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(30000),
      });
      const type = res.headers.get("content-type") || "";
      if (res.ok && type.includes(kind)) return res.text();
      diagnostic = `HTTP ${res.status}, content-type ${type || "(missing)"}`;
    } catch (error) {
      diagnostic = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) await sleep(3000);
  }
  throw Error(
    `Automatic Engine Admin verification failed after propagation retries: ${path} (${diagnostic})`,
  );
}

async function getFreshAdminEntry() {
  let diagnostic = "";

  // The HTML shell and hashed entry asset can propagate through Cloudflare
  // at slightly different times. Refresh both together instead of pinning
  // one stale hashed asset for every retry.
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const html = await get('/3Dprojects/source-pack', 'text/html', 1);
      const entry = html.match(/src="(\/3Dprojects\/assets\/[^" ]+\.js)"/);

      if (!entry) {
        diagnostic = 'Missing Automatic Engine Admin entry script.';
      } else {
        try {
          const code = await get(entry[1], 'javascript', 1);
          return { html, entry, code };
        } catch (error) {
          diagnostic = error instanceof Error ? error.message : String(error);
        }
      }
    } catch (error) {
      diagnostic = error instanceof Error ? error.message : String(error);
    }

    if (attempt < 10) await sleep(3000);
  }

  throw Error(
    `Automatic Engine Admin entry did not converge after propagation retries: ${diagnostic}`,
  );
}

const adminNavigationRoutes = [
  { path: "/3Dprojects?project=route-smoke", label: "overview with project query" },
  { path: "/3Dprojects/building?project=route-smoke", label: "Building deep link" },
  { path: "/3Dprojects/geo-mapper?project=route-smoke", label: "Geo deep link" },
  { path: "/3Dprojects/releases?project=route-smoke", label: "Releases deep link" },
  { path: "/3Dprojects/advanced?project=route-smoke", label: "Advanced deep link" },
];

for (const route of adminNavigationRoutes) {
  const html = await get(route.path, "text/html");
  if (!html.includes("<title>Rekixo 3D Projects</title>")) {
    throw Error(`Admin ${route.label} did not return the SPA document shell.`);
  }
}

const { html, entry, code } = await getFreshAdminEntry();

if (!html.includes('href="/3Dprojects/favicon.svg"')) throw Error('Missing 3D Engine Admin favicon link.');
const favicon = await get('/3Dprojects/favicon.svg', 'image/svg+xml');
for (const gold of ['#FFD166', '#B77900', '#E4A11B'])
  if (!favicon.includes(gold)) throw Error(`Deployed golden favicon is missing ${gold}.`);

if (!code.includes('/3Dprojects/source-pack')) {
  throw Error('Deployed admin entry is missing the Automatic Engine Source Pack route.');
}
if (!code.includes('/3Dprojects/studio')) {
  throw Error('Deployed admin entry is missing the legacy Studio redirect boundary.');
}
const sourcePack = code.match(/(?:\.\/)?(SourcePackReview-[\w-]+\.js)/);
if (!sourcePack) throw Error('The deployed admin has no Source Pack Review bundle.');
const sourcePackCode = await get(`/3Dprojects/assets/${sourcePack[1]}`, 'javascript');
// The old operator stepper and long-form "Refresh automatic analysis" button
// were intentionally removed in the compact Building Editor. Verify the
// current safe model selector + private preparation gate instead.
for (const feature of ['3D Model', 'Select verified 3D model', 'Use This Model & Prepare', 'SEAL SOURCE PACK']) {
  if (!sourcePackCode.includes(feature)) throw Error(`Deployed Automatic Engine is missing ${feature}.`);
}

const legacyStudio = code.match(/(?:\.\/)?(Studio-[\w-]+\.js)/);
if (legacyStudio) {
  throw Error(`Legacy Studio bundle is still referenced by the production Admin entry: ${legacyStudio[1]}`);
}

console.log(`Automatic Engine Admin entry and Source Pack workflow verified: ${sourcePack[1]}`);

const catalog = JSON.parse(await get('/3Dprojects/published/catalog.json', 'json'));
for (const entry of catalog) {
  const manifest = JSON.parse(await get(`/3Dprojects/published/${entry.slug}/manifest.json`, 'json'));
  if (manifest.project.slug !== entry.slug) throw Error('Published slug mismatch');
  for (const a of manifest.assets) {
    const response = await fetch(`${origin}/3Dprojects/published/${entry.slug}/${a.path}`);
    if (!response.ok) throw Error('Published model unavailable');
    const bytes = await response.arrayBuffer();
    const { createHash } = await import('node:crypto');
    if (bytes.byteLength !== a.size || createHash('sha256').update(Buffer.from(bytes)).digest('hex') !== a.hash) throw Error('Live published model checksum mismatch');
  }
  console.log(`Published design and model verified: ${entry.slug}`);
}
