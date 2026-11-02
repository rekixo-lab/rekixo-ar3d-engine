import GeoMapper3DV2 from "./GeoMapper3DV2";
import "./geo-control-center.css";

// One map editor owns the release selection, real-world alignment,
// fine tuning, verification and publication. The previous wrapper repeated
// those same steps above the mapper and made the workflow hard to follow.
export default function GeoWorkspace() {
  return <GeoMapper3DV2 />;
}
