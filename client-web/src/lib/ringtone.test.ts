import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRinger, type RingerAudio } from './ringtone';

function fakeAudio() {
	const made: (RingerAudio & { src: string; plays: number; pauses: number })[] = [];
	const factory = (src: string) => {
		const a = {
			src,
			loop: false,
			volume: 1,
			currentTime: 0,
			plays: 0,
			pauses: 0,
			play: () => {
				a.plays++;
				return Promise.resolve();
			},
			pause: () => {
				a.pauses++;
			},
		};
		made.push(a);
		return a;
	};
	return { made, factory };
}

describe('createRinger', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('plays the sound in a loop', () => {
		const { made, factory } = fakeAudio();
		const ringer = createRinger(factory);
		ringer.start('/call-ring.wav');
		expect(made).toHaveLength(1);
		expect(made[0]).toMatchObject({ src: '/call-ring.wav', loop: true, plays: 1 });
		expect(ringer.isRinging()).toBe(true);
	});

	it('does not stack a second ring while one is already going', () => {
		const { made, factory } = fakeAudio();
		const ringer = createRinger(factory);
		ringer.start('/call-ring.wav');
		ringer.start('/call-ring.wav');
		expect(made).toHaveLength(1);
	});

	it('stops and rewinds on stop, and stop is safe when nothing rings', () => {
		const { made, factory } = fakeAudio();
		const ringer = createRinger(factory);
		expect(() => ringer.stop()).not.toThrow();
		ringer.start('/call-ring.wav');
		ringer.stop();
		expect(made[0].pauses).toBe(1);
		expect(made[0].currentTime).toBe(0);
		expect(ringer.isRinging()).toBe(false);
	});

	it('gives up by itself after the limit, so an unanswered call does not ring forever', () => {
		const { made, factory } = fakeAudio();
		const ringer = createRinger(factory, 30_000);
		ringer.start('/call-ring.wav');
		vi.advanceTimersByTime(29_999);
		expect(ringer.isRinging()).toBe(true);
		vi.advanceTimersByTime(2);
		expect(ringer.isRinging()).toBe(false);
		expect(made[0].pauses).toBe(1);
	});

	it('can ring again after stopping', () => {
		const { made, factory } = fakeAudio();
		const ringer = createRinger(factory);
		ringer.start('/call-ring.wav');
		ringer.stop();
		ringer.start('/call-ring.wav');
		expect(made).toHaveLength(2);
		expect(ringer.isRinging()).toBe(true);
	});

	it('survives a browser that blocks autoplay', async () => {
		const blocked = (src: string): RingerAudio => ({
			src,
			loop: false,
			volume: 1,
			currentTime: 0,
			play: () => Promise.reject(new Error('NotAllowedError')),
			pause: () => {},
		});
		const ringer = createRinger(blocked);
		ringer.start('/call-ring.wav');
		await Promise.resolve();
		expect(ringer.isRinging()).toBe(false);
	});
});
