// Weekly progress photos: front, side, back. The phone is propped up; a 10 s countdown (with voice)
// gives time to step into place. A faint copy of the last photo of the same pose helps line up.
// Photos are saved in the app only (IndexedDB), never to the camera roll.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Pose } from '../lib/db';
import { beep, say } from '../lib/sound';
import { addPhoto, photoSession, photos } from '../lib/store';
import { POSE_LABEL, usePhotoUrl } from './Body';
import { Icon } from './common';

const STEPS: { pose: Pose; tip: string }[] = [
  { pose: 'front', tip: 'Face the phone. Arms relaxed at your sides.' },
  { pose: 'side', tip: 'Turn so your right side faces the phone. Arms relaxed.' },
  { pose: 'back', tip: 'Face away from the phone. Arms relaxed.' },
];
const COUNTDOWN = 10;
/** Saved size: 3:4 portrait, up to 960 × 1280. */
const MAX_W = 960;

interface Shot {
  data: ArrayBuffer;
  thumb: ArrayBuffer;
  url: string;
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? b.arrayBuffer().then(resolve, reject) : reject(new Error('No picture'))), 'image/jpeg', quality),
  );
}

/** Center-crop a video frame or picture to 3:4 portrait, then make the photo and its preview. */
async function makeShot(src: CanvasImageSource, w: number, h: number, mirror: boolean): Promise<Shot> {
  let sw = w;
  let sh = h;
  if (w / h > 3 / 4) sw = (h * 3) / 4;
  else sh = (w * 4) / 3;
  const outW = Math.min(MAX_W, Math.round(sw));
  const outH = Math.round((outW * 4) / 3);
  const c = document.createElement('canvas');
  c.width = outW;
  c.height = outH;
  const ctx = c.getContext('2d')!;
  if (mirror) {
    ctx.translate(outW, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(src, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, outW, outH);
  const t = document.createElement('canvas');
  t.width = 240;
  t.height = 320;
  t.getContext('2d')!.drawImage(c, 0, 0, 240, 320);
  const [data, thumb] = await Promise.all([toJpeg(c, 0.85), toJpeg(t, 0.7)]);
  return { data, thumb, url: URL.createObjectURL(new Blob([data], { type: 'image/jpeg' })) };
}

export function PhotoSession() {
  if (!photoSession.value) return null;
  return <Session />;
}

function Session() {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<'aim' | 'counting' | 'review' | 'done'>('aim');
  const [count, setCount] = useState(COUNTDOWN);
  const [shot, setShot] = useState<Shot | null>(null);
  const [cam, setCam] = useState<'starting' | 'on' | 'off' | 'error'>('starting');
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [ghost, setGhost] = useState(true);
  const [saved, setSaved] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  // The last photo of each pose from before this session, for the ghost
  const [before] = useState(() => photos.value);

  const cur = STEPS[Math.min(step, STEPS.length - 1)];
  const prev = before.find((p) => p.pose === cur.pose);
  const ghostUrl = usePhotoUrl(mode === 'aim' || mode === 'counting' ? prev?.id : null);
  const mirror = facing === 'user';

  const stopCamera = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  const startCamera = async () => {
    stopCamera();
    setCam('starting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } },
      });
      stream.current = s;
      s.getVideoTracks()[0]?.addEventListener('ended', () => setCam('off'));
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => {});
      }
      setCam('on');
    } catch {
      setCam('error');
    }
  };

  useEffect(() => {
    void startCamera();
  }, [facing]);

  useEffect(
    () => () => {
      stopCamera();
      if (tick.current) clearInterval(tick.current);
    },
    [],
  );

  // The camera stops when the app goes to the background; offer to turn it back on
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden && stream.current && !stream.current.active) setCam('off');
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const close = () => {
    stopCamera();
    if (tick.current) clearInterval(tick.current);
    if (shot) URL.revokeObjectURL(shot.url);
    photoSession.value = false;
  };

  const cancelCountdown = () => {
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
    setMode('aim');
  };

  const capture = async () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    beep('end');
    setShot(await makeShot(v, v.videoWidth, v.videoHeight, mirror));
    setMode('review');
  };

  const startCountdown = () => {
    let n = COUNTDOWN;
    setCount(n);
    setMode('counting');
    say(String(n));
    tick.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(tick.current!);
        tick.current = null;
        void capture();
        return;
      }
      setCount(n);
      beep('tick');
      say(String(n));
    }, 1000);
  };

  const fromFile = async (file: File) => {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      setShot(await makeShot(img, img.naturalWidth, img.naturalHeight, false));
      setMode('review');
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const next = () => {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
    if (step + 1 >= STEPS.length) {
      stopCamera();
      say('Done');
      setMode('done');
    } else {
      setStep(step + 1);
      setMode('aim');
    }
  };

  const keep = async () => {
    if (!shot) return;
    await addPhoto(cur.pose, shot.data, shot.thumb);
    setSaved((s) => s + 1);
    next();
  };

  const retake = () => {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
    setMode('aim');
  };

  return (
    <div class="cam" role="dialog" aria-label="Progress photos">
      <header class="cam-head">
        <span class="cam-title">
          {mode === 'done' ? 'Progress photos' : `${POSE_LABEL[cur.pose]} · ${step + 1} of ${STEPS.length}`}
        </span>
        <button class="icon-btn" aria-label="Close camera" onClick={close}>
          <Icon name="close" />
        </button>
      </header>

      {mode === 'done' ? (
        <div class="cam-done">
          <Icon name="check" size={72} />
          <p>
            {saved ? `Saved ${saved} photo${saved === 1 ? '' : 's'}.` : 'No photos saved.'} The next set is due in a week.
          </p>
          <button class="big-btn primary" onClick={close}>
            Close
          </button>
        </div>
      ) : (
        <>
          <div class="cam-view">
            {/* The video stays mounted (under the review picture) so the camera keeps running */}
            <video ref={video} class={mirror ? 'mirror' : ''} autoplay muted playsInline />
            {mode === 'review' && shot ? (
              <img class="cam-shot" src={shot.url} alt={`${POSE_LABEL[cur.pose]} photo just taken`} />
            ) : (
              <>
                {ghost && ghostUrl && <img class="cam-ghost" src={ghostUrl} alt="" />}
                {mode === 'counting' && <div class="cam-count">{count}</div>}
                {cam === 'starting' && <div class="cam-msg">Opening the camera…</div>}
                {cam === 'off' && (
                  <button class="cam-msg" onClick={() => void startCamera()}>
                    The camera turned off. Tap to turn it back on.
                  </button>
                )}
                {cam === 'error' && (
                  <div class="cam-msg">
                    The camera didn't open. Allow camera access for this app, or use the iPhone camera below.
                  </div>
                )}
              </>
            )}
          </div>

          <p class="cam-tip">
            {mode === 'review'
              ? 'Happy with it?'
              : mode === 'counting'
                ? 'Get into position…'
                : step === 0 && !prev
                  ? `${cur.tip} Same spot, light and clothes each week makes the change easy to see.`
                  : cur.tip}
          </p>

          <div class="cam-controls">
            {mode === 'aim' && (
              <>
                <button class="big-btn primary" disabled={cam !== 'on'} onClick={startCountdown}>
                  <Icon name="camera" /> Take photo · {COUNTDOWN} s timer
                </button>
                <div class="cam-row">
                  {prev && (
                    <button class="pill-btn" onClick={() => setGhost(!ghost)}>
                      {ghost ? 'Hide last photo' : 'Show last photo'}
                    </button>
                  )}
                  <button class="pill-btn" onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')}>
                    Flip camera
                  </button>
                  <button class="pill-btn" onClick={next}>
                    Skip {POSE_LABEL[cur.pose].toLowerCase()}
                  </button>
                </div>
                {cam === 'error' && (
                  <label class="big-btn">
                    Use the iPhone camera
                    <input
                      type="file"
                      accept="image/*"
                      capture="user"
                      hidden
                      onChange={(e) => {
                        const f = (e.target as HTMLInputElement).files?.[0];
                        if (f) void fromFile(f);
                      }}
                    />
                  </label>
                )}
              </>
            )}
            {mode === 'counting' && (
              <button class="big-btn" onClick={cancelCountdown}>
                Cancel
              </button>
            )}
            {mode === 'review' && (
              <div class="cam-row two">
                <button class="big-btn" onClick={retake}>
                  Retake
                </button>
                <button class="big-btn primary" onClick={() => void keep()}>
                  <Icon name="check" /> Keep
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
