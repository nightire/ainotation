import { canvasBlob, imageCanvas } from './images';
import type { ImageCrop } from './crop';
import { uiError, UiError, msg } from '../i18n';

function captureTask<T>(
  task: Promise<T>,
  signal: AbortSignal,
  discard?: (value: T) => void,
): Promise<T> {
  const bound = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => {
      settled = true;
      reject(uiError('captureTimeout'));
    };
    if (bound.aborted) abort();
    else bound.addEventListener('abort', abort, { once: true });
    void task.then(
      (value) => {
        bound.removeEventListener('abort', abort);
        if (settled) discard?.(value);
        else {
          settled = true;
          resolve(value);
        }
      },
      (error: unknown) => {
        bound.removeEventListener('abort', abort);
        if (!settled) {
          settled = true;
          reject(error);
        }
      },
    );
  });
}

/** Call synchronously inside the screenshot action to retain user activation. */
export function requestCapture(signal: AbortSignal): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia)
    return Promise.reject(uiError('captureUnavailable'));
  const captureOptions = {
    audio: false,
    video: true,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
  };
  const request = navigator.mediaDevices.getDisplayMedia(captureOptions);
  // A system picker cannot be dismissed by script. Dispose any late authorization.
  return request.then((stream) => {
    if (signal.aborted) {
      stream.getTracks().forEach((track) => track.stop());
      signal.throwIfAborted();
    }
    return stream;
  });
}

export async function createScreenCapture(stream: MediaStream, signal: AbortSignal) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  const stop = () => {
    stream.getTracks().forEach((track) => track.stop());
    video.pause();
    video.srcObject = null;
    signal.removeEventListener('abort', stop);
  };
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) {
    stop();
    signal.throwIfAborted();
  }
  try {
    await captureTask(video.play(), signal);
  } catch (error) {
    stop();
    throw error;
  }
  async function nextFrame() {
    const requestedAt = performance.now();
    const waitSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
    waitSignal.throwIfAborted();
    // Let the browser commit the editor's hidden controls before asking the
    // capture pipeline for its next frame, including on slower CI machines.
    const painted = new Promise<void>((resolve, reject) => {
      let frame = 0;
      const abort = () => {
        cancelAnimationFrame(frame);
        reject(uiError('frameWaiting'));
      };
      const done = () => {
        waitSignal.removeEventListener('abort', abort);
        resolve();
      };
      waitSignal.addEventListener('abort', abort, { once: true });
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(done);
      });
    });
    // Subscribe before the repaint so a static tab's only fresh frame cannot be missed.
    const fresh = new Promise<void>((resolve, reject) => {
      let callback = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (callback) video.cancelVideoFrameCallback(callback);
        clearTimeout(timer);
        waitSignal.removeEventListener('abort', abort);
      };
      const abort = () => {
        cleanup();
        reject(uiError('frameWaiting'));
      };
      const done = () => {
        cleanup();
        resolve();
      };
      waitSignal.addEventListener('abort', abort, { once: true });
      const received: VideoFrameRequestCallback = (_now, metadata) => {
        // A decoded frame can have been captured before the controls were hidden.
        if (metadata.captureTime !== undefined && metadata.captureTime < requestedAt) {
          callback = video.requestVideoFrameCallback(received);
          return;
        }
        done();
      };
      if (video.requestVideoFrameCallback) callback = video.requestVideoFrameCallback(received);
      // Static/undisplayed video may not be submitted to the compositor again.
      // Tab capture must await a fresh frame rather than fall back to visible controls.
      if (
        !video.requestVideoFrameCallback ||
        stream.getVideoTracks()[0]?.getSettings().displaySurface !== 'browser'
      )
        timer = setTimeout(done, 200);
    });
    await Promise.all([painted, fresh]);
  }
  return {
    stop,
    async snapshot(crop?: ImageCrop) {
      if (stream.getVideoTracks()[0]?.readyState !== 'live') throw uiError('captureStopped');
      if (crop && stream.getVideoTracks()[0]?.getSettings().displaySurface !== 'browser')
        throw uiError('cropNeedsTab');
      // Wait beyond the frame already queued when editor controls were hidden.
      await nextFrame();
      signal.throwIfAborted();
      type Grabber = new (track: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> };
      const Grab = (globalThis as typeof globalThis & { ImageCapture?: Grabber }).ImageCapture;
      const frame = Grab
        ? await captureTask(
            Promise.resolve().then(() => new Grab(stream.getVideoTracks()[0]!).grabFrame()),
            signal,
            (late) => late.close(),
          ).catch((error: unknown) => {
            signal.throwIfAborted();
            // Some capture sources expose ImageCapture but intermittently fail
            // grabFrame(). The playing video remains the portable frame source.
            if (
              stream.getVideoTracks()[0]?.readyState === 'live' &&
              video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
            )
              return null;
            throw new UiError(msg('frameFailed'), {
              cause: error,
            });
          })
        : null;
      let canvas: HTMLCanvasElement;
      try {
        signal.throwIfAborted();
        canvas = imageCanvas(
          frame ?? video,
          frame?.width ?? video.videoWidth,
          frame?.height ?? video.videoHeight,
          crop,
        );
      } finally {
        frame?.close();
      }
      try {
        return await canvasBlob(canvas, signal);
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    },
  };
}
