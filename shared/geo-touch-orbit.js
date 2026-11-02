/**
 * Mobile Geo orbit: one touch horizontally rotates the public vector-map
 * camera. Google Maps' cooperative mode owns two-touch pan/pinch/zoom.
 *
 * This controller changes only the camera heading, never source GLB, plot
 * coordinates, road-facing metadata, lat/lng, zoom or tilt.
 */
const DEGREES_PER_PIXEL = 0.46;
const ORBIT_THRESHOLD_PX = 5;
const POST_ORBIT_CLICK_GUARD_MS = 480;

export function normalizeGeoOrbitHeading(value) {
  return ((value % 360) + 360) % 360;
}

export function createGeoOneFingerOrbit({
  getHeading,
  setHeading,
  onRotate = () => {},
  shouldIgnoreTarget = () => false,
  now = () => performance.now(),
}){
  let active = null;
  let multiTouchLock = false;
  let lastRotationAt = -Infinity;

  function onTouchStart(event){
    if(event.touches.length > 1){
      active = null;
      multiTouchLock = true;
      return;
    }
    if(event.touches.length !== 1 || multiTouchLock ||
       shouldIgnoreTarget(event.target))return;
    const finger = event.touches[0];
    if(!Number.isFinite(finger.clientX))return;
    active = {
      id: finger.identifier,
      startX: finger.clientX,
      lastX: finger.clientX,
      rotating: false,
    };
    // A new genuine tap should not be blocked by a preceding orbit.
    lastRotationAt = -Infinity;
  }

  function onTouchMove(event){
    // Never hijack two-finger pan/pinch/zoom; Google handles these natively.
    if(event.touches.length > 1){
      active = null;
      multiTouchLock = true;
      return;
    }
    if(multiTouchLock || !active || event.touches.length !== 1)return;
    const finger = Array.from(event.touches).find(t => t.identifier === active.id);
    if(!finger || !Number.isFinite(finger.clientX))return;
    // The one-touch gesture is ours: prevent page scroll and Google's pan.
    if(event.cancelable)event.preventDefault();
    event.stopPropagation();
    if(!active.rotating && Math.abs(finger.clientX-active.startX)<ORBIT_THRESHOLD_PX)return;
    active.rotating = true;
    const deltaX = finger.clientX-active.lastX;
    active.lastX = finger.clientX;
    if(!deltaX)return;
    const heading = getHeading();
    if(!Number.isFinite(heading))return;
    // Swiping the scene right turns the ground imagery/GLB visually right.
    setHeading(normalizeGeoOrbitHeading(heading-deltaX*DEGREES_PER_PIXEL));
    lastRotationAt = now();
    onRotate();
  }

  function onTouchEnd(event){
    if(event.touches.length === 0){
      active = null;
      multiTouchLock = false;
    }else{
      // A remaining finger after pinch must not unexpectedly start orbiting.
      active = null;
      multiTouchLock = true;
    }
  }
  function onTouchCancel(event){onTouchEnd(event);}
  function suppressClick(){
    return now()-lastRotationAt < POST_ORBIT_CLICK_GUARD_MS;
  }
  return {onTouchStart,onTouchMove,onTouchEnd,onTouchCancel,suppressClick};
}
