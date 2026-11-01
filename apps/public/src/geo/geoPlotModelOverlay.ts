import * as THREE from "three";

/**
 * Render clickable Geo Plot outlines INSIDE the canonical GLB's own local
 * X/Z coordinate frame, using the same model anchor, heading, pitch and scale.
 * Google Maps Polygon is terrain-clamped and therefore shifts off a raised GLB
 * whenever the map camera is tilted; it must never be the visible plot layer.
 */
export type ModelGeoPlot = {
  id:string;
  corners:Array<[number,number]>;
  planeY?:number;
};
export type ModelPlotLayer = {
  group:THREE.Group;
  hitMeshes:THREE.Mesh[];
  groupsById:Map<string,THREE.Group>;
  dispose:()=>void;
};

const PLOT_COLOR=0x20d8a5;
const SURFACE_OFFSET_M=0.015;
const UP=new THREE.Vector3(0,1,0);
const DOWN=new THREE.Vector3(0,-1,0);

function averagePoint(plot:ModelGeoPlot):[number,number] {
  const n=plot.corners.length;
  return [
    plot.corners.reduce((sum,p)=>sum+p[0],0)/n,
    plot.corners.reduce((sum,p)=>sum+p[1],0)/n
  ];
}

/** Find an actual GLB surface under the mapped footprint, not Google terrain. */
function modelPlotElevation(
  plot:ModelGeoPlot,
  model:THREE.Object3D,
  bounds:THREE.Box3,
  ray:THREE.Raycaster,
  candidates:Array<{mesh:THREE.Mesh;bounds:THREE.Box3}>,
  sampleBudget:number
):number {
  if(Number.isFinite(plot.planeY))return plot.planeY!;
  const center=averagePoint(plot);
  // For modest projects check center and several corners to reject a stray
  // high gate/road mesh. For very large sites use one bounded ray per plot.
  const samples=sampleBudget>1?[center,...plot.corners.slice(0,sampleBudget-1)]:[center];
  const elevations:number[]=[];
  const inset=.0001;
  for(const [x,z] of samples){
    if(!Number.isFinite(x)||!Number.isFinite(z))continue;
    const touched=candidates.filter(item=>
      x>=item.bounds.min.x-inset&&x<=item.bounds.max.x+inset&&
      z>=item.bounds.min.z-inset&&z<=item.bounds.max.z+inset).map(item=>item.mesh);
    if(!touched.length)continue;
    ray.set(new THREE.Vector3(x,bounds.max.y+2,z),DOWN);
    const hits=ray.intersectObjects(touched,false);
    const highest=hits.find(hit=>Number.isFinite(hit.point.y));
    if(highest)elevations.push(highest.point.y);
  }
  if(elevations.length){
    elevations.sort((a,b)=>a-b);
    return elevations[Math.floor(elevations.length/2)];
  }
  // Exact same model-local fallback as the legacy top-view Mapper, but
  // rendered with the GLB transform so pitched cameras cannot drift.
  return Number.isFinite(bounds.min.y)?bounds.min.y:0;
}

function plotShapeGeometry(points:Array<[number,number]>,elevation:number){
  const shape=new THREE.Shape();
  points.forEach(([x,z],i)=>i===0?shape.moveTo(x,z):shape.lineTo(x,z));
  shape.closePath();
  const geo=new THREE.ShapeGeometry(shape);
  geo.rotateX(Math.PI/2);
  geo.translate(0,elevation+SURFACE_OFFSET_M,0);
  return geo;
}

function plotOutlineGeometry(points:Array<[number,number]>,elevation:number){
  const vertices=points.flatMap(([x,z])=>[x,elevation+SURFACE_OFFSET_M*1.75,z]);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));
  return geometry;
}

