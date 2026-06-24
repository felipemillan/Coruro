// bellFilter — terminal bell handling for the Code-tab xterm sessions.
//
// Claude Code rings the terminal bell (BEL, 0x07) on task-done. We do NOT want
// the raw byte to reach xterm / the webview (which may beep). Instead we strip
// the *bare* bell from the PTY output stream and surface a controlled, opt-in
// notification (audio beep and/or a visual flash) driven by user settings.
//
// The stripper is OSC-safe: a BEL inside an OSC string (e.g. the window-title
// sequence `ESC ] 0 ; … BEL`) is its terminator and MUST be preserved, or xterm
// never closes the OSC and the stream corrupts. Only a BEL in the normal text
// stream is treated as an audible bell and removed.

const BEL = 0x07;
const ESC = 0x1b;

// Parser modes, carried across chunk boundaries so a sequence split mid-OSC is
// still parsed correctly. (Plain numeric union — avoids `const enum`, which is
// unsafe under isolatedModules / esbuild.)
const NORMAL = 0; // normal text
const ESC_SEEN = 1; // saw ESC in normal text
const OSC = 2; // inside an OSC string (ESC ] … )
const OSC_ESC = 3; // saw ESC inside an OSC string (candidate ST: ESC \ )
type Mode = typeof NORMAL | typeof ESC_SEEN | typeof OSC | typeof OSC_ESC;

/** Result of feeding a chunk through a {@link BellFilter}. */
export interface BellFilterResult {
  /** The chunk with bare bells removed (OSC-terminator bells preserved). */
  text: string;
  /** How many bare bells were stripped from this chunk. */
  bells: number;
}

export type BellFilter = (chunk: string) => BellFilterResult;

interface BellState {
  mode: Mode;
}

/** Per-character transition. Mutates `state.mode`; returns the emitted text and
 *  whether this char was a bare (audible) bell. */
function stepChar(state: BellState, ch: string, code: number): { emit: string; bell: boolean } {
  if (state.mode === ESC_SEEN) {
    state.mode = ch === ']' ? OSC : NORMAL;
    return { emit: ch, bell: false };
  }
  if (state.mode === OSC) {
    if (code === BEL)
      state.mode = NORMAL; // OSC terminator — keep it
    else if (code === ESC) state.mode = OSC_ESC;
    return { emit: ch, bell: false };
  }
  if (state.mode === OSC_ESC) {
    state.mode = ch === '\\' ? NORMAL : OSC; // ESC \ = ST
    return { emit: ch, bell: false };
  }
  // NORMAL
  if (code === ESC) {
    state.mode = ESC_SEEN;
    return { emit: ch, bell: false };
  }
  if (code === BEL) return { emit: '', bell: true }; // bare bell — strip it
  return { emit: ch, bell: false };
}

/** Creates a stateful, OSC-safe bell stripper. One per PTY session. */
export function createBellFilter(): BellFilter {
  const state: BellState = { mode: NORMAL };
  return (chunk: string): BellFilterResult => {
    let out = '';
    let bells = 0;
    for (let i = 0; i < chunk.length; i++) {
      const r = stepChar(state, chunk[i], chunk.charCodeAt(i));
      out += r.emit;
      if (r.bell) bells++;
    }
    return { text: out, bells };
  };
}

// Lazily-created shared AudioContext; the first beep happens well after the
// user's first gesture (spawning a session), so autoplay policy is satisfied.
let audioCtx: AudioContext | null = null;

/** Plays a short, soft "task-done" beep via the Web Audio API. No-op on error. */
export function playBeep(): void {
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    const ctx = audioCtx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 660;
    // Quick attack, gentle decay — a brief chime, not a harsh blip.
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.14, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  } catch {
    /* AudioContext unavailable — silently skip. */
  }
}

/** Flashes the terminal container border briefly via the `.bell-flash` class. */
export function flashTerminal(el: HTMLElement | null): void {
  if (el === null) return;
  el.classList.remove('bell-flash');
  // Force reflow so re-adding the class restarts the animation on rapid bells.
  void el.offsetWidth;
  el.classList.add('bell-flash');
  window.setTimeout(() => el.classList.remove('bell-flash'), 450);
}
