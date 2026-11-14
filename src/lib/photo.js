/** A sentence for why the camera is not available, from the `getUserMedia` error (null when the browser has no camera API). */
export function cameraMessage(err) {
  if (!err) return "This browser doesn't support camera access, so the booth can't take a photo here.";
  if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
    return 'Camera access is blocked. Allow the camera for this site in your browser settings, then reload.';
  }
  if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
    return 'No camera was found on this device.';
  }
  return "The camera couldn't be started. Check that no other app is using it, then reload.";
}

/** Scale `w × h` down so its long side is at most `max`; never enlarges. */
export function fitSize(w, h, max = 640) {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}
