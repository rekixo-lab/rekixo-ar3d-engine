import { useEffect, useMemo, useState } from "react";
import PresentationCanvas, { type View } from "./PresentationCanvas";
import { loadPublished, type PublishedDesign } from "./published";
import "./studio.css";

export default function PublishedViewer() {
  const slug = location.pathname.replace(/\/$/, "").split("/").pop() ?? "";
  const [design, setDesign] = useState<PublishedDesign>();
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("building");
  const [roomId, setRoomId] = useState("");

  useEffect(() => {
    let active = true;
    loadPublished(slug)
      .then((published) => {
        if (active) {
          setDesign(published);
          setRoomId(published.project.scene.rooms[0]?.id ?? "");
        }
      })
      .catch((reason) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
    };
  }, [slug]);

  const resolveAsset = useMemo(
    () => async (key: string) => design?.files.find((file) => file.id === key),
    [design],
  );

  if (!design)
    return (
      <main className="studio">
        <h1>Published 3D design</h1>
        <p role="status">{error || "Loading published 3D design…"}</p>
        <a href="/3Dprojects/studio">Design Admin</a>
      </main>
    );

  const room = design.project.scene.rooms.find((entry) => entry.id === roomId);
  return (
    <main className="studio published-design">
      <header className="studio-head">
        <div>
          <small>AR 3D · PUBLISHED 3D DESIGN</small>
          <h1>{design.project.name}</h1>
        </div>
        <a href="/3Dprojects/studio">Open Design Admin</a>
      </header>
      <nav className="canvas-toolbar" aria-label="Project views">
        {(["building", "rooms", "walk"] as View[]).map((nextView) => (
          <button
            key={nextView}
            disabled={nextView !== "building" && !room}
            aria-pressed={view === nextView}
            onClick={() => setView(nextView)}
          >
            {nextView === "building"
              ? "Building"
              : nextView === "rooms"
                ? "Interior draft"
                : "Walk room"}
          </button>
        ))}
        <label>
          Room{" "}
          <select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
            {design.project.scene.rooms.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.unit} · {entry.name}
              </option>
            ))}
          </select>
        </label>
      </nav>
      <section className="published-canvas">
        <PresentationCanvas
          scene={design.project.scene}
          resolveAsset={resolveAsset}
          roomId={roomId}
          selected={roomId}
          view={view}
          onSelect={(key) => {
            if (design.project.scene.rooms.some((entry) => entry.id === key))
              setRoomId(key);
          }}
          onMesh={() => {}}
          onWalkRoomChange={(nextRoomId) => setRoomId(nextRoomId)}
        />
      </section>
      <footer className="storage-banner">
        Drag to rotate · scroll/pinch to zoom.{" "}
        {room && view !== "building" && (
          <span>
            {room.width} × {room.depth} × {room.height} m ·{" "}
            {room.verified
              ? "Reviewed dimensions"
              : "Draft interior layout — requires alignment and review"}
          </span>
        )}
        <span>
          Published snapshot · editing a local copy does not change this link.
        </span>
      </footer>
    </main>
  );
}