export function buildModelGeoPlotLayer(model:THREE.Object3D,plots:readonly ModelGeoPlot[]):ModelPlotLayer {
  const group=new THREE.Group();
  group.name="rekixo-geo-model-local-plot-layer";
  const groupsById=new Map<string,THREE.Group>();
  const hitMeshes:THREE.Mesh[]=[];
  const bounds=new THREE.Box3().setFromObject(model);
  model.updateMatrixWorld(true);
  const candidateMeshes:Array<{mesh:THREE.Mesh;bounds:THREE.Box3}>=[];
  model.traverse(node=>{
    if(!(node instanceof THREE.Mesh))return;
    const extent=new THREE.Box3().setFromObject(node);
    if(!extent.isEmpty())candidateMeshes.push({mesh:node,bounds:extent});
  });
  const ray=new THREE.Raycaster();
  ray.near=0;
  ray.far=Math.max(10,bounds.getSize(new THREE.Vector3()).y+10);
  const fillMaterial=new THREE.MeshBasicMaterial({
    color:PLOT_COLOR,transparent:true,opacity:.12,side:THREE.DoubleSide,
    depthTest:false,depthWrite:false
  });
  const strokeMaterial=new THREE.LineBasicMaterial({
    color:PLOT_COLOR,transparent:true,opacity:.96,depthTest:false,depthWrite:false
  });
  for(const plot of plots){
    if(!Array.isArray(plot.corners)||plot.corners.length<3)continue;
    const surfaceY=modelPlotElevation(plot,model,bounds,ray,candidateMeshes,plots.length<=120?5:1);
    const plotGroup=new THREE.Group();
    plotGroup.name="geo-plot-"+plot.id;
    const mesh=new THREE.Mesh(plotShapeGeometry(plot.corners,surfaceY),fillMaterial);
    mesh.name="geo-plot-hit-"+plot.id;
    mesh.userData.plotId=plot.id;
    mesh.renderOrder=19;
    const outline=new THREE.LineLoop(plotOutlineGeometry(plot.corners,surfaceY),strokeMaterial);
    outline.renderOrder=20;
    plotGroup.add(mesh,outline);
    group.add(plotGroup);
    groupsById.set(plot.id,plotGroup);
    hitMeshes.push(mesh);
  }
  return {group,hitMeshes,groupsById,dispose:()=>{
    for(const mesh of hitMeshes)mesh.geometry.dispose();
    for(const plotGroup of groupsById.values()){
      const outline=plotGroup.children.find(child=>child instanceof THREE.LineLoop);
      if(outline instanceof THREE.LineLoop)outline.geometry.dispose();
    }
    fillMaterial.dispose();
    strokeMaterial.dispose();
    group.removeFromParent();
  }};
}

/**
 * A Google WebGLOverlayView projection contains the entire view/projection.
 * Invert that exact frame for picking: this is NOT a terrain lat/lng click.
 */
export function pickModelGeoPlot(
  clientX:number,clientY:number,rect:Pick<DOMRect,"left"|"top"|"width"|"height">,
  projection:THREE.Matrix4,hitMeshes:readonly THREE.Mesh[]
):string|null {
  if(!Number.isFinite(clientX)||!Number.isFinite(clientY)||
    !(rect.width>0)||!(rect.height>0)||!hitMeshes.length)return null;
  const ndcX=(clientX-rect.left)/rect.width*2-1;
  const ndcY=1-(clientY-rect.top)/rect.height*2;
  if(ndcX < -1||ndcX>1||ndcY < -1||ndcY>1)return null;
  const inverse=projection.clone().invert();
  const near=new THREE.Vector3(ndcX,ndcY,-1).applyMatrix4(inverse);
  const far=new THREE.Vector3(ndcX,ndcY,1).applyMatrix4(inverse);
  if(!near.toArray().every(Number.isFinite)||!far.toArray().every(Number.isFinite))return null;
  const direction=far.sub(near).normalize();
  const ray=new THREE.Raycaster(near,direction);
  ray.near=0;
  const meshes=hitMeshes.filter(mesh=>mesh.visible&&mesh.parent?.visible&&mesh.parent.parent?.visible);
  const hits=ray.intersectObjects(meshes,false);
  return typeof hits[0]?.object.userData.plotId==="string"
    ?hits[0].object.userData.plotId:null;
}
