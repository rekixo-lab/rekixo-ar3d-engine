import { GEO_COMPASS_DIRECTIONS } from "../../../../shared/geo-plot-facing.js";

/**
 * Geographic compass rose shared by the customer map and plot details.
 * The parent scene sets --geo-map-north-rotation from map.getHeading().
 * Direction markers always represent stored/survey-derived WORLD directions,
 * not the angle of the current camera.
 */
export default function GeoCompassRose({
  facingDirections = [],
}: {
  facingDirections?: ReadonlyArray<string>;
}) {
  const facings = new Set(facingDirections);
  return (
    <svg className="geo-compass-rose" viewBox="0 0 72 72" aria-hidden="true">
      <circle className="geo-compass-rose__rim" cx="36" cy="36" r="34"/>
      <g className="geo-compass-rose__dial">
        {GEO_COMPASS_DIRECTIONS.map((direction, index) => {
          const angle = index * Math.PI / 4;
          const sin = Math.sin(angle);
          const cos = Math.cos(angle);
          return (
            <g key={direction.id}>
              <line className="geo-compass-rose__tick"
                x1={36 + sin * 29} y1={36 - cos * 29}
                x2={36 + sin * 32} y2={36 - cos * 32}/>
              {facings.has(direction.id) && <circle
                className="geo-compass-rose__facing-mark"
                cx={36 + sin * 32} cy={36 - cos * 32} r="3.5"/>}
            </g>
          );
        })}
        <text className="geo-compass-rose__north" x="36" y="19">N</text>
        <text className="geo-compass-rose__cardinal" x="53" y="39">E</text>
        <text className="geo-compass-rose__cardinal" x="36" y="59">S</text>
        <text className="geo-compass-rose__cardinal" x="19" y="39">W</text>
        <path className="geo-compass-rose__needle-north" d="M36 21 42 38 36 35Z"/>
        <path className="geo-compass-rose__needle-south" d="M36 51 30 34 36 37Z"/>
        <circle className="geo-compass-rose__pivot" cx="36" cy="36" r="2.3"/>
      </g>
    </svg>
  );
}
