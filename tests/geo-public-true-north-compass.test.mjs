import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {geoMapNorthRotation} from "../shared/geo-map-compass.js";
import {geoPlotFacingEntries} from "../shared/geo-plot-facing.js";

const read = path => readFileSync(new URL("../" + path,import.meta.url),"utf8");
const scene = read("apps/public/src/geo/GeoPublicDemo.tsx");
const drawer = read("apps/public/src/geo/GeoPlotDetailsDrawer.tsx");
const rose = read("apps/public/src/geo/GeoCompassRose.tsx");
const css = read("apps/public/src/geo/geo-public-demo.css");
const drawerCss = read("apps/public/src/geo/geo-plot-details-drawer.css");

test("true north opposes Google Maps' clockwise heading, including 0/360 wrap",()=>{
  assert.equal(geoMapNorthRotation(0),0);
  assert.equal(geoMapNorthRotation(45),-45);
  assert.equal(geoMapNorthRotation(90),-90);
  assert.equal(geoMapNorthRotation(180),-180);
  assert.equal(geoMapNorthRotation(270),-270);
  assert.equal(geoMapNorthRotation(360),0);
  assert.equal(geoMapNorthRotation(-90),-270);
  assert.equal(geoMapNorthRotation(450),-90);
  assert.equal(geoMapNorthRotation(NaN),null);
  assert.equal(geoMapNorthRotation(Infinity),null);
  assert.equal(geoMapNorthRotation(undefined),null);
});

test("compass tracks actual camera bearing on touch, presets, Google-native rotation and idle",()=>{
  assert.match(scene,/geoMapNorthRotation\(rawHeading\)/);
  assert.match(scene,/mapHeadingChanged=map\.addListener\("heading_changed"/);
  assert.match(scene,/updateCompassHeading\(map\.getHeading\?\.\(\)\)/);
  assert.match(scene,/updateCompassHeading\(heading\)/);
  assert.match(scene,/updateCompassHeading\(preset\.heading\)/);
  assert.match(scene,/sceneRef\.current\?\.style\.setProperty\("--geo-map-north-rotation"/);
  assert.match(scene,/mapHeadingChanged\?\.remove\(\)/);
  assert.match(scene,/compassResetRef\.current\s*=\s*null/);
  assert.match(scene,/compassResetRef\.current=\(\)=>/);
  assert.match(scene,/map\.moveCamera\(\{heading:0\}\)/);
  assert.match(scene,/onClick=\{\(\)=>compassResetRef\.current\?\.\(\)\}/);
  assert.doesNotMatch(scene,/DeviceOrientationEvent|navigator\.geolocation/);
});

test("map compass occupies marked top-left, remains accessible and clears for plot drawer",()=>{
  assert.match(scene,/className="geo-map-compass"/);
  assert.match(scene,/aria-label="Map compass\. Tap to face north\."/);
  assert.match(css,/\.geo-map-compass \{[\s\S]*position:absolute;[\s\S]*top:12px;[\s\S]*left:12px;/);
  assert.match(css,/\.geo-compass-rose__dial \{[\s\S]*transform:rotate\(var\(--geo-map-north-rotation,0deg\)\)/);
  assert.match(css,/\.geo-integrated-scene:has\(> \.geo-plot-drawer\.is-open\) > \.geo-map-compass/);
  assert.match(css,/@media\(max-width:640px\)/);
  assert.doesNotMatch(scene,/geo-map-compass__bearing|compassBearingRef/);
  assert.match(css,/\.geo-map-compass \{[\s\S]*width:68px;[\s\S]*height:68px;[\s\S]*border:0;[\s\S]*border-radius:50%;[\s\S]*background:transparent;/);
  assert.doesNotMatch(css,/\.geo-map-compass__bearing\s*\{/);
  assert.match(css,/\.geo-compass-rose__rim\s*\{/);
  assert.match(rose,/GEO_COMPASS_DIRECTIONS\.map/);
});

test("mapped plot front and multiple geographical facings use the SAME rotating compass",()=>{
  const plot={
    corners:[[0,0],[25,0],[25,40],[0,40]],
    facing:"north",facingVerified:false,facingSource:"",
    sides:{
      front:{edges:[0],roadFacing:true,facingDirection:"west"},
      back:{edges:[2],roadFacing:false},
      depthA:{edges:[1],roadFacing:true,facingDirection:"north-east"},
      depthB:{edges:[3],roadFacing:false},
    },
  };
  // The model placement heading (here 71°) is separate from camera bearing.
  const stored=geoPlotFacingEntries(plot,71);
  assert.deepEqual(stored.map(x=>x.direction),["west","north-east"]);
  assert.deepEqual(stored.map(x=>x.role),["front","depthA"]);
  for(const cameraHeading of [0,45,90,180,270,359]){
    assert.equal(typeof geoMapNorthRotation(cameraHeading),"number");
    assert.deepEqual(geoPlotFacingEntries(plot,71),stored,
      "rotating the camera must never alter an operator-saved plot facing");
  }
  assert.match(drawer,/geoPlotFacingEntries\(shown,geoHeadingDeg\)/);
  assert.match(drawer,/GeoCompassRose facingDirections=\{facings\.map\(face=>face\.direction\)\}/);
  assert.match(drawer,/facings\.length>0/);
  assert.doesNotMatch(drawer,/geo-plot-drawer__compass-caption|TRUE NORTH/);
  assert.doesNotMatch(drawerCss,/\.geo-plot-drawer__compass-caption/);
  assert.match(drawerCss,/\.geo-plot-drawer__compass-preview\{[\s\S]*border-radius:50%/);
  assert.match(drawer,/geo-plot-drawer__facing-arrow/);
  assert.match(drawerCss,/\.geo-plot-drawer__compass-preview/);
  assert.match(rose,/facings\.has\(direction\.id\)/);
  assert.match(scene,/geoHeadingDeg=\{data\.placement\.headingDeg\}/);
  assert.doesNotMatch(drawer,/geoPlotFacingEntries\(shown,mapHeading/);
});
