import {expect,test} from "@playwright/test";
import {build} from "esbuild";

test("a 3D GLB-local Plot overlay stays registered and clickable in aerial and pitched cameras",async({page})=>{
  const source=`
import * as THREE from "three";
import {buildModelGeoPlotLayer,pickModelGeoPlot} from "./apps/public/src/geo/geoPlotModelOverlay.ts";
const model=new THREE.Group();
const site=new THREE.Mesh(new THREE.BoxGeometry(20,2,20),new THREE.MeshBasicMaterial({color:0xaaaaaa}));
site.position.y=1;
model.add(site);
const gate=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),new THREE.MeshBasicMaterial({color:0x777777}));
gate.position.set(8,3,0);
model.add(gate);
// A raised boundary wall touches all four corners. An edge-sampled median
// incorrectly lifts the entire plot onto these walls; interior sampling must
// keep the mapped footprint on the actual GLB lot surface at Y=2.
for(const x of [-6,6]){
  const wall=new THREE.Mesh(new THREE.BoxGeometry(.35,2.0,12.5),
    new THREE.MeshBasicMaterial({color:0x777777}));
  wall.position.set(x,3,0);
  model.add(wall);
}
for(const z of [-6,6]){
  const wall=new THREE.Mesh(new THREE.BoxGeometry(12.5,2.0,.35),
    new THREE.MeshBasicMaterial({color:0x777777}));
  wall.position.set(0,3,z);
  model.add(wall);
}
const plots=[{id:"1",corners:[[-6,-6],[6,-6],[6,6],[-6,6]]}];
const layer=buildModelGeoPlotLayer(model,plots);
const anchor=new THREE.Group();
anchor.position.set(13,5,-7);
anchor.rotation.set(.1,.3,.15,"ZYX");
anchor.scale.setScalar(2);
anchor.add(model,layer.group);
anchor.updateMatrixWorld(true);
function exercise(position){
  const camera=new THREE.PerspectiveCamera(58,1000/700,.1,150);
  const target=new THREE.Vector3(13,9,-7);
  camera.position.set(...position);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  const projection=camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
  const world=layer.hitMeshes[0].localToWorld(new THREE.Vector3(0,0,0));
  // Geometry is positioned in model-local X/Z at the top actual GLB surface.
  const expected=new THREE.Vector3(0,2.015,0).applyMatrix4(anchor.matrixWorld);
  const projected=expected.clone().applyMatrix4(projection);
  const x=(projected.x+1)*500,y=(1-projected.y)*350;
  const picked=pickModelGeoPlot(x,y,{left:0,top:0,width:1000,height:700},projection,layer.hitMeshes);
  return {picked,offset:world.distanceTo(expected),x,y};
}
window.__geoPlotTest={
  aerial:exercise([13,70,-7]),overview:exercise([39,27,22]),front:exercise([13,15,55]),
  groupSameParent:layer.group.parent===anchor,
  outlineMesh:layer.hitMeshes.length===1,
  topOfPlotSurface:(()=>{
    layer.hitMeshes[0].geometry.computeBoundingBox();
    return layer.hitMeshes[0].geometry.boundingBox.max.y;
  })(),
  plotDepthTest:layer.hitMeshes[0].material.depthTest===true,
  wallOcclusion:layer.groupsById.get("1").children.some(child=>
    child.isLineLoop&&child.material.depthTest===true)
};
layer.dispose();
`;
  const compiled=await build({stdin:{contents:source,resolveDir:process.cwd(),
    sourcefile:"geo-plot-projection-fixture.ts",loader:"ts"},platform:"browser",
    format:"iife",bundle:true,write:false,logLevel:"silent"});
  // A standalone THREE projection fixture must not follow Studio auth redirects.
  await page.goto("about:blank");
  await page.addScriptTag({content:compiled.outputFiles[0].text});
  const result=await page.evaluate(()=>(
    window as Window&{__geoPlotTest?:{
      aerial:{picked:string|null;offset:number;x:number;y:number};
      overview:{picked:string|null;offset:number;x:number;y:number};
      front:{picked:string|null;offset:number;x:number;y:number};
      groupSameParent:boolean;outlineMesh:boolean;
      topOfPlotSurface:number;plotDepthTest:boolean;wallOcclusion:boolean
    }}
  ).__geoPlotTest);
  expect(result?.groupSameParent).toBe(true);
  expect(result?.outlineMesh).toBe(true);
  expect(result?.topOfPlotSurface).toBeCloseTo(2.015,3);
  expect(result?.plotDepthTest).toBe(true);
  expect(result?.wallOcclusion).toBe(true);
  for(const view of ["aerial","overview","front"] as const){
    expect(result?.[view].picked,view+" should select same 3D plot").toBe("1");
    expect(result?.[view].x,view+" visible in viewport").toBeGreaterThan(0);
    expect(result?.[view].x).toBeLessThan(1000);
    expect(result?.[view].y).toBeGreaterThan(0);
    expect(result?.[view].y).toBeLessThan(700);
  }
});
