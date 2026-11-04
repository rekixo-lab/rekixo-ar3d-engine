// Strict, appearance-independent GLB geometry identity.
// Color, textures, materials, normals and lighting may vary. The source-local
// X/Y/Z coordinate frame, triangle topology and scene transforms may NOT.
// Unsupported deformation/geometry extensions fail closed: never guess from bounds.
const dec = new TextDecoder("utf-8", { fatal: true });
const encode = new TextEncoder();
const MAX_GLB = 64 * 1024 * 1024;
const components = { 5120:1, 5121:1, 5122:2, 5123:2, 5125:4, 5126:4 };
const dimensions = { SCALAR:1, VEC2:2, VEC3:3, VEC4:4, MAT2:4, MAT3:9, MAT4:16 };
const cosmeticExtensions = new Set([
  "KHR_materials_unlit","KHR_materials_clearcoat","KHR_materials_sheen",
  "KHR_materials_transmission","KHR_materials_volume","KHR_materials_ior",
  "KHR_materials_specular","KHR_materials_emissive_strength",
  "KHR_materials_anisotropy","KHR_materials_iridescence",
  "KHR_materials_pbrSpecularGlossiness","KHR_texture_transform",
  "KHR_lights_punctual"
]);
function check(test, detail) {
  if (!test) throw Error("Geometry cannot be auto-verified: " + detail);
}
async function sha(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
  return Array.from(digest, v=>v.toString(16).padStart(2,"0")).join("");
}
function positiveInt(x) { return Number.isSafeInteger(x) && x>=0; }
function at(array,index,kind) {
  check(Array.isArray(array) && positiveInt(index) && index<array.length, "invalid "+kind+" reference");
  return array[index];
}
function numericVector(value, size, defaultValue, label) {
  if (value === undefined) return defaultValue;
  check(Array.isArray(value) && value.length===size &&
    value.every(n=>typeof n==="number" && Number.isFinite(n)), "invalid "+label);
  return value;
}
function transform(n) {
  check(!n.skin && n.weights===undefined && !n.extensions, "deformation or node extensions");
  return {
    matrix:n.matrix===undefined?null:numericVector(n.matrix,16,undefined,"node matrix"),
    translation:numericVector(n.translation,3,[0,0,0],"translation"),
    rotation:numericVector(n.rotation,4,[0,0,0,1],"rotation"),
    scale:numericVector(n.scale,3,[1,1,1],"scale"),
    mesh:n.mesh??null,
    children:Array.isArray(n.children)?n.children:[],
  };
}
function readGlb(raw) {
  const bytes=raw instanceof Uint8Array?raw:new Uint8Array(raw);
  check(bytes.byteLength>=28 && bytes.byteLength<=MAX_GLB,"GLB file size");
  const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  check(dv.getUint32(0,true)===0x46546c67 && dv.getUint32(4,true)===2 &&
    dv.getUint32(8,true)===bytes.length, "GLB header/version");
  let offset=12,json=null,bin=null;
  while(offset<bytes.length){
    check(offset+8<=bytes.length,"truncated chunk header");
    const n=dv.getUint32(offset,true),type=dv.getUint32(offset+4,true);
    offset+=8;check(n<=bytes.length-offset,"truncated GLB chunk");
    if(type===0x4e4f534a){
      check(json===null,"duplicate JSON chunks");
      json=JSON.parse(dec.decode(bytes.subarray(offset,offset+n)).trim());
    } else if(type===0x004e4942){
      check(bin===null,"duplicate binary chunks");
      bin=bytes.subarray(offset,offset+n);
    }else check(false,"unknown GLB chunk");
    offset+=n;
  }
  check(json && bin && json.asset?.version==="2.0","single embedded GLB 2.0 buffer");
  check(Array.isArray(json.buffers) && json.buffers.length===1 &&
    !json.buffers[0].uri && positiveInt(json.buffers[0].byteLength) &&
    json.buffers[0].byteLength<=bin.length, "unsupported external or multiple buffers");
  return {json,bin};
}

