/**
 * Canvas capture.
 *
 * Uses MediaRecorder on the live canvas stream, which keeps everything in the
 * browser — nothing is uploaded and no server is involved. Container support
 * varies by browser: Chrome and Firefox produce WebM, recent Safari can do
 * MP4. We pick the best available and tell the caller what we actually got,
 * so the UI never promises a format the browser cannot deliver.
 */

const CANDIDATES = [
  { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
  { mime: 'video/mp4', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' }
]

export function recordingSupport () {
  if (typeof MediaRecorder === 'undefined') {
    return { supported: false, reason: 'This browser has no MediaRecorder support.' }
  }
  const pick = CANDIDATES.find(c => MediaRecorder.isTypeSupported(c.mime))
  if (!pick) {
    return { supported: false, reason: 'This browser cannot encode video from a canvas.' }
  }
  return { supported: true, ...pick }
}

export class Recorder {
  constructor (canvas, { fps = 60 } = {}) {
    this.canvas = canvas
    this.fps = fps
    this.chunks = []
    this.recorder = null
    this.format = null
  }

  get active () {
    return this.recorder?.state === 'recording'
  }

  start () {
    const support = recordingSupport()
    if (!support.supported) throw new Error(support.reason)

    this.format = support
    this.chunks = []

    const stream = this.canvas.captureStream(this.fps)
    this.recorder = new MediaRecorder(stream, {
      mimeType: support.mime,
      videoBitsPerSecond: 12_000_000
    })
    this.recorder.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data) }
    this.recorder.start()
  }

  /** Stop and resolve with a Blob. Rejects if nothing was captured. */
  stop () {
    return new Promise((resolve, reject) => {
      if (!this.recorder) return reject(new Error('Nothing is recording.'))
      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.format.mime })
        this.chunks = []
        blob.size
          ? resolve({ blob, ext: this.format.ext })
          : reject(new Error('The recording came back empty.'))
      }
      this.recorder.stop()
    })
  }

  cancel () {
    if (this.recorder?.state !== 'inactive') this.recorder?.stop()
    this.chunks = []
    this.recorder = null
  }
}

export function downloadBlob (blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // revoke on the next tick so the download has definitely started
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function safeName (start, end) {
  const slug = s => (s || 'place').split(',')[0]
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28)
  return `lymsta-${slug(start)}-to-${slug(end)}`
}
