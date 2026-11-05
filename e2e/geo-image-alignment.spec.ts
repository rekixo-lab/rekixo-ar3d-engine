import {expect,test} from "@playwright/test";
import {createHash} from "node:crypto";
import {deflateSync} from "node:zlib";
const slug="e2e-geo";
// Generate the PNG deterministically instead of hand-copying encoded bytes.
// This guarantees the fixture source SHA always matches its image payload.
function crc32(buf:Buffer){
  let c=0xffffffff;
  for(const byte of buf){
    c^=byte;
    for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;
  }
  return (c^0xffffffff)>>>0;
}
function pngChunk(type:string,body:Buffer){
  const tag=Buffer.from(type,"ascii"),header=Buffer.alloc(4),crc=Buffer.alloc(4);
  header.writeUInt32BE(body.length,0);
  crc.writeUInt32BE(crc32(Buffer.concat([tag,body])),0);
  return Buffer.concat([header,tag,body,crc]);
}
function makePng(){
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(400,0);ihdr.writeUInt32BE(200,4);
  ihdr[8]=8;ihdr[9]=0; // 8-bit grayscale
  const rows=Buffer.alloc(200*(400+1),255);
  for(let row=0;row<200;row++)rows[row*401]=0; // PNG filter: none
  return Buffer.concat([Buffer.from("89504e470d0a1a0a","hex"),
    pngChunk("IHDR",ihdr),pngChunk("IDAT",deflateSync(rows)),pngChunk("IEND",Buffer.alloc(0))]);
}
const img=makePng();
const sha=createHash("sha256").update(img).digest("hex");
// A real, self-contained GLB ground mesh; browser tests capture model-local X/Z
// rather than just switching a mocked toolbar state.
function makeGlb(){
  const bin=Buffer.alloc(60);
  const positions=[-10,0,-10,10,0,-10,10,0,10,-10,0,10];
  positions.forEach((v,i)=>bin.writeFloatLE(v,i*4));
  [0,1,2,0,2,3].forEach((v,i)=>bin.writeUInt16LE(v,48+i*2));
  const manifest={asset:{version:"2.0"},buffers:[{byteLength:bin.length}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:48,target:34962},
      {buffer:0,byteOffset:48,byteLength:12,target:34963}],
    accessors:[{bufferView:0,componentType:5126,count:4,type:"VEC3",
      min:[-10,0,-10],max:[10,0,10]},
      {bufferView:1,componentType:5123,count:6,type:"SCALAR"}],
    meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],
    nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};
  const source=Buffer.from(JSON.stringify(manifest));
  const jsonBytes=Buffer.alloc(Math.ceil(source.length/4)*4,0x20);source.copy(jsonBytes);
  const result=Buffer.alloc(12+8+jsonBytes.length+8+bin.length);
  result.write("glTF",0);result.writeUInt32LE(2,4);
  result.writeUInt32LE(result.length,8);result.writeUInt32LE(jsonBytes.length,12);
  result.writeUInt32LE(0x4e4f534a,16);jsonBytes.copy(result,20);
  const offset=20+jsonBytes.length;
  result.writeUInt32LE(bin.length,offset);result.writeUInt32LE(0x004e4942,offset+4);
  bin.copy(result,offset+8);
  return result;
}
const glb=makeGlb();
const json=(value:unknown)=>({status:200,contentType:"application/json",body:JSON.stringify(value)});
test("private original image captures real pixels and source-pinned alignment draft without touching published maps",async({page})=>{
  await page.route("**/3Dprojects/api/cloud/session",r=>r.fulfill(json({
    configured:true,databaseReady:true,authenticated:true,user:{email:"e2e@rekixo.test"}
  })));
  await page.route(/\/3Dprojects\/api\/cloud\/projects\?/,r=>r.fulfill(json({
    projects:[{id:"e2e-id",slug,name:"E2E Geo",status:"published",projectKind:"legacy",assetCount:1,
      updatedAt:"2026-11-01T00:00:00Z"}],total:1,nextOffset:1,hasMore:false
  })));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/assets*",r=>r.fulfill(json({assets:[{
    id:"approved-reference",projectId:"e2e-id",kind:"reference",name:"approved-400x200.png",
    mimeType:"image/png",byteSize:img.length,sha256:sha,refCount:0,
    createdAt:"2026-11-01T00:00:00Z",contentUrl:"/3Dprojects/e2e-image.png"
  }]})));
  await page.route("**/3Dprojects/e2e-image.png",r=>r.fulfill({
    status:200,contentType:"image/png",body:img
  }));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/releases",r=>r.fulfill(json({releases:[]})));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/geo-releases",r=>r.fulfill(json({
    schemaReady:true,experienceId:"experience-1",activeRelease:{id:"geo-release-1"},releases:[]
  })));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/geo-plots/source",r=>r.fulfill(json({
    geoRelease:{id:"geo-release-1"},buildingRelease:{id:"building-release-1"},
    model:{url:"/3Dprojects/no-glb-in-fixture.glb"},canonicalModel:{url:"/3Dprojects/no-glb-in-fixture.glb"},
    placement:{headingDeg:0,scale:1}
  })));
  await page.route("**/3Dprojects/no-glb-in-fixture.glb",r=>r.fulfill({status:200,
    contentType:"model/gltf-binary",body:glb}));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/geo-plots/inventory",r=>r.fulfill(json({
    revision:0,rows:[],updatedBy:null,updatedAt:null
  })));
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/geo-plots",r=>r.fulfill(json({
    inventoryRevision:0,alignmentRevision:0,geoReleaseId:"geo-release-1",
    buildingReleaseId:"building-release-1",
    draft:{revision:0,verifiedRevision:null,verifiedInventoryRevision:null,
      verifiedAlignmentRevision:null,stale:false,plots:[]},activeMapping:null,releases:[]
  })));
  let saved:any=null;
  await page.route("**/3Dprojects/api/cloud/projects/e2e-geo/geo-plots/alignment",async r=>{
    if(r.request().method()==="PUT"){
      saved=r.request().postDataJSON();
      await r.fulfill(json({revision:1,verifiedRevision:null,stale:false,
        modelSha256:"c".repeat(64),draft:saved.draft}));
    }else await r.fulfill(json({revision:0,verifiedRevision:null,stale:false,
      modelSha256:"c".repeat(64),draft:null}));
  });
  await page.goto("/3Dprojects/geo-plots?project=e2e-geo");
  await expect(page.getByRole("heading",{name:"3D Geo Plot Mapper"}).last()).toBeVisible();
  // Image alignment is an explicit Source workflow in the compact mapper.
  await page.getByRole("button",{name:"CSV / Image"}).click();
  const panel=page.locator(".geo-align-panel");
  await panel.locator("summary").click();
  await panel.getByLabel("Approved original reference image").selectOption("approved-reference");
  await expect(panel.getByText(/Original resolution 400 × 200 pixels/)).toBeVisible();
  await panel.getByRole("button",{name:"Save Alignment Draft"}).click();
  await expect.poll(()=>saved).not.toBeNull();
  expect(saved.expectedRevision).toBe(0);
  expect(saved.draft.imageWidth).toBe(400);
  expect(saved.draft.imageHeight).toBe(200);
  expect(saved.draft.imageSha256).toBe(sha);
  expect(saved.draft.geoReleaseId).toBe("geo-release-1");
  await panel.locator("svg").click({position:{x:45,y:35}});
  await panel.getByLabel("Signed drawing / survey evidence for new pair").fill("Signed site control p5");
  await expect(panel.getByRole("button",{name:"Pair Fit Point on 3D Canvas"})).toBeEnabled();
  await panel.getByRole("button",{name:"Pair Fit Point on 3D Canvas"}).click();
  await expect(page.getByRole("button",{name:"Cancel alignment capture"})).toBeVisible();
  await expect(page.getByText(/Top view · model coordinates in metres/)).toBeVisible();
  await page.locator(".geo-plot-overlay").click({position:{x:160,y:135}});
  await expect(panel.getByText("Fit anchors · 1")).toBeVisible();
  await expect(page.getByRole("button",{name:"Cancel alignment capture"})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Publish Mapping"})).toBeDisabled();
});
