/**
 * Mobile Geo orbit: one horizontal finger turns the public Google vector
 * camera, while native two-finger pan/pinch remains owned by Google Maps.
 * requestAnimationFrame smooths irregular touch-move delivery and coalesces
 * camera writes to one per display frame. It never changes published geometry.
 */
const DEGREES_PER_PIXEL=0.46;
const ORBIT_THRESHOLD_PX=5;
const POST_ORBIT_CLICK_GUARD_MS=480;
const ORBIT_FRAME_EASING=0.42;
const HEADING_SNAP_EPSILON=0.075;

export function normalizeGeoOrbitHeading(value){
  return ((value%360)+360)%360;
}
function shortestTurn(current,target){
  return ((target-current+540)%360)-180;
}

export function createGeoOneFingerOrbit({
  getHeading,
  setHeading,
  onRotate=()=>{},
  shouldIgnoreTarget=()=>false,
  now=()=>performance.now(),
  requestFrame=typeof requestAnimationFrame==="function"?requestAnimationFrame:null,
  cancelFrame=typeof cancelAnimationFrame==="function"?cancelAnimationFrame:()=>{},
}){
  let active=null;
  let multiTouchLock=false;
  let lastRotationAt=-Infinity;
  let renderedHeading=null;
  let targetHeading=null;
  let frameHandle=null;
  let disposed=false;

  function haltFrames(){
    if(frameHandle!==null)cancelFrame(frameHandle);
    frameHandle=null;
  }
  function stepFrame(){
    frameHandle=null;
    if(disposed||renderedHeading===null||targetHeading===null)return;
    const delta=shortestTurn(renderedHeading,targetHeading);
    const done=Math.abs(delta)<=HEADING_SNAP_EPSILON;
    renderedHeading=done?targetHeading:
      normalizeGeoOrbitHeading(renderedHeading+delta*ORBIT_FRAME_EASING);
    setHeading(renderedHeading);
    onRotate();
    if(!done&&requestFrame)frameHandle=requestFrame(stepFrame);
  }
  function schedule(){
    if(frameHandle!==null||disposed)return;
    if(requestFrame)frameHandle=requestFrame(stepFrame);
    else {
      // Non-browser consumers and deterministic sync unit tests.
      renderedHeading=targetHeading;
      setHeading(renderedHeading);
      onRotate();
    }
  }
  function beginHeading(){
    const heading=getHeading();
    if(!Number.isFinite(heading))return false;
    renderedHeading=normalizeGeoOrbitHeading(heading);
    targetHeading=renderedHeading;
    return true;
  }
  function abortOrbit(){
    active=null;
    haltFrames();
    renderedHeading=null;
    targetHeading=null;
  }
  function onTouchStart(event){
    if(disposed)return;
    if(event.touches.length>1){
      abortOrbit();
      multiTouchLock=true;
      return;
    }
    if(event.touches.length!==1||multiTouchLock||
       shouldIgnoreTarget(event.target))return;
    const finger=event.touches[0];
    if(!Number.isFinite(finger.clientX))return;
    // Never let an old inertial tail fight a new tap or camera interaction.
    haltFrames();
    renderedHeading=null;
    targetHeading=null;
    active={id:finger.identifier,startX:finger.clientX,
      lastX:finger.clientX,rotating:false};
    lastRotationAt=-Infinity;
  }

  function onTouchMove(event){
    if(disposed)return;
    if(event.touches.length>1){
      abortOrbit();
      multiTouchLock=true;
      return;
    }
    if(multiTouchLock||!active||event.touches.length!==1)return;
    const finger=Array.from(event.touches).find(t=>t.identifier===active.id);
    if(!finger||!Number.isFinite(finger.clientX))return;
    if(event.cancelable)event.preventDefault();
    event.stopPropagation();
    if(!active.rotating&&
       Math.abs(finger.clientX-active.startX)<ORBIT_THRESHOLD_PX)return;
    active.rotating=true;
    const deltaX=finger.clientX-active.lastX;
    active.lastX=finger.clientX;
    if(!deltaX)return;
    if(targetHeading===null&&!beginHeading())return;
    // Accumulate *finger* deltas, not the eased camera position. This keeps
    // the final rotation accurate when touch events outrun frame rendering.
    targetHeading=normalizeGeoOrbitHeading(targetHeading-deltaX*DEGREES_PER_PIXEL);
    lastRotationAt=now();
    schedule();
  }

  function onTouchEnd(event){
    if(disposed)return;
    if(event.touches.length===0){
      active=null;
      multiTouchLock=false;
      // A completed orbit eases into its final precise target after release.
    }else{
      abortOrbit();
      multiTouchLock=true;
    }
  }
  function onTouchCancel(){
    abortOrbit();
    multiTouchLock=false;
  }
  function suppressClick(){
    return now()-lastRotationAt<POST_ORBIT_CLICK_GUARD_MS;
  }
  function destroy(){
    disposed=true;
    abortOrbit();
    multiTouchLock=false;
  }
  return {onTouchStart,onTouchMove,onTouchEnd,onTouchCancel,
    suppressClick,destroy};
}
