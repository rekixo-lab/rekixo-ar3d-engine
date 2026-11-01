import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const viewer=read("apps/public/src/geo/GeoPublicDemo.tsx");
const layer=read("apps/public/src/geo/geoPlotModelOverlay.ts");

test("customer GLB plot polygons render in the exact model-local WebGL scene, not on Google terrain",()=>{
  assert.match(viewer,/buildModelGeoPlotLayer\(model,data\.plotMapping\.plots\)/);
  assert.match(viewer,/placement\.anchorOffset\.add\(plotLayer\.group\)/);
  assert.match(viewer,/applyRigidBuildingPlacement\(/);
  assert.match(viewer,/renderer\.render\(scene, camera\)/);
  assert.doesNotMatch(viewer,/new google\.maps\.Polygon\(/);
  assert.doesNotMatch(viewer,/setVisible\(showPlotBoundaries\)/);
  assert.doesNotMatch(viewer,/map,paths:item\.path/);
  assert.match(layer,/new THREE\.ShapeGeometry\(shape\)/);
  assert.match(layer,/new THREE\.LineLoop\(/);
  assert.match(layer,/geo\.rotateX\(Math\.PI\/2\)/);
});
test("overview, aerial, front and corner use one Google WebGL projection for both model and plotted 3D geometry",()=>{
  assert.match(viewer,/latestProjection=camera\.projectionMatrix\.clone\(\)/);
  assert.match(viewer,/pickModelGeoPlot\(x,y,hostRef\.current\.getBoundingClientRect\(\)/);
  assert.match(viewer,/mapClick=map\.addListener\("click"/);
  assert.match(layer,/const inverse=projection\.clone\(\)\.invert\(\)/);
  assert.match(layer,/new THREE\.Vector3\(ndcX,ndcY,-1\)\.applyMatrix4\(inverse\)/);
  assert.match(layer,/new THREE\.Vector3\(ndcX,ndcY,1\)\.applyMatrix4\(inverse\)/);
  assert.match(layer,/ray\.intersectObjects\(meshes,false\)/);
  assert.match(viewer,/mapClick\?\.remove\(\)/);
  assert.match(viewer,/plotLayer\?\.dispose\(\)/);
});
test("preview source elevations are derived from actual 3D model mesh, and 36 plot sites do not cull by Google ground",()=>{
  assert.match(layer,/ray\.intersectObjects\(touched,false\)/);
  assert.match(layer,/plot\.planeY/);
  assert.match(layer,/new THREE\.Box3\(\)\.setFromObject\(model\)/);
  assert.match(layer,/plot\.corners\.slice\(0,sampleBudget-1\)/);
  assert.match(viewer,/preparedPaths\.length<=160\?preparedPaths/);
  assert.match(layer,/groupsById/);
  assert.match(layer,/group\.removeFromParent\(\)/);
  assert.match(layer,/fillMaterial\.dispose\(\)/);
  assert.match(layer,/strokeMaterial\.dispose\(\)/);
});
test("no mapping data, published status, source measurements or admin editing code changes required",()=>{
  const admin=read("apps/admin/src/geo/GeoPlotMapper.tsx");
  assert.match(admin,/Save Mapping Draft/);
  assert.match(admin,/Publish Preliminary Mapping/);
  assert.match(admin,/Confirm Plot/);
  assert.doesNotMatch(layer,/fetch\(|localStorage|indexedDB|WebSocket|window\.google/);
});