export async function glbGeometryIdentity(raw) {
  const {json:g,bin}=readGlb(raw);
  check(!g.skins?.length && !g.animations?.length, "animated or skinned model");
  for(const ext of [...(g.extensionsUsed||[]),...(g.extensionsRequired||[])])
    check(cosmeticExtensions.has(ext),"geometry extension "+ext+" needs manual review");
  check(Array.isArray(g.meshes) && g.meshes.length>0,"no geometric meshes");
  check(Array.isArray(g.nodes) && g.nodes.length>0,"no scene nodes");
  const readAccessor=async(index,expectedType)=>{
    const accessor=at(g.accessors,index,"accessor");
    check(accessor?.type===expectedType && !accessor.sparse &&
      components[accessor.componentType] && positiveInt(accessor.count) && accessor.count>0 &&
      positiveInt(accessor.bufferView), "unsupported geometry accessor");
    const view=at(g.bufferViews,accessor.bufferView,"bufferView");
    check(view.buffer===0 && positiveInt(view.byteOffset??0) &&
      positiveInt(view.byteLength) && positiveInt(accessor.byteOffset??0),
      "invalid geometry view");
    const size=components[accessor.componentType]*dimensions[expectedType];
    const stride=view.byteStride??size,offset=(view.byteOffset??0)+(accessor.byteOffset??0);
    check(positiveInt(stride) && stride>=size && stride<=252 &&
      offset >= (view.byteOffset??0), "invalid geometry stride");
    check((accessor.byteOffset??0)+stride*(accessor.count-1)+size<=view.byteLength &&
      offset+stride*(accessor.count-1)+size<=bin.length, "out-of-range geometry buffer");
    // Only the referenced bytes matter. Interleaved COLOR_0 changes do not
    // affect geometry and must not produce a false model-remap warning.
    const data=new Uint8Array(accessor.count*size);
    for(let i=0;i<accessor.count;i++)
      data.set(bin.subarray(offset+i*stride,offset+i*stride+size),i*size);
    return {componentType:accessor.componentType,count:accessor.count,
      normalized:Boolean(accessor.normalized),sha256:await sha(data)};
  };
  const meshes=[];
  let vertices=0,primitives=0;
  for(const mesh of g.meshes){
    check(!mesh.weights && Array.isArray(mesh.primitives) && mesh.primitives.length,
      "morph targets or empty mesh");
    const geometry=[];
    for(const p of mesh.primitives){
      check(!p.extensions && !p.targets && p.attributes && positiveInt(p.attributes.POSITION),
        "deformed or unrecognized primitive");
      const pos=await readAccessor(p.attributes.POSITION,"VEC3");
      const indices=p.indices===undefined?null:await readAccessor(p.indices,"SCALAR");
      check(indices===null || [5121,5123,5125].includes(indices.componentType),
        "invalid triangle indices");
      check(positiveInt(p.mode??4) && (p.mode??4)<=6,"unknown drawing mode");
      vertices+=pos.count;primitives++;
      geometry.push({mode:p.mode??4,positions:pos,indices});
    }
    meshes.push(geometry);
  }
  const nodes=g.nodes.map(node=>transform(node));
  nodes.forEach(n=>{
    if(n.mesh!==null)at(meshes,n.mesh,"node mesh");
    n.children.forEach(child=>at(nodes,child,"node child"));
  });
  const scenes=(g.scenes||[]).map(s=>{
    check(Array.isArray(s.nodes),"invalid scene roots");
    s.nodes.forEach(id=>at(nodes,id,"scene root"));
    return s.nodes;
  });
  check(scenes.length>0 && positiveInt(g.scene??0) && (g.scene??0)<scenes.length,
    "missing default scene");
  const proof={scene:g.scene??0,scenes,nodes,meshes};
  return {sha256:await sha(encode.encode(JSON.stringify(proof))),
    meshCount:meshes.length,primitiveCount:primitives,vertexCount:vertices};
}


// Re-export-tolerant proof: compare actual visible world-space triangles,
// not glTF node IDs, mesh order, accessor byte packing or material partitions.
// The proof remains strict about position/scale/layout. The 10-micrometre
// quantization handles tiny floating-point serialization noise only.
const WORLD_GRID = 100_000;
const MAX_TRIANGLES = 400_000;
const IDENTITY = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

