import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  clearReviewedComponentBindings,
  type ReviewedComponentBindingInput,
  type ReviewedComponentBindingsV1,
  type ReviewedComponentSemantic,
  saveReviewedComponentBindings,
} from "../studio/componentBindingsCloud";
import "./component-mapper.css";

const CLOUD_BASE = "/3Dprojects/api/cloud";
const PAGE_SIZE = 80;

interface MapperFloor {
  id: string;
  name: string;
  elevation: number;
}

interface MapperRoom {
  id: string;
  name: string;
  floorId: string;
  unit: string;
}

interface MapperNode {
  id: string;
  index: number;
  name: string | null;
  parentId: string | null;
  childIds: string[];
  meshIndex: number | null;
  primitiveCount: number;
  materialIndices: number[];
}

interface MapperPayload {
  contractVersion: 1;
  schemaReady: true;
  project: {
    id: string;
    slug: string;
    name: string;
    status: string;
  };
  draft: {
    revision: number;
    updatedAt: string;
    floors: MapperFloor[];
    rooms: MapperRoom[];
  } | null;
  processing: {
    sourcePackId: string | null;
    sourcePackVersion: number | null;
    sourcePackManifestSha256: string | null;
    processingJobId: string | null;
    processorVersion: string;
    attempt: number | null;
    state: string | null;
    outputManifestSha256: string | null;
  };
  reviewedComponentBindings: ReviewedComponentBindingsV1 | null;
  mappingReady: boolean;
  reason: string | null;
  bindingStatus?: "none" | "current" | "stale";
  canonical?: {
    modelArtifactId: string;
    modelSha256: string;
    manifestArtifactId: string;
    manifestSha256: string;
    nodeCatalogArtifactId: string;
    nodeCatalogSha256: string;
    statistics?: {
      nodeCount?: number;
      selectableNodeCount?: number;
      namedNodeCount?: number;
      duplicateNameGroupCount?: number;
    };
  };
  catalogPage?: {
    query: string;
    offset: number;
    limit: number;
    total: number;
    totalSelectable: number;
    hasMore: boolean;
    nodes: MapperNode[];
  };
  error?: string;
}

type BindingMap = Record<string, ReviewedComponentBindingInput>;

function selectedProjectSlug() {
  return new URLSearchParams(window.location.search).get("project")?.trim().toLowerCase() || "";
}

function mapperPath(slug: string, query: string, offset: number) {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  if (query.trim()) params.set("q", query.trim());
  return `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/component-mapper?${params.toString()}`;
}

function shortSha(value: string | null | undefined) {
  return value ? `${value.slice(0, 12)}…` : "—";
}

function shortNode(value: string | null | undefined) {
  if (!value) return "ROOT";
  const match = /:([0-9]+)$/.exec(value);
  return match ? `node #${match[1]}` : value.slice(-18);
}

function normalizeBindingMap(block: ReviewedComponentBindingsV1 | null): BindingMap {
  const result: BindingMap = {};
  for (const binding of block?.bindings ?? []) result[binding.nodeId] = { ...binding };
  return result;
}

function sortedBindings(map: BindingMap) {
  return Object.values(map)
    .filter(
      (binding) =>
        binding.floorId || binding.unit || binding.roomId || binding.semantic,
    )
    .map((binding) => ({
      nodeId: binding.nodeId,
      ...(binding.floorId ? { floorId: binding.floorId } : {}),
      ...(binding.unit ? { unit: binding.unit } : {}),
      ...(binding.roomId ? { roomId: binding.roomId } : {}),
      ...(binding.semantic ? { semantic: binding.semantic } : {}),
    }))
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}

function bindingFingerprint(map: BindingMap) {
  return JSON.stringify(sortedBindings(map));
}

const semantics: Array<[ReviewedComponentSemantic, string]> = [
  ["wall", "Wall"],
  ["door", "Door"],
  ["window", "Window"],
  ["opening", "Opening"],
  ["ignore", "Ignore"],
];

