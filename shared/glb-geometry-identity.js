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
      offset>=view.byteOffset??0, "invalid geometry stride");
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

export async function verifyCosmeticModelPair(oldGlb,newGlb) {
  const [oldGeometry,newGeometry]=await Promise.all([
    glbGeometryIdentity(oldGlb),glbGeometryIdentity(newGlb)
  ]);
  return {equal:oldGeometry.sha256===newGeometry.sha256,
    oldGeometry,newGeometry};
}
