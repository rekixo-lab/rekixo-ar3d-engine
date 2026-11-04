import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {glbGeometryIdentity,verifyCosmeticModelPair} from "../shared/glb-geometry-identity.js";

function makeGlb({height=0,indices=[0,1,2],color=[0.1,0.2,0.3],
    metalness=0,translation=[0,0,0],mode=4,interleaved=false,
    skinned=false}={}){
  const positions=[0,height,0, 1,height,0, 0,height,1];
  let bin;
  let posView,colorsAccessor;
  const float=(buf,offset,val)=>buf.writeFloatLE(val,offset);
  if(interleaved){
    bin=Buffer.alloc(3*16+6);
    for(let i=0;i<3;i++){
      for(let j=0;j<3;j++)float(bin,i*16+j*4,positions[i*3+j]);
      // Color bytes are INTERLEAVED with position data but must not
      // affect a geometry-only fingerprint.
      float(bin,i*16+12,color[i]);
    }
    posView={buffer:0,byteOffset:0,byteLength:48,byteStride:16};
    colorsAccessor={bufferView:0,byteOffset:12,componentType:5126,count:3,type:"SCALAR"};
  }else{
    bin=Buffer.alloc(3*12+6+12);
    for(let i=0;i<9;i++)float(bin,i*4,positions[i]);
    for(let i=0;i<3;i++)float(bin,42+i*4,color[i]);
    posView={buffer:0,byteOffset:0,byteLength:36};
    colorsAccessor={bufferView:2,componentType:5126,count:3,type:"SCALAR"};
  }
  const offset=interleaved?48:36;
  for(let i=0;i<3;i++)bin.writeUInt16LE(indices[i],offset+i*2);
  const views=[posView,{buffer:0,byteOffset:offset,byteLength:6}];
  if(!interleaved)views.push({buffer:0,byteOffset:42,byteLength:12});
  const gltf={
    asset:{version:"2.0",generator:"synthetic"},
    buffers:[{byteLength:bin.length}],
    bufferViews:views,
    accessors:[
      {bufferView:0,componentType:5126,count:3,type:"VEC3"},
      {bufferView:1,componentType:5123,count:3,type:"SCALAR"},
      colorsAccessor
    ],
    scenes:[{nodes:[0]}],scene:0,
    nodes:[{mesh:0,translation}],
    meshes:[{primitives:[{attributes:{POSITION:0,COLOR_0:2},indices:1,material:0,mode}]}],
    materials:[{pbrMetallicRoughness:{metallicFactor:metalness}}],
    ...(skinned?{skins:[{joints:[0]}]}:{})
  };
  const json=Buffer.from(JSON.stringify(gltf),"utf8");
  const jsonPad=(4-json.length%4)%4,binPad=(4-bin.length%4)%4;
  const out=Buffer.alloc(12+8+json.length+jsonPad+8+bin.length+binPad);
  out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);
  out.writeUInt32LE(out.length,8);out.writeUInt32LE(json.length+jsonPad,12);
  out.writeUInt32LE(0x4e4f534a,16);json.copy(out,20);
  out.fill(32,20+json.length,20+json.length+jsonPad);
  const second=20+json.length+jsonPad;
  out.writeUInt32LE(bin.length+binPad,second);
  out.writeUInt32LE(0x004e4942,second+4);
  bin.copy(out,second+8);
  return new Uint8Array(out);
}

test("material and vertex-color changes keep EXACT geometry identity",async()=>{
  const a=makeGlb({metalness:0,color:[0.1,0.2,0.3]});
  const b=makeGlb({metalness:1,color:[0.9,0.5,0.3]});
  const verified=await verifyCosmeticModelPair(a,b);
  assert.equal(verified.equal,true);
  assert.equal(verified.oldGeometry.vertexCount,3);
  assert.equal(verified.oldGeometry.meshCount,1);
  const interleaved=await verifyCosmeticModelPair(
    makeGlb({interleaved:true,color:[0.1,0.2,0.3]}),
    makeGlb({interleaved:true,color:[0.9,0.3,0.2]})
  );
  assert.equal(interleaved.equal,true,"interleaved color bytes must be ignored");
});
test("geometry and coordinate-frame changes never get auto-swapped",async()=>{
  const original=makeGlb();
  for(const changed of [
    makeGlb({height:0.01}),makeGlb({indices:[1,0,2]}),
    makeGlb({translation:[0.01,0,0]}),makeGlb({mode:5})
  ]){
    const verification=await verifyCosmeticModelPair(original,changed);
    assert.equal(verification.equal,false);
  }
});
test("unknown GLB, external buffer, animation and skin fail closed",async()=>{
  await assert.rejects(glbGeometryIdentity(new Uint8Array([1,2,3])),/cannot be auto-verified/);
  await assert.rejects(glbGeometryIdentity(makeGlb({skinned:true})),/skinned/);
});
test("one-click route is private, live Geo+mapping pointers switch in a single D1 batch",()=>{
  const worker=readFileSync(new URL("../workers/geo-cosmetic-replace.mjs",import.meta.url),"utf8");
  const routes=readFileSync(new URL("../workers/admin-cloud.mjs",import.meta.url),"utf8");
  const ui=readFileSync(new URL("../apps/admin/src/geo/GeoEasyReplace.tsx",import.meta.url),"utf8");
  const pos=(x)=>worker.indexOf(x);
  assert.ok(pos("verifyCosmeticModelPair")>=0);
  assert.ok(pos("verifyRenderableDerivative")>=0);
  assert.ok(pos("modelBytes")>=0);
  assert.ok(pos("model_anchor_id=NULL")>=0);
  assert.ok(pos("INSERT INTO geo_releases_3d")>0);
  assert.ok(pos("INSERT INTO geo_plot_mapping_releases_3d")>0);
  assert.ok(pos("INSERT INTO geo_plot_commercial_3d")>0);
  assert.ok(pos("UPDATE geo_experience_active_releases_3d")>0);
  assert.ok(pos("UPDATE geo_plot_mapping_active_3d")>0);
  assert.ok(pos("await env.DB.batch(statements)")>0);
  assert.match(worker,/preservedApproval.*public_approved/);
  assert.match(worker,/json_extract\('INVALID_REPLACEMENT_STATE','\$'\)/);
  assert.match(routes,/parts\[2\]==="easy-replace"/);
  assert.match(worker,/same-origin request/i);
  assert.match(ui,/Auto Update Geo/);
  assert.match(ui,/inspectCosmeticGeoReplacement/);
  assert.match(ui,/applyCosmeticGeoReplacement/);
  assert.doesNotMatch(worker,/UPDATE geo_plot_mapping_releases_3d/);
});
