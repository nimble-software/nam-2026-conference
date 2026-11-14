import { useEffect, useRef, useState } from 'react';
import { useConference, useFetch } from '../lib/store.jsx';
import * as api from '../lib/api.js';
import { relativeDate } from '../lib/format.js';
import { cameraMessage, fitSize } from '../lib/photo.js';
import { Button, EmptyState, ErrorState, SectionHeader, Skeleton } from '../components/ui.jsx';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';

/** Camera states: asking for permission, live preview, a photo taken, or no camera. */
function Camera({ onPosted }) {
  const { currentUserId, clock } = useConference();
  const videoRef = useRef(null);
  const [state, setState] = useState('asking');
  const [message, setMessage] = useState('');
  const [shot, setShot] = useState(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');
  const [stream, setStream] = useState(null);

  useEffect(() => {
    let active = true;
    let current = null;
    const devices = navigator.mediaDevices;
    if (!devices?.getUserMedia) {
      setMessage(cameraMessage(null));
      setState('blocked');
      return undefined;
    }
    devices.getUserMedia({ video: true })
      .then((s) => {
        if (!active) return s.getTracks().forEach((t) => t.stop());
        current = s;
        setStream(s);
        setState('live');
      })
      .catch((err) => {
        if (!active) return;
        setMessage(cameraMessage(err));
        setState('blocked');
      });
    return () => {
      active = false;
      current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // the <video> is remounted when going back to live, so attach the stream each time
  useEffect(() => {
    if (state === 'live' && videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [state, stream]);

  function take() {
    const video = videoRef.current;
    const { width, height } = fitSize(video.videoWidth || 640, video.videoHeight || 480);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(video, 0, 0, width, height);
    setShot(canvas.toDataURL('image/jpeg', 0.8));
    setPostError('');
    setState('taken');
  }

  async function post() {
    setPosting(true);
    setPostError('');
    try {
      await api.postPhoto({ userId: currentUserId, image: shot, day: clock.day, time: clock.time });
      setShot(null);
      setState('live');
      onPosted();
    } catch (err) {
      setPostError(err.message);
    } finally {
      setPosting(false);
    }
  }

  if (state === 'blocked') {
    return (
      <div data-testid="camera-blocked" role="alert" className="card flex items-start gap-3 p-5 text-sm text-muted">
        <span aria-hidden="true">📷</span>
        <p>{message}</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="aspect-[4/3] w-full bg-black">
        {state === 'taken' ? (
          <img src={shot} alt="Your photo, ready to post" className="size-full object-contain" />
        ) : (
          <video ref={videoRef} autoPlay playsInline muted className="size-full object-contain" />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 p-3">
        {state === 'asking' && <p className="text-sm text-muted">Waiting for camera permission…</p>}
        {state === 'live' && (
          <Button variant="primary" data-testid="photo-capture" onClick={take}>Take photo</Button>
        )}
        {state === 'taken' && (
          <>
            <Button variant="primary" data-testid="photo-post" onClick={post} disabled={posting}>
              {posting ? 'Posting…' : 'Post'}
            </Button>
            <Button data-testid="photo-retake" onClick={() => setState('live')} disabled={posting}>Retake</Button>
          </>
        )}
        {postError && <p role="alert" className="text-sm text-rose-300">{postError}</p>}
      </div>
    </div>
  );
}

export function PhotoBoothPage() {
  useDocumentTitle('Photo Booth');
  const { currentUserId, clock } = useConference();
  const { data: photos, loading, error, reload } = useFetch(api.getPhotos);

  async function remove(photo) {
    await api.deletePhoto(photo.id, currentUserId);
    reload();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
      <SectionHeader
        eyebrow="Say cheese"
        title="Photo Booth"
        description="Take a photo with your camera and post it to the gallery everyone at ORBIT can see."
      />
      <div className="mx-auto max-w-xl"><Camera onPosted={reload} /></div>

      <section data-testid="photo-gallery" aria-label="Gallery">
        {error && <ErrorState error={error} onRetry={reload} />}
        {!error && !photos && loading && <Skeleton className="h-48" />}
        {photos?.length === 0 && (
          <div data-testid="photo-empty">
            <EmptyState
              icon="camera"
              title="The gallery is empty"
              description="Be the first to post: take a photo above and it shows up here for everyone."
            />
          </div>
        )}
        {photos?.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {photos.map((photo) => (
              <li key={photo.id} data-testid="photo-card" className="card overflow-hidden">
                <img src={photo.image} alt={`Photo posted by ${photo.userName}`} className="aspect-[4/3] w-full object-cover" />
                <div className="flex items-center justify-between gap-2 p-2.5 text-xs">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-ink">{photo.userName}</div>
                    <div className="text-muted">posted {relativeDate(photo.postedAt, clock)}</div>
                  </div>
                  {photo.userId === currentUserId && (
                    <Button size="sm" variant="danger" data-testid="photo-delete" onClick={() => remove(photo)}>Delete</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
