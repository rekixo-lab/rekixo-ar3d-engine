import * as THREE from "three";
import {createGeoPlotSelectionFocus, type GeoPlotFocusSource} from "./geoPlotSelectionFocus";
import {pointInScreenTriangle} from "../../../../shared/geo-plot-screen-hit.js";
import type {GeoPlotStatus} from "../../../../shared/geo-plot-status.js";

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
  setSelectedPlot:(id:string|null)=>void;
  tickSelection:(now:number,reducedMotion:boolean)=>boolean;
  setStatusPresentation:(enabled:boolean,filter:GeoPlotStatus|null,
    approved:Readonly<Record<string,GeoPlotStatus>>)=>void;
  dispose:()=>void;
};

const PLOT_COLOR=0x20d8a5;
const SURFACE_OFFSET_M=0.015;
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
  bounds:THREE.Box3,
  ray:THREE.Raycaster,
  candidates:Array<{mesh:THREE.Mesh;bounds:THREE.Box3}>,
  sampleBudget:number
):number {
  if(Number.isFinite(plot.planeY))return plot.planeY!;
  const center=averagePoint(plot);
  // For modest projects check center and several corners to reject a stray
  // high gate/road mesh. For very large sites use one bounded ray per plot.
  // Do not raycast at polygon corners: SATHARAI's corner points can lie
  // exactly on a raised boundary wall. Four wall-top hits would otherwise
  // dominate the median and float the *entire* plot above its actual lot.
  // Sample comfortably INSIDE the footprint instead, along center-to-corner
  // segments, so neighboring walls and roads cannot set the plot height.
  const samples=sampleBudget>1?[center,...plot.corners.slice(0,sampleBudget-1)
    .map(([x,z]):[number,number]=>[
      center[0]+(x-center[0])*0.3,
      center[1]+(z-center[1])*0.3
    ])]:[center];
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
  const focus=createGeoPlotSelectionFocus();
  group.add(focus.group);
  const focusSources=new Map<string,GeoPlotFocusSource>();
  let currentApproved:Readonly<Record<string,GeoPlotStatus>>={};
  const selectedAccent=(id:string)=>currentApproved[id]==="sold"?0xf04b58
    :currentApproved[id]==="booked"?0xf2bf25:0x1cd680;
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
    color:PLOT_COLOR,transparent:true,opacity:0,side:THREE.DoubleSide,
    // Keep the model's real depth buffer: a plot behind a 3D wall MUST be
    // occluded in Overview, Front and Corner. Disabling depthTest drew these
    // lines through and beyond boundary walls at steep camera tilts.
    depthTest:true,depthWrite:false
  });
  const strokeMaterial=new THREE.LineBasicMaterial({
    color:PLOT_COLOR,transparent:true,opacity:0,depthTest:true,depthWrite:false
  });
  // Reuse one material pair for each state, not one allocation per polygon.
  // Keep the map visually natural when status is OFF, while transparent hit
  // meshes still receive normal model-local plot clicks and open the drawer.
  const tinted=(color:number,fillOpacity:number,strokeOpacity:number)=>{
    const fill=fillMaterial.clone();
    fill.color.setHex(color);
    fill.opacity=fillOpacity;
    const stroke=strokeMaterial.clone();
    stroke.color.setHex(color);
    stroke.opacity=strokeOpacity;
    return {fill,stroke};
  };
  const palette={
    neutral:{fill:fillMaterial,stroke:strokeMaterial},
    available:tinted(0x1cd680,.44,.96),
    booked:tinted(0xf2bf25,.52,.96),
    sold:tinted(0xf04b58,.58,.97),
    // When one status filter is selected, hide other fills entirely.
    dim:tinted(0x708891,0,0)
  };
  const plotVisuals=new Map<string,{fill:THREE.Mesh;outline:THREE.LineLoop}>();
  for(const plot of plots){
    if(!Array.isArray(plot.corners)||plot.corners.length<3)continue;
    const surfaceY=modelPlotElevation(plot,bounds,ray,candidateMeshes,plots.length<=120?5:1);
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
    focusSources.set(plot.id,{id:plot.id,corners:plot.corners,surfaceY});
    plotVisuals.set(plot.id,{fill:mesh,outline});
    hitMeshes.push(mesh);
  }
  const setStatusPresentation:ModelPlotLayer["setStatusPresentation"]=
    (enabled,filter,approved)=>{
      currentApproved=approved;
      for(const [id,parts] of plotVisuals){
        const value=Object.prototype.hasOwnProperty.call(approved,id)?approved[id]:undefined;
        const valid=value==="available"||value==="booked"||value==="sold"
          ?value:"available";
        const style=!enabled?palette.neutral
          :filter&&valid!==filter?palette.dim
          :palette[valid];
        parts.fill.material=style.fill;
        parts.outline.material=style.stroke;
      }
      if(focus.selectedId)focus.setAccent(selectedAccent(focus.selectedId));
    };
  const setSelectedPlot:ModelPlotLayer["setSelectedPlot"]=(id)=>{
    focus.select(id?focusSources.get(id)||null:null,
      id?selectedAccent(id):0x1cd680,performance.now());
  };
  const tickSelection:ModelPlotLayer["tickSelection"]=(now,reducedMotion)=>
    focus.update(now,reducedMotion);
  return {group,hitMeshes,groupsById,setSelectedPlot,tickSelection,setStatusPresentation,dispose:()=>{
    focus.dispose();
    for(const mesh of hitMeshes)mesh.geometry.dispose();
    for(const plotGroup of groupsById.values()){
      const outline=plotGroup.children.find(child=>child instanceof THREE.LineLoop);
      if(outline instanceof THREE.LineLoop)outline.geometry.dispose();
    }
    fillMaterial.dispose();
    strokeMaterial.dispose();
    for(const [name,style] of Object.entries(palette)){
      if(name==="neutral")continue;
      style.fill.dispose();
      style.stroke.dispose();
    }
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

  const meshes=hitMeshes.filter(mesh=>mesh.visible&&mesh.parent?.visible&&mesh.parent.parent?.visible);
  if(!meshes.length)return null;
  // Model placement and its GLB-local hit meshes must share the *current* world
  // matrices, including zoom/tilt changes and the placement anchor transform.
  for(const mesh of meshes)mesh.updateWorldMatrix(true,false);

  // First try the native Three.js ray. On some Google WebGLOverlayView camera
  // configurations, far-plane unprojection is numerically unstable even
  // though the plot triangles render perfectly on the same canvas.
  const inverse=projection.clone().invert();
  const near=new THREE.Vector3(ndcX,ndcY,-1).applyMatrix4(inverse);
  const far=new THREE.Vector3(ndcX,ndcY,1).applyMatrix4(inverse);
  if(near.toArray().every(Number.isFinite)&&far.toArray().every(Number.isFinite)){
    const direction=far.sub(near).normalize();
    if(direction.toArray().every(Number.isFinite)){
      const ray=new THREE.Raycaster(near,direction);
      ray.near=0;
      const hits=ray.intersectObjects(meshes,false);
      if(typeof hits[0]?.object.userData.plotId==="string")
        return hits[0].object.userData.plotId;
    }
  }

  // Fallback: hit-test the *actual rendered GLB-attached plot triangles* in
  // screen space. Do not project plot corners onto Google terrain: that would
  // drift away from raised masterplans at pitched camera angles.
  let closest:{id:string;depth:number}|null=null;
  for(const mesh of meshes){
    const id=mesh.userData.plotId;
    if(typeof id!=="string")continue;
    const positions=mesh.geometry.getAttribute("position");
    if(!positions||positions.itemSize<3)continue;
    const index=mesh.geometry.index;
    const triangleVertexCount=index?index.count:positions.count;
    const modelToClip=projection.clone().multiply(mesh.matrixWorld);
    const vertex=(slot:number)=>{
      const offset=index?index.getX(slot):slot;
      return new THREE.Vector4(
        positions.getX(offset),positions.getY(offset),positions.getZ(offset),1
      ).applyMatrix4(modelToClip);
    };
    for(let i=0;i+2<triangleVertexCount;i+=3){
      const a=vertex(i),b=vertex(i+1),c=vertex(i+2);
      if(a.w<=0||b.w<=0||c.w<=0)continue;
      if(!pointInScreenTriangle(ndcX,ndcY,
        a.x/a.w,a.y/a.w,b.x/b.w,b.y/b.w,c.x/c.w,c.y/c.w))continue;
      const depth=(a.z/a.w+b.z/b.w+c.z/c.w)/3;
      if(!closest||depth<closest.depth)closest={id,depth};
    }
  }
  return closest?.id||null;
}
