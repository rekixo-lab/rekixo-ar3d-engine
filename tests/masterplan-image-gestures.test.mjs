import test from "node:test";
import assert from "node:assert/strict";
import {fitImageFrame,clampImageFrame,panImageFrame,pinchImageFrame,
  imageWorldAt,zoomImageFrame} from "../shared/masterplan-image-gestures.js";

const image={width:1000,height:500},viewport={width:500,height:250};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`Expected ${a} ~ ${b}`);

test("touch pan remains inside image and zoom is bounded",()=>{
  const full=fitImageFrame(image);
  assert.deepEqual(full,{x:0,y:0,w:1000,h:500});
  const zoom=zoomImageFrame(full,image,0.5,[500,250]);
  assert.deepEqual(zoom,{x:250,y:125,w:500,h:250});
  const p=panImageFrame(zoom,image,viewport,[100,0]);
  near(p.x,150);
  near(p.y,125);
  const edge=panImageFrame(p,image,viewport,[100000,100000]);
  assert.equal(edge.x,0);assert.equal(edge.y,0);
  const other=panImageFrame(p,image,viewport,[-100000,-100000]);
  assert.equal(other.x,500);assert.equal(other.y,250);
  assert.deepEqual(zoomImageFrame(full,image,3),full);
  assert.deepEqual(clampImageFrame({x:-20,y:500,w:200,h:100},image),
    {x:0,y:400,w:200,h:100});
});
test("two-finger pinch follows moving midpoint without image drift",()=>{
  const start=zoomImageFrame(fitImageFrame(image),image,0.75,[500,250]);
  const previous=[250,125],current=[280,135];
  const anchor=imageWorldAt(start,viewport,previous);
  const next=pinchImageFrame(start,image,viewport,previous,current,100,200);
  near(next.w,start.w/2);near(next.h,start.h/2);
  const anchored=imageWorldAt(next,viewport,current);
  near(anchored[0],anchor[0]);
  near(anchored[1],anchor[1]);
  assert.ok(next.x>=0&&next.x+next.w<=image.width+1e-6);
  assert.ok(next.y>=0&&next.y+next.h<=image.height+1e-6);
});
test("letterboxed SVG respects actual viewport scale on vertical touch pan",()=>{
  const initial=zoomImageFrame(fitImageFrame(image),image,0.5,[500,250]);
  const square={width:500,height:500}; // image is letterboxed vertically
  const a=imageWorldAt(initial,square,[250,250]);
  near(a[0],500);near(a[1],250);
  const moved=panImageFrame(initial,image,square,[0,50]);
  near(moved.y,75);
});
test("invalid pinch distances cannot produce NaN or corrupt mapping",()=>{
  const start=fitImageFrame(image);
  for(const bad of [0,NaN,Infinity,-1]){
    const result=pinchImageFrame(start,image,viewport,[250,125],[280,135],100,bad);
    assert.deepEqual(result,start);
  }
});
