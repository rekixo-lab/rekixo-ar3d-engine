// Pure image-space gestures for Admin SVG mapper and Public image-only fallback.
// Inputs are viewBox coordinates/pixels, never geographic coordinates.
const finite=n=>typeof n==="number"&&Number.isFinite(n);
export function fitImageFrame(image){
  return {x:0,y:0,w:image.width,h:image.height};
}
export function clampImageFrame(frame,image){
  if(![frame.x,frame.y,frame.w,frame.h,image.width,image.height].every(finite)||
    image.width<=0||image.height<=0||frame.w<=0||frame.h<=0)
    return fitImageFrame(image);
  const w=Math.min(image.width,Math.max(Math.min(1,image.width),frame.w));
  const h=Math.min(image.height,Math.max(Math.min(1,image.height),frame.h));
  return {x:Math.min(image.width-w,Math.max(0,frame.x)),
    y:Math.min(image.height-h,Math.max(0,frame.y)),w,h};
}
export function zoomImageFrame(frame,image,factor,anchor){
  const original=clampImageFrame(frame,image);
  if(!finite(factor)||factor<=0)return original;
  const minFactor=Math.max(Math.min(1,image.width)/original.w,
    Math.min(1,image.height)/original.h);
  const maxFactor=Math.min(image.width/original.w,image.height/original.h);
  const f=Math.max(minFactor,Math.min(maxFactor,factor));
  const x=anchor?.[0]??original.x+original.w/2;
  const y=anchor?.[1]??original.y+original.h/2;
  return clampImageFrame({
    x:x-(x-original.x)*f,y:y-(y-original.y)*f,
    w:original.w*f,h:original.h*f},image);
}
function geometry(frame,viewport){
  if(!finite(viewport.width)||!finite(viewport.height)||
     viewport.width<=0||viewport.height<=0)return null;
  const scale=Math.min(viewport.width/frame.w,viewport.height/frame.h);
  return {scale,padX:(viewport.width-frame.w*scale)/2,
    padY:(viewport.height-frame.h*scale)/2};
}
export function imageWorldAt(frame,viewport,point){
  const g=geometry(frame,viewport);
  if(!g)return [frame.x+frame.w/2,frame.y+frame.h/2];
  return [frame.x+(point[0]-g.padX)/g.scale,
    frame.y+(point[1]-g.padY)/g.scale];
}
export function panImageFrame(frame,image,viewport,delta){
  const original=clampImageFrame(frame,image),g=geometry(original,viewport);
  if(!g||!delta.every(finite))return original;
  return clampImageFrame({...original,x:original.x-delta[0]/g.scale,
    y:original.y-delta[1]/g.scale},image);
}
export function pinchImageFrame(frame,image,viewport,previousMid,currentMid,
  previousDistance,currentDistance){
  const original=clampImageFrame(frame,image);
  if(!finite(previousDistance)||!finite(currentDistance)||
     previousDistance<1||currentDistance<1)return original;
  const anchor=imageWorldAt(original,viewport,previousMid);
  const zoomed=zoomImageFrame(original,image,previousDistance/currentDistance,anchor);
  const moved=imageWorldAt({...zoomed,x:0,y:0},viewport,currentMid);
  return clampImageFrame({...zoomed,x:anchor[0]-moved[0],
    y:anchor[1]-moved[1]},image);
}