function matrixMultiply(a,b) {
  const out=new Array(16).fill(0);
  for(let c=0;c<4;c++)for(let row=0;row<4;row++)
    for(let k=0;k<4;k++)out[c*4+row]+=a[k*4+row]*b[c*4+k];
  return out;
}
function nodeMatrix(node) {
  if(node.matrix!==undefined) {
    check(node.translation===undefined && node.rotation===undefined && node.scale===undefined,
      "conflicting matrix and TRS");
    return numericVector(node.matrix,16,null,"matrix");
  }
  const t=numericVector(node.translation,3,[0,0,0],"translation");
  const s=numericVector(node.scale,3,[1,1,1],"scale");
  const [x,y,z,w]=numericVector(node.rotation,4,[0,0,0,1],"rotation");
  const norm=x*x+y*y+z*z+w*w;
  check(Math.abs(norm-1)<0.001, "invalid rotation quaternion");
  const m=[
    (1-2*(y*y+z*z))*s[0],(2*(x*y+z*w))*s[0],(2*(x*z-y*w))*s[0],0,
    (2*(x*y-z*w))*s[1],(1-2*(x*x+z*z))*s[1],(2*(y*z+x*w))*s[1],0,
    (2*(x*z+y*w))*s[2],(2*(y*z-x*w))*s[2],(1-2*(x*x+y*y))*s[2],0,
    t[0],t[1],t[2],1
  ];
  return m;
}
function readNumeric(g,bin,index,expectedType,allowedTypes) {
  const accessor=at(g.accessors,index,"geometry accessor");
  check(accessor && accessor.type===expectedType && !accessor.sparse &&
    allowedTypes.includes(accessor.componentType) && !accessor.normalized &&
    positiveInt(accessor.count) && accessor.count>0 &&
    positiveInt(accessor.bufferView), "unsupported geometry accessor encoding");
  const view=at(g.bufferViews,accessor.bufferView,"geometry bufferView");
  check(view.buffer===0 && positiveInt(view.byteOffset??0) &&
    positiveInt(view.byteLength) && positiveInt(accessor.byteOffset??0),
    "invalid geometry buffer view");
  const bytes=components[accessor.componentType];
  const unit=dimensions[expectedType];
  const size=bytes*unit,stride=view.byteStride??size;
  const offset=(view.byteOffset??0)+(accessor.byteOffset??0);
  check(positiveInt(stride) && stride>=size && stride<=252 &&
    (accessor.byteOffset??0)+stride*(accessor.count-1)+size<=view.byteLength &&
    offset+stride*(accessor.count-1)+size<=bin.byteLength,
    "geometry accessor buffer overrun");
  const d=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
  const read=(i,k=0)=>{
    const pos=offset+i*stride+k*bytes;
    if(accessor.componentType===5126)return d.getFloat32(pos,true);
    if(accessor.componentType===5125)return d.getUint32(pos,true);
    if(accessor.componentType===5123)return d.getUint16(pos,true);
    if(accessor.componentType===5121)return d.getUint8(pos);
    throw Error("Unsupported component type");
  };
  return {count:accessor.count,read};
}
function quantizedPoint(matrix,x,y,z) {
  const coords=[
    matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12],
    matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13],
    matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14],
  ];
  check(coords.every(c=>Number.isFinite(c)&&Math.abs(c)<=100_000),
    "nonfinite or implausible scene coordinate");
  const q=coords.map(c=>Math.round(c*WORLD_GRID));
  return {key:q.join(","),q};
}
export async function glbWorldSurfaceIdentity(raw) {
  const {json:g,bin}=readGlb(raw);
  check(!g.skins?.length && !g.animations?.length, "animated/skinned geometry");
  for(const ext of [...(g.extensionsUsed||[]),...(g.extensionsRequired||[])])
    check(cosmeticExtensions.has(ext), "unverified geometry extension");
  check(Array.isArray(g.nodes) && Array.isArray(g.meshes) && g.meshes.length,
    "missing model nodes or meshes");
  const scenes=g.scenes;
  check(Array.isArray(scenes) && scenes.length>0 &&
    positiveInt(g.scene??0) && (g.scene??0)<scenes.length,
    "no valid default scene");
  const roots=scenes[g.scene??0]?.nodes;
  check(Array.isArray(roots) && roots.length,"missing default scene roots");
  const triangles=[];
  let totalVertices=0;
  const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  const seen=new Set();
  function addPrimitive(p,matrix) {
    check(!p.extensions && !p.targets && p.attributes &&
      positiveInt(p.attributes.POSITION),"geometry primitive deformation");
    check((p.mode??4)===4,"nontriangle geometry needs separate review");
    const pos=readNumeric(g,bin,p.attributes.POSITION,"VEC3",[5126]);
    const ix=p.indices===undefined?null:readNumeric(g,bin,p.indices,"SCALAR",[5121,5123,5125]);
    const count=ix?.count??pos.count;
    check(count%3===0,"incomplete triangle indices");
    totalVertices+=pos.count;
    check(totalVertices<=1_200_000 && triangles.length+count/3<=MAX_TRIANGLES,
      "model exceeds safe one-click comparison budget");
    const cache=new Map();
    const point=(i)=>{
      check(positiveInt(i)&&i<pos.count,"invalid vertex index");
      if(cache.has(i))return cache.get(i);
      const p3=quantizedPoint(matrix,pos.read(i,0),pos.read(i,1),pos.read(i,2));
      for(let axis=0;axis<3;axis++){
        bounds.min[axis]=Math.min(bounds.min[axis],p3.q[axis]);
        bounds.max[axis]=Math.max(bounds.max[axis],p3.q[axis]);
      }
      cache.set(i,p3.key);return p3.key;
    };
    for(let i=0;i<count;i+=3){
      const vertices=[point(ix?ix.read(i):i),point(ix?ix.read(i+1):i+1),
        point(ix?ix.read(i+2):i+2)];
      // Cyclic vertex rotations preserve the facing side. Winding reversal
      // flips the face and is NOT a cosmetic change.
      const key=[0,1,2].map(shift=>[
        vertices[shift],vertices[(shift+1)%3],vertices[(shift+2)%3]
      ].join("|")).sort()[0];
      triangles.push(key);
    }
  }
  function visit(index,parent) {
    const node=at(g.nodes,index,"node");
    // Reject cycles, shared node parenting and geometry not in the scene.
    check(!seen.has(index),"cyclic/reused node in default scene");
    seen.add(index);
    check(!node.skin && !node.extensions && node.weights===undefined,
      "skinned or extended node");
    const matrix=matrixMultiply(parent,nodeMatrix(node));
    check(matrix.every(Number.isFinite),"invalid scene transform");
    if(node.mesh!==undefined) {
      const mesh=at(g.meshes,node.mesh,"mesh");
      check(!mesh.weights && Array.isArray(mesh.primitives)&&mesh.primitives.length,
        "morph geometry or empty mesh");
      for(const p of mesh.primitives)addPrimitive(p,matrix);
    }
    if(node.children!==undefined) {
      check(Array.isArray(node.children),"invalid node children");
      for(const child of node.children)visit(child,matrix);
    }
  }
  for(const root of roots)visit(root,IDENTITY);
  check(triangles.length>0,"no visible triangles in default scene");
  triangles.sort();
  const geometrySha256=await sha(encode.encode(triangles.join("\n")));
  return {
    sha256:geometrySha256,triangleCount:triangles.length,
    boundsMinM:bounds.min.map(v=>v/WORLD_GRID),
    boundsMaxM:bounds.max.map(v=>v/WORLD_GRID)
  };
}
function geometryDifference(previous,current) {
  if(previous.triangleCount!==current.triangleCount)
    return "Visible triangle count differs ("+previous.triangleCount+" vs "+current.triangleCount+").";
  const viewBounds=(b)=>[...b.boundsMinM,...b.boundsMaxM].map(n=>n.toFixed(4)).join(", ");
  if(viewBounds(previous)!==viewBounds(current))
    return "Visible geometry bounds differ (old: "+viewBounds(previous)+
      "; new: "+viewBounds(current)+").";
  return "Visible triangle coordinates/topology differ despite equal triangle counts and bounds.";
}
export async function verifyCosmeticModelPair(oldGlb,newGlb) {
  const [oldGeometry,newGeometry]=await Promise.all([
    glbGeometryIdentity(oldGlb),glbGeometryIdentity(newGlb)
  ]);
  if(oldGeometry.sha256===newGeometry.sha256)
    return {equal:true,mode:"exact-source",oldGeometry,newGeometry};
  // Different node numbering and exporter grouping are not proof of a changed
  // site. Confirm the actual visible world-space triangles before rejecting.
  try {
    const [oldWorld,newWorld]=await Promise.all([
      glbWorldSurfaceIdentity(oldGlb),glbWorldSurfaceIdentity(newGlb)
    ]);
    const same=oldWorld.sha256===newWorld.sha256;
    return {equal:same,mode:same?"world-surface":"different-surface",
      reason:same?undefined:geometryDifference(oldWorld,newWorld),
      oldGeometry,newGeometry,oldWorld,newWorld};
  } catch(error) {
    return {equal:false,mode:"unverified-reexport",
      reason:error instanceof Error?error.message:"Scene geometry needs separate review.",
      oldGeometry,newGeometry};
  }
}
