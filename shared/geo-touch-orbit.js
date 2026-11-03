/**
 * Customer Geo: one finger controls both Google vector camera axes.
 * Horizontal movement changes heading; vertical movement changes tilt.
 * Two fingers always return to Google's native pan/pinch.
 *
 * No easing after touchend: WebGL overlay and the camera update on each move.
 * Only the camera changes; plot/model geometry and publication stay intact.
 */
const DEGREES_PER_PIXEL=0.46;
const TILT_DEGREES_PER_PIXEL=0.42;
const MAX_TILT_DEG=67.5;
const ORBIT_THRESHOLD_PX=5;
const POST_ORBIT_CLICK_GUARD_MS=480;

export function normalizeGeoOrbitHeading(value){
  return ((value%360)+360)%360;
}

export function clampGeoOrbitTilt(value){
  return Math.min(MAX_TILT_DEG,Math.max(0,value));
}

export function createGeoOneFingerOrbit({
  getHeading,
  setHeading,
  getTilt=()=>NaN,
  setTilt,
  setCamera,
  onRotate=()=>{},
  onCaptureChange=()=>{},
  shouldIgnoreTarget=()=>false,
  now=()=>performance.now(),
}){
  let active=null;
  let multiTouchLock=false;
  let lastRotationAt=-Infinity;
  let heading=null;
  let tilt=null;
  let capturing=false;
  let disposed=false;

  function setCapturing(value){
    if(capturing===value)return;
    capturing=value;
    // Only our single-finger orbit captures touch. Google's two-finger
    // gestures are restored immediately when another finger joins.
    onCaptureChange(value);
  }
  function abortOrbit(){
    active=null;
    heading=null;
    tilt=null;
    setCapturing(false);
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
    if(!Number.isFinite(finger.clientX)||!Number.isFinite(finger.clientY))return;
    active={
      id:finger.identifier,startX:finger.clientX,startY:finger.clientY,
      lastX:finger.clientX,lastY:finger.clientY,rotating:false,
    };
    heading=null;
    tilt=null;
    lastRotationAt=-Infinity;
    setCapturing(true);
    // Prevent Google from competing with our immediate single-finger orbit.
    event.stopPropagation();
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
    if(!finger||!Number.isFinite(finger.clientX)||!Number.isFinite(finger.clientY))return;
    if(event.cancelable)event.preventDefault();
    event.stopPropagation();
    const distance=Math.hypot(
      finger.clientX-active.startX,finger.clientY-active.startY,
    );
    if(!active.rotating&&distance<ORBIT_THRESHOLD_PX)return;
    active.rotating=true;
    const deltaX=finger.clientX-active.lastX;
    const deltaY=finger.clientY-active.lastY;
    active.lastX=finger.clientX;
    active.lastY=finger.clientY;
    if(!deltaX&&!deltaY)return;

    if(heading===null){
      const current=getHeading();
      if(Number.isFinite(current))heading=normalizeGeoOrbitHeading(current);
    }
    if(tilt===null){
      const current=getTilt();
      if(Number.isFinite(current))tilt=clampGeoOrbitTilt(current);
    }
    const nextHeading=heading===null?null:
      normalizeGeoOrbitHeading(heading+deltaX*DEGREES_PER_PIXEL);
    // Swiping up (negative Y) tilts toward the bird's-eye 0-degree view.
    // Swiping down restores the low 3D camera angle.
    const nextTilt=tilt===null?null:
      clampGeoOrbitTilt(tilt+deltaY*TILT_DEGREES_PER_PIXEL);
    const headingChanged=nextHeading!==null&&deltaX!==0&&nextHeading!==heading;
    const tiltChanged=nextTilt!==null&&deltaY!==0&&nextTilt!==tilt&&
      (typeof setTilt==="function"||typeof setCamera==="function");
    if(!headingChanged&&!tiltChanged){
      // A held swipe at Google's tilt boundary is not a plot-selection tap.
      if(active.rotating)lastRotationAt=now();
      return;
    }
    if(nextHeading!==null)heading=nextHeading;
    if(nextTilt!==null)tilt=nextTilt;

    if(typeof setCamera==="function"&&heading!==null&&tilt!==null){
      // Atomic update prevents heading and tilt from fighting each other
      // or queuing two Google camera writes during diagonal gestures.
      setCamera({heading,tilt});
    }else{
      if(headingChanged)setHeading(heading);
      if(tiltChanged)setTilt?.(tilt);
    }
    onRotate();
    lastRotationAt=now();
  }
  function onTouchEnd(event){
    if(disposed)return;
    abortOrbit();
    multiTouchLock=event.touches.length>0;
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
