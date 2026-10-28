# FBX fallback when Cloudflare Containers are unavailable

The canonical FBX Processor remains **fail-closed** when `MODEL_PROCESSOR` is absent.
Cloudflare account access to Containers is a provider billing entitlement, not a Worker code switch.

For a small user-supplied FBX, Source Pack offers an **opt-in, browser-local** conversion
to reviewed GLB. It reuses Three.js' FBXLoader and GLTFExporter. No public endpoint or
secrets are exposed and the original verified FBX is never modified.

1. In Source Pack select **Choose FBX for local conversion**.
2. Check the raw dimensions, declared unit conversion, and surveyed dimensions.
   Do not guess units. An explicit operator checkbox is required.
3. Click **Generate & verify reviewed GLB**. The derived file is uploaded separately
   using the existing resumable source upload and SHA-256 server verification.
4. Start the **next Source Pack version**; keep the FBX as evidence and explicitly
   assign **geometry-authority** to the reviewed GLB. Seal only after checking both.
5. The existing Worker-native GLB canonical processing can then run without Containers.
   Complete component mapping, Building verification, and releases normally.

Limitations:
- External FBX bitmap files are not embedded; material names and mesh groups are retained.
- This does not replace audited processor-side scale review for FBX authority.
- Reviewed GLB size is capped at 256 MiB, FBX size at 64 MiB.
- Browser-generated geometry and selected scale require operator and preview verification.
- Never auto-publish or change an existing Source Pack or immutable release.
