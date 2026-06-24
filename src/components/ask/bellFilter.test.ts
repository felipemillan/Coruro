import { describe, it, expect } from 'vitest';
import { createBellFilter } from './bellFilter';

const BEL = '\x07';
const ESC = '\x1b';

describe('createBellFilter', () => {
  it('strips and counts a bare bell in normal text', () => {
    const f = createBellFilter();
    const r = f(`done${BEL}`);
    expect(r.text).toBe('done');
    expect(r.bells).toBe(1);
  });

  it('counts multiple bare bells', () => {
    const f = createBellFilter();
    const r = f(`${BEL}a${BEL}${BEL}b`);
    expect(r.text).toBe('ab');
    expect(r.bells).toBe(3);
  });

  it('preserves a BEL used as an OSC string terminator (window title)', () => {
    const f = createBellFilter();
    const seq = `${ESC}]0;my-repo${BEL}`;
    const r = f(seq);
    expect(r.text).toBe(seq); // terminator kept — xterm needs it to close the OSC
    expect(r.bells).toBe(0);
  });

  it('still rings a bare bell that follows a completed OSC title', () => {
    const f = createBellFilter();
    const r = f(`${ESC}]0;title${BEL}body${BEL}`);
    expect(r.text).toBe(`${ESC}]0;title${BEL}body`);
    expect(r.bells).toBe(1);
  });

  it('preserves an OSC closed by ST (ESC backslash)', () => {
    const f = createBellFilter();
    const seq = `${ESC}]8;;https://x${ESC}\\link`;
    const r = f(seq);
    expect(r.text).toBe(seq);
    expect(r.bells).toBe(0);
  });

  it('keeps OSC-terminator state across chunk boundaries', () => {
    const f = createBellFilter();
    const a = f(`${ESC}]0;parti`); // OSC opened, not yet terminated
    const b = f(`al${BEL}${BEL}`); // first BEL closes OSC, second is a real bell
    expect(a.bells).toBe(0);
    expect(b.text).toBe(`al${BEL}`);
    expect(b.bells).toBe(1);
  });

  it('leaves plain text untouched', () => {
    const f = createBellFilter();
    const r = f('hello world\r\n');
    expect(r.text).toBe('hello world\r\n');
    expect(r.bells).toBe(0);
  });
});