export default function ComponentMapper() {
  const slug = selectedProjectSlug();
  const [data, setData] = useState<MapperPayload>();
  const [bindings, setBindings] = useState<BindingMap>({});
  const [baseline, setBaseline] = useState("[]");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const dirty = bindingFingerprint(bindings) !== baseline;
  const mappedCount = Object.keys(bindings).length;

  async function load(nextQuery = appliedQuery, nextOffset = offset, resetBindings = false) {
    if (!slug) {
      setError("Project select karke Component Mapper open karein.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(mapperPath(slug, nextQuery, nextOffset), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload = (await response.json()) as MapperPayload;
      if (!response.ok)
        throw new Error(payload.error || `Component Mapper API failed (${response.status}).`);
      setData(payload);
      setAppliedQuery(nextQuery);
      setOffset(nextOffset);
      if (resetBindings) {
        const next = normalizeBindingMap(payload.reviewedComponentBindings);
        setBindings(next);
        setBaseline(bindingFingerprint(next));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Component Mapper load nahi hua.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load("", 0, true);
  }, [slug]);

  const rooms = data?.draft?.rooms ?? [];
  const floors = data?.draft?.floors ?? [];
  const roomsById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);

  function writeBinding(nodeId: string, next: ReviewedComponentBindingInput) {
    const hasTarget = Boolean(next.floorId || next.unit || next.roomId || next.semantic);
    setBindings((current) => {
      const copy = { ...current };
      if (hasTarget) copy[nodeId] = next;
      else delete copy[nodeId];
      return copy;
    });
    setMessage("");
  }

  function changeFloor(nodeId: string, floorId: string) {
    const current = bindings[nodeId] ?? { nodeId };
    const room = current.roomId ? roomsById.get(current.roomId) : undefined;
    writeBinding(nodeId, {
      ...current,
      floorId: floorId || undefined,
      ...(room && floorId && room.floorId !== floorId ? { roomId: undefined } : {}),
    });
  }

  function changeUnit(nodeId: string, unit: string) {
    const current = bindings[nodeId] ?? { nodeId };
    const room = current.roomId ? roomsById.get(current.roomId) : undefined;
    writeBinding(nodeId, {
      ...current,
      unit: unit || undefined,
      ...(room && unit && room.unit !== unit ? { roomId: undefined } : {}),
    });
  }

  function changeRoom(nodeId: string, roomId: string) {
    const current = bindings[nodeId] ?? { nodeId };
    const room = roomId ? roomsById.get(roomId) : undefined;
    writeBinding(nodeId, {
      ...current,
      roomId: room?.id,
      ...(room ? { floorId: room.floorId, unit: room.unit || undefined } : {}),
    });
  }

  function changeSemantic(nodeId: string, semantic: string) {
    const current = bindings[nodeId] ?? { nodeId };
    writeBinding(nodeId, {
      ...current,
      semantic: (semantic || undefined) as ReviewedComponentSemantic | undefined,
    });
  }

  function clearNode(nodeId: string) {
    setBindings((current) => {
      const copy = { ...current };
      delete copy[nodeId];
      return copy;
    });
    setMessage("");
  }

  function search(event: FormEvent) {
    event.preventDefault();
    void load(query, 0, false);
  }

  async function save() {
    if (!data?.mappingReady || !data.draft || !data.processing.processingJobId || !dirty) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = sortedBindings(bindings);
      if (next.length === 0) {
        if (data.reviewedComponentBindings)
          await clearReviewedComponentBindings(slug, data.draft.revision);
      } else {
        await saveReviewedComponentBindings(
          slug,
          data.draft.revision,
          data.processing.processingJobId,
          next,
        );
      }
      setMessage(next.length ? `${next.length} reviewed component bindings saved.` : "Reviewed component bindings cleared.");
      await load(appliedQuery, offset, true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Reviewed bindings save nahi hue.");
    } finally {
      setBusy(false);
    }
  }

  async function clearAll() {
    if (!data?.draft || !data.reviewedComponentBindings) return;
    if (!window.confirm("Saare reviewed component bindings clear karne hain?")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await clearReviewedComponentBindings(slug, data.draft.revision);
      setMessage("All reviewed component bindings cleared.");
      await load(appliedQuery, 0, true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Reviewed bindings clear nahi hue.");
    } finally {
      setBusy(false);
    }
  }

  const page = data?.catalogPage;
  const start = page && page.total ? page.offset + 1 : 0;
  const end = page ? page.offset + page.nodes.length : 0;

  return (
    <main className="component-mapper">
      <header className="component-mapper__topbar">
        <a href={`/3Dprojects/building?project=${encodeURIComponent(slug)}&tab=source`}>← Source Pack</a>
        <div>
          <small>REKIXO AR3D ENGINE</small>
          <strong>Reviewed Component Mapper</strong>
        </div>
        <a href={`/3Dprojects?project=${encodeURIComponent(slug)}`}>Projects</a>
      </header>

      <section className="component-mapper__hero">
        <div>
          <p>03 · CANONICAL COMPONENT REVIEW</p>
          <h1>{data?.project.name ?? "Component Mapper"}</h1>
          <span>Verified canonical node IDs → floor / unit / room / semantic bindings</span>
        </div>
        <div className="component-mapper__identity">
          <small>CANONICAL MODEL</small>
          <strong>{shortSha(data?.canonical?.modelSha256)}</strong>
          <span>Catalog {shortSha(data?.canonical?.nodeCatalogSha256)}</span>
        </div>
      </section>

      {error ? <div className="component-mapper__alert component-mapper__alert--error">{error}</div> : null}
      {message ? <div className="component-mapper__alert component-mapper__alert--ok">{message}</div> : null}

      {!data?.mappingReady ? (
        <section className="component-mapper__blocked">
          <p>MAPPER LOCKED</p>
          <h2>Canonical mapping prerequisites incomplete</h2>
          <span>{data?.reason ?? (busy ? "Checking canonical processing…" : "Mapper state unavailable.")}</span>
        </section>
      ) : (
        <>
          <section className="component-mapper__summary">
            <article>
              <span>SELECTABLE NODES</span>
              <strong>{page?.totalSelectable ?? data.canonical?.statistics?.selectableNodeCount ?? 0}</strong>
              <small>{data.canonical?.statistics?.nodeCount ?? 0} total catalog nodes</small>
            </article>
            <article>
              <span>REVIEWED BINDINGS</span>
              <strong>{mappedCount}</strong>
              <small>{dirty ? "Unsaved mapping changes" : "Cloud draft synchronized"}</small>
            </article>
            <article>
              <span>BINDING IDENTITY</span>
              <strong>{data.bindingStatus === "stale" ? "STALE" : data.bindingStatus === "current" ? "CURRENT" : "NEW"}</strong>
              <small>Draft revision {data.draft?.revision ?? "—"} · job {data.processing.attempt ?? "—"}</small>
            </article>
          </section>

          {data.bindingStatus === "stale" ? (
            <section className="component-mapper__warning">
              Existing reviewed bindings point to an older canonical output. Saving here will replace them against the currently verified model/catalog identity.
            </section>
          ) : null}

          <section className="component-mapper__toolbar">
            <form onSubmit={search}>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search node name or canonical node ID"
                maxLength={160}
              />
              <button type="submit" disabled={busy}>Search</button>
            </form>
            <div>
              <span>{page ? `${start}-${end} of ${page.total}` : "0 nodes"}</span>
              <button
                type="button"
                disabled={busy || !page || page.offset <= 0}
                onClick={() => void load(appliedQuery, Math.max(0, offset - PAGE_SIZE), false)}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={busy || !page?.hasMore}
                onClick={() => void load(appliedQuery, offset + PAGE_SIZE, false)}
              >
                Next
              </button>
            </div>
          </section>

          <section className="component-mapper__nodes">
            {page?.nodes.map((node) => {
              const binding = bindings[node.id] ?? { nodeId: node.id };
              const floorRooms = binding.floorId
                ? rooms.filter((room) => room.floorId === binding.floorId)
                : rooms;
              const units = [...new Set(
                floorRooms.map((room) => room.unit.trim()).filter(Boolean),
              )].sort((left, right) => left.localeCompare(right));
              const unitRooms = binding.unit
                ? floorRooms.filter((room) => room.unit === binding.unit)
                : floorRooms;
              const mapped = Boolean(bindings[node.id]);
              return (
                <article className={mapped ? "component-node component-node--mapped" : "component-node"} key={node.id}>
                  <div className="component-node__identity">
                    <div>
                      <span>{mapped ? "REVIEWED TARGET" : "UNMAPPED"}</span>
                      <h3>{node.name || `Node ${node.index}`}</h3>
                      <small>{shortNode(node.parentId)} · mesh {node.meshIndex ?? "—"} · {node.primitiveCount} primitive{node.primitiveCount === 1 ? "" : "s"}</small>
                    </div>
                    <code title={node.id}>{node.id}</code>
                  </div>

                  <div className="component-node__fields">
                    <label>
                      <span>Floor</span>
                      <select value={binding.floorId ?? ""} onChange={(event) => changeFloor(node.id, event.target.value)}>
                        <option value="">—</option>
                        {floors.map((floor) => <option value={floor.id} key={floor.id}>{floor.name}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Unit</span>
                      <select value={binding.unit ?? ""} onChange={(event) => changeUnit(node.id, event.target.value)}>
                        <option value="">—</option>
                        {units.map((unit) => <option value={unit} key={unit}>{unit}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Room</span>
                      <select value={binding.roomId ?? ""} onChange={(event) => changeRoom(node.id, event.target.value)}>
                        <option value="">—</option>
                        {unitRooms.map((room) => <option value={room.id} key={room.id}>{room.name}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Semantic</span>
                      <select value={binding.semantic ?? ""} onChange={(event) => changeSemantic(node.id, event.target.value)}>
                        <option value="">—</option>
                        {semantics.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={() => clearNode(node.id)} disabled={!mapped}>Clear</button>
                  </div>
                </article>
              );
            })}
            {!busy && page?.nodes.length === 0 ? (
              <div className="component-mapper__empty">No selectable nodes matched this search.</div>
            ) : null}
          </section>

          <section className="component-mapper__actions">
            <div>
              <strong>{dirty ? "Unsaved reviewed mappings" : "Reviewed mappings synchronized"}</strong>
              <span>Save pins the full binding set to this exact processing job, canonical model SHA and verified node-catalog SHA.</span>
            </div>
            <button type="button" onClick={() => void clearAll()} disabled={busy || !data.reviewedComponentBindings}>
              Clear all
            </button>
            <button className="component-mapper__save" type="button" onClick={() => void save()} disabled={busy || !dirty}>
              {busy ? "Saving…" : "Save reviewed mappings"}
            </button>
          </section>
        </>
      )}
    </main>
  );
}
