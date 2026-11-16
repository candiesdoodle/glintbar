/**
 * Alert tones, synthesised with WebAudio (no audio files). Each tone is a few short notes with a
 * soft attack and exponential release. The AudioContext is created on first use and suspended
 * again after playing, so nothing runs while idle.
 */

export type SoundId = "chime" | "bell" | "pop" | "digital" | "marimba" | "rise";

export const SOUNDS: Array<{ id: SoundId; label: string }> = [
  { id: "chime", label: "Chime" },
  { id: "bell", label: "Bell" },
  { id: "marimba", label: "Marimba" },
  { id: "pop", label: "Pop" },
  { id: "digital", label: "Digital" },
  { id: "rise", label: "Rise" },
];

interface Note {
  /** Hz */
  f: number;
  /** Start offset in seconds. */
  t: number;
  /** Length in seconds. */
  d: number;
  type?: OscillatorType;
  gain?: number;
  /** Extra partial (ratio of f) for bell-like timbres. */
  partial?: number;
}

const TONES: Record<SoundId, Note[]> = {
  chime: [
    { f: 880, t: 0, d: 0.9, type: "sine", partial: 2 },
    { f: 1318.5, t: 0.16, d: 1.1, type: "sine", partial: 2 },
  ],
  bell: [
    { f: 659.3, t: 0, d: 1.6, type: "sine", partial: 2.76, gain: 0.9 },
    { f: 659.3, t: 0.55, d: 1.6, type: "sine", partial: 2.76, gain: 0.7 },
  ],
  marimba: [
    { f: 523.3, t: 0, d: 0.35, type: "triangle", partial: 4 },
    { f: 659.3, t: 0.12, d: 0.35, type: "triangle", partial: 4 },
    { f: 784, t: 0.24, d: 0.5, type: "triangle", partial: 4 },
  ],
  pop: [{ f: 600, t: 0, d: 0.12, type: "sine", gain: 1 }],
  digital: [
    { f: 1760, t: 0, d: 0.08, type: "square", gain: 0.25 },
    { f: 1760, t: 0.14, d: 0.08, type: "square", gain: 0.25 },
    { f: 1760, t: 0.28, d: 0.08, type: "square", gain: 0.25 },
  ],
  rise: [
    { f: 440, t: 0, d: 0.25, type: "sine" },
    { f: 554.4, t: 0.12, d: 0.25, type: "sine" },
    { f: 659.3, t: 0.24, d: 0.25, type: "sine" },
    { f: 880, t: 0.36, d: 0.6, type: "sine" },
  ],
};

let ctx: AudioContext | null = null;
let suspendTimer: ReturnType<typeof setTimeout> | undefined;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  return ctx;
}

/** Plays a tone at `volume` (0-1). Safe to call anywhere; silently does nothing without audio. */
export function playSound(id: SoundId, volume = 0.6): void {
  const ac = audio();
  const notes = TONES[id];
  if (!ac || !notes || volume <= 0) return;
  void ac.resume().catch(() => {});
  const master = ac.createGain();
  master.gain.value = Math.min(1, Math.max(0, volume)) * 0.35;
  master.connect(ac.destination);
  const t0 = ac.currentTime + 0.02;
  let end = 0;
  for (const n of notes) {
    const freqs = n.partial ? [n.f, n.f * n.partial] : [n.f];
    freqs.forEach((f, i) => {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = n.type ?? "sine";
      osc.frequency.value = f;
      const peak = (n.gain ?? 0.8) * (i === 0 ? 1 : 0.22);
      const start = t0 + n.t;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(peak, start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, start + n.d);
      osc.connect(g);
      g.connect(master);
      osc.start(start);
      osc.stop(start + n.d + 0.05);
    });
    end = Math.max(end, n.t + n.d);
  }
  clearTimeout(suspendTimer);
  suspendTimer = setTimeout(() => {
    master.disconnect();
    void ctx?.suspend().catch(() => {});
  }, (end + 0.4) * 1000);
}
