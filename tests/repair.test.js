import {describe, expect, it} from 'vitest';
import {repairSection, slowTempo, startRepair, repairStep, repairStatus, repairRestore, REPAIR_PASSES} from '../src/practice/repair.mjs';
import {DEFAULT_CONTROL_KEY, keyName, normaliseControlKey, pieceUsesKey, isControlPress, isControlRelease, controlAction} from '../src/practice/control-key.mjs';

const bar = (index, start, len = 4, meter = {count: 4, unit: 4}) => ({index, start, end: start + len, meter});
const measures = [bar(0, 0), bar(1, 4), bar(2, 8), bar(3, 12, 3, {count: 3, unit: 4})];

describe('repairSection', () => {
  it('is the stuck bar alone mid-bar', () => {
    expect(repairSection(measures, 1, 4)).toEqual([1, 1]);
    expect(repairSection(measures, 1, 6.5)).toEqual([1, 1]);
  });
  it('takes the next bar too when the chord is on the last beat', () => {
    expect(repairSection(measures, 1, 7)).toEqual([1, 2]);
    expect(repairSection(measures, 2, 11.5)).toEqual([2, 3]);
  });
  it('stays in the piece at the last bar', () => {
    expect(repairSection(measures, 3, 14)).toEqual([3, 3]);
    expect(repairSection(measures, 9, 0)).toBe(null);
  });
  it('reads compound meters by the dotted beat', () => {
    const six = [bar(0, 0, 3, {count: 6, unit: 8}), bar(1, 3, 3, {count: 6, unit: 8})];
    expect(repairSection(six, 0, 1)).toEqual([0, 0]);
    expect(repairSection(six, 0, 1.5)).toEqual([0, 1]);
  });
});

describe('repair loop', () => {
  const base = {first: 6, last: 6, section: [4, 11], loop: false, tempo: 90};
  it('starts at 70 % in Play along, not below 40 nor above the tempo', () => {
    expect(startRepair({...base, mode: 'timed'}).tempo).toBe(63);
    expect(slowTempo(50)).toBe(40);
    expect(slowTempo(36)).toBe(36);
    expect(startRepair({...base, mode: 'wait'}).tempo).toBe(90);
  });
  it('keeps what it must put back', () => {
    const s = startRepair({...base, mode: 'wait', loop: true});
    expect(s.original).toEqual({section: [4, 11], loop: true, tempo: 90});
  });
  it('Play along: clean passes climb ~10 % to the tempo, then three clean passes there finish', () => {
    let s = startRepair({...base, mode: 'timed'});
    const tempos = [];
    let r;
    for (let i = 0; i < 20; i++) {
      r = repairStep(s, 100); s = r.state; tempos.push(r.tempo);
      if (r.done) break;
    }
    expect(tempos.slice(0, 5)).toEqual([69, 76, 84, 90, 90]);
    expect(r.done).toBe(true);
    expect(s.clean).toBe(REPAIR_PASSES);
    expect(tempos.filter(t => t === 90)).toHaveLength(4); // the climb to 90, then 3 counted passes
  });
  it('a slip keeps the tempo and starts the count again', () => {
    let s = startRepair({...base, mode: 'timed', tempo: 63});
    s = {...s, tempo: 63};
    s = repairStep(s, 100).state; s = repairStep(s, 100).state;
    expect(s.clean).toBe(2);
    const r = repairStep(s, 80);
    expect(r).toMatchObject({clean: 0, tempo: 63, done: false, raised: false});
  });
  it('Wait: three clean passes in a row, the tempo untouched', () => {
    let s = startRepair({...base, mode: 'wait'});
    let r = repairStep(s, 100); s = r.state;
    expect(r).toMatchObject({clean: 1, tempo: 90, done: false});
    r = repairStep(s, 90); s = r.state;
    expect(r.clean).toBe(0);
    for (let i = 0; i < 3; i++) { r = repairStep(s, 95); s = r.state; }
    expect(r).toMatchObject({clean: 3, done: true, tempo: 90});
  });
  it('status line', () => {
    const t = startRepair({...base, mode: 'timed'});
    expect(repairStatus(t, 'Bar 7')).toBe('Repair loop · Bar 7 · clean 0 of 3 · ♩ = 63 → 90');
    expect(repairStatus({...t, tempo: 90, clean: 2}, 'Bar 7')).toBe('Repair loop · Bar 7 · clean 2 of 3 · ♩ = 90');
    expect(repairStatus(startRepair({...base, mode: 'wait'}), 'Bar 7')).toBe('Repair loop · Bar 7 · clean 0 of 3');
  });
  it('restores the section, loop and tempo and resumes at the bar after', () => {
    expect(repairRestore(startRepair({...base, mode: 'timed'}))).toEqual({section: [4, 11], loop: false, tempo: 90, resumeAt: 7});
    expect(repairRestore(startRepair({...base, first: 10, last: 11, mode: 'wait'})).resumeAt).toBe(null);
  });
});

describe('control key', () => {
  it('defaults to C8 and names keys', () => {
    expect(DEFAULT_CONTROL_KEY).toBe(108);
    expect(keyName(108)).toBe('C8');
    expect(keyName(21)).toBe('A0');
    expect(keyName(61)).toBe('C♯4');
  });
  it('normalises saved values', () => {
    expect(normaliseControlKey(96)).toBe(96);
    expect(normaliseControlKey('100')).toBe(100);
    for (const v of [undefined, null, '', 'x', 200, -1, 60.5, true]) expect(normaliseControlKey(v)).toBe(108);
  });
  it('matches note-on of the key on any channel, not velocity 0 or other keys', () => {
    expect(isControlPress([0x90, 108, 64], 108)).toBe(true);
    expect(isControlPress([0x93, 108, 1], 108)).toBe(true);
    expect(isControlPress([0x90, 108, 0], 108)).toBe(false);
    expect(isControlPress([0x90, 107, 64], 108)).toBe(false);
    expect(isControlPress([0x80, 108, 64], 108)).toBe(false);
    expect(isControlPress([0xb0, 108, 127], 108)).toBe(false);
    expect(isControlRelease([0x80, 108, 0], 108)).toBe(true);
    expect(isControlRelease([0x90, 108, 0], 108)).toBe(true);
    expect(isControlRelease([0x90, 108, 30], 108)).toBe(false);
  });
  it('steps aside when the piece plays that pitch', () => {
    expect(pieceUsesKey([{n: 60}, {n: 108}], 108)).toBe(true);
    expect(pieceUsesKey([{n: 60}], 108)).toBe(false);
    expect(pieceUsesKey(null, 108)).toBe(false);
  });
  it('accepts an offer, else restarts, else starts', () => {
    expect(controlAction({offer: true, practicing: true})).toBe('accept');
    expect(controlAction({practicing: true})).toBe('restart');
    expect(controlAction({loop: true})).toBe('restart');
    expect(controlAction({repair: true})).toBe('restart');
    expect(controlAction({})).toBe('start');
  });
});
