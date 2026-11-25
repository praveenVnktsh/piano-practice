import {describe, expect, test} from 'vitest';
import {actionError, describeAction, exerciseName, validateActions} from '../teacher/actions.js';

describe('teacher actions', () => {
  test.each([
    [{type: 'open_song', id: 'fur-elise'}],
    [{type: 'set_section', first: 0, last: 7}],
    [{type: 'set_section', first: 3, last: 3, label: 'Just bar 4'}],
    [{type: 'set_tempo', bpm: 60}],
    [{type: 'set_hands', hands: 'left'}],
    [{type: 'set_mode', mode: 'wait'}],
    [{type: 'set_loop', on: false}],
    [{type: 'open_exercise', id: 'ex:scale:C:major:both:2:up-down'}],
    [{type: 'open_exercise', id: 'ex:arpeggio:Fs:minor:right:2'}],
    [{type: 'open_note_reading'}],
    [{type: 'open_note_reading', level: 'treble-ledger'}],
    [{type: 'plan', items: [{label: 'Warm up', minutes: 5, action: {type: 'open_exercise', id: 'ex:five-finger:G:major:both'}}, {label: 'Run-through'}]}],
  ])('accepts %j', action => {
    expect(actionError(action)).toBe('');
  });

  test.each([
    [null, 'must be an object'],
    [{type: 'rm_rf'}, 'type must be one of'],
    [{type: 'open_song'}, 'missing id'],
    [{type: 'open_song', id: ''}, 'song id'],
    [{type: 'open_song', id: 'x', extra: 1}, 'unknown field extra'],
    [{type: 'set_section', first: 1.5, last: 3}, '0-based'],
    [{type: 'set_section', first: 5, last: 2}, 'last must be ≥ first'],
    [{type: 'set_section', first: -1, last: 2}, '0-based'],
    [{type: 'set_tempo', bpm: '60'}, 'bpm'],
    [{type: 'set_tempo', bpm: 1000}, 'bpm'],
    [{type: 'set_hands', hands: 'both hands'}, 'hands must be'],
    [{type: 'set_mode', mode: 'fast'}, 'mode must be'],
    [{type: 'set_loop', on: 'yes'}, 'true or false'],
    [{type: 'open_exercise', id: 'fur-elise'}, 'exercise id'],
    [{type: 'open_exercise', id: 'ex:scale:H:major'}, 'exercise id'],
    [{type: 'open_note_reading', level: '<b>'}, 'level'],
    [{type: 'plan', items: []}, 'non-empty'],
    [{type: 'plan', items: [{minutes: 5}]}, 'label'],
    [{type: 'plan', items: [{label: 'x', minutes: 0}]}, 'minutes'],
    [{type: 'plan', items: [{label: 'x', action: {type: 'plan', items: [{label: 'y'}]}}]}, "can't be another plan"],
    [{type: 'plan', items: [{label: 'x', action: {type: 'set_tempo', bpm: 5}}]}, 'items[0].action'],
    [{type: 'set_loop', on: true, label: ''}, 'label'],
  ])('refuses %j', (action, message) => {
    expect(actionError(action)).toContain(message);
  });

  test('validateActions checks the list and every entry', () => {
    expect(validateActions(undefined)).toEqual([]);
    expect(() => validateActions({type: 'set_loop', on: true})).toThrow('JSON array');
    expect(() => validateActions([{type: 'set_loop', on: true}, {type: 'nope'}])).toThrow('actions[1]');
    expect(() => validateActions(Array(11).fill({type: 'set_loop', on: true}))).toThrow('at most 10');
  });

  test('describes actions for their buttons', () => {
    expect(describeAction({type: 'set_section', first: 0, last: 7})).toBe('Practise bars 1–8');
    expect(describeAction({type: 'open_song', id: 'fur-elise'}, () => 'Für Elise')).toBe('Open Für Elise');
    expect(describeAction({type: 'set_tempo', bpm: 60, label: 'Slow down'})).toBe('Slow down');
    expect(exerciseName('ex:scale:Fs:minor:both:2')).toBe('F♯ minor scale');
    expect(exerciseName('ex:five-finger:Bb:major:both')).toBe('B♭ major five finger');
  });
});
