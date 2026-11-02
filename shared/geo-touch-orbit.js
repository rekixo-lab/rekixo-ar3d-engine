/**
 * Customer Geo viewer: a single finger directly drives the Google vector
 * camera's heading. Two-finger navigation stays with Google Maps.
 *
 * Do not ease or queue heading writes after touchend: delayed camera updates
 * made the map appear frozen under the finger and rotate after release.
 * All changes are camera-only; published GLB/plot geometry is untouched.
 */
const DEGREES_PER_PIXEL=0.46;
const ORBIT_THRESHOLD_PX=5;
const POST_ORBIT_CLICK_GUARD_MS=480;

export function normalizeGeoOrbitHeading(value){
  return ((value%360)+360)%360;
}

export function createGeoOneFingerOrbit({
  getHeading,
  setHeading,
  onRotate=()=>{},
  onCaptureChange=()=>{},
  shouldIgnoreTarget=()=>false,
  now=()=>performance.now(),
}){
  let active=null;
  let multiTouchLock=false;
  let lastRotationAt=-Infinity;
  let heading=null;
  let capturing=false;
  let disposed=false;

  function setCapturing(value){
    if(capturing===value)return;
    capturing=value;
    // Disable Maps' own touch gesture only while our one-finger orbit owns
    // the interaction. Restore native two-finger pan/pinch immediately.
    onCaptureChange(value);
  }
  function abortOrbit(){
    active=null;
    heading=null;
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
    if(!Number.isFinite(finger.clientX))return;
    active={id:finger.identifier,startX:finger.clientX,
      lastX:finger.clientX,rotating:false};
    heading=null;
    lastRotationAt=-Infinity;
    setCapturing(true);
    // Prevent the single touch from entering Google's competing gesture
    // detector (and its "use two fingers" instructional overlay).
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
    if(!finger||!Number.isFinite(finger.clientX))return;
    if(event.cancelable)event.preventDefault();
    event.stopPropagation();
    if(!active.rotating&&
       Math.abs(finger.clientX-active.startX)<ORBIT_THRESHOLD_PX)return;
    active.rotating=true;
    const deltaX=finger.clientX-active.lastX;
    active.lastX=finger.clientX;
    if(!deltaX)return;
    if(heading===null){
      const current=getHeading();
      if(!Number.isFinite(current))return;
      heading=normalizeGeoOrbitHeading(current);
    }
    // Finger-right increases the camera bearing, finger-left decreases it.
    // This makes the customer's one-finger orbit direction match their swipe
    // rather than reversing left/right. Keep writes immediate and camera-only.
    heading=normalizeGeoOrbitHeading(heading+deltaX*DEGREES_PER_PIXEL);
    setHeading(heading);
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
