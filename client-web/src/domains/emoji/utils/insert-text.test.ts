import { describe, it, expect } from 'vitest';
import { insertAtSelection, stepIndex } from './insert-text';

describe('insertAtSelection', () => {
	it('inserts at the caret and moves the caret after the text', () => {
		expect(insertAtSelection('helloworld', 5, 5, '😀')).toEqual({ text: 'hello😀world', caret: 7 });
	});
	it('replaces a selection', () => {
		expect(insertAtSelection('hello world', 5, 11, '👍🏽')).toEqual({ text: 'hello👍🏽', caret: 9 });
	});
	it('appends when there is no selection info', () => {
		expect(insertAtSelection('hi', null, undefined, '🚀')).toEqual({ text: 'hi🚀', caret: 4 });
	});
	it('clamps out-of-range and reversed positions', () => {
		expect(insertAtSelection('ab', 99, 99, 'x').text).toBe('abx');
		expect(insertAtSelection('ab', -5, -5, 'x').text).toBe('xab');
		expect(insertAtSelection('abcd', 3, 1, 'x').text).toBe('abcxd');
	});
	it('keeps the value real Unicode, repeated inserts included', () => {
		let v = { text: '', caret: 0 };
		for (let i = 0; i < 3; i++) v = insertAtSelection(v.text, v.caret, v.caret, '❤️');
		expect(v.text).toBe('❤️❤️❤️');
		expect(v.text).not.toMatch(/[<>]|:/);
	});
	it('can insert a shortcode', () => {
		expect(insertAtSelection('a ', 2, 2, ':party:').text).toBe('a :party:');
	});
});

describe('stepIndex', () => {
	it('moves and clamps', () => {
		expect(stepIndex(2, 5, 'ArrowRight', false)).toBe(3);
		expect(stepIndex(0, 5, 'ArrowLeft', false)).toBe(0);
		expect(stepIndex(4, 5, 'ArrowRight', false)).toBe(4);
	});
	it('flips in RTL', () => {
		expect(stepIndex(2, 5, 'ArrowRight', true)).toBe(1);
		expect(stepIndex(2, 5, 'ArrowLeft', true)).toBe(3);
	});
	it('handles Home, End and empty lists', () => {
		expect(stepIndex(2, 5, 'Home', false)).toBe(0);
		expect(stepIndex(2, 5, 'End', false)).toBe(4);
		expect(stepIndex(0, 0, 'End', false)).toBe(-1);
	});
});
