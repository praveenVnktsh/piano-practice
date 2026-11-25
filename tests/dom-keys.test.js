// @vitest-environment jsdom
// keyForControl: which key presses belong to the focused control rather than a view's shortcuts.
// QA regression: after tapping the hands switch (a radio) or "Any octave" (a checkbox), the
// player's and trainer's letter shortcuts (K, L, H, O…) were silently ignored.
import {describe, expect, test} from 'vitest';
import {keyForControl} from '../src/app/dom.js';

const press = (target, key, code = key.length === 1 ? 'Key' + key.toUpperCase() : key) => ({target, key, code});
const input = type => Object.assign(document.createElement('input'), {type});

describe('keyForControl', () => {
  test('letters reach the shortcuts from a focused radio, checkbox or slider', () => {
    for (const type of ['radio', 'checkbox', 'range']) {
      expect(keyForControl(press(input(type), 'k'))).toBe(false);
      expect(keyForControl(press(input(type), 'h'))).toBe(false);
    }
  });
  test('Space, Enter and arrows stay with a focused toggle', () => {
    for (const type of ['radio', 'checkbox', 'range']) {
      expect(keyForControl(press(input(type), ' ', 'Space'))).toBe(true);
      expect(keyForControl(press(input(type), 'Enter'))).toBe(true);
      expect(keyForControl(press(input(type), 'ArrowLeft'))).toBe(true);
    }
  });
  test('typing fields keep every key', () => {
    expect(keyForControl(press(input('text'), 'k'))).toBe(true);
    expect(keyForControl(press(input('search'), 'l'))).toBe(true);
    expect(keyForControl(press(input('number'), '3', 'Digit3'))).toBe(true);
    expect(keyForControl(press(document.createElement('textarea'), 'k'))).toBe(true);
    expect(keyForControl(press(document.createElement('select'), 'k'))).toBe(true);
    const div = document.createElement('div');
    div.setAttribute('contenteditable', '');
    expect(keyForControl(press(div, 'k'))).toBe(true);
  });
  test('buttons and the page itself do not swallow shortcuts', () => {
    expect(keyForControl(press(document.createElement('button'), 'k'))).toBe(false);
    expect(keyForControl(press(document.body, 'k'))).toBe(false);
    expect(keyForControl(press(window, 'k'))).toBe(false);
  });
});
