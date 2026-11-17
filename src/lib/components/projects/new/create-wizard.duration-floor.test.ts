import { describe, it, expect, beforeEach } from 'vitest';
import { createWizard } from './create-wizard.svelte.js';
import { minDurationSecondsFor } from '$lib/studio/project-request.js';

/**
 * The UI floor for a deliverable's target duration.
 *
 * The backend accepts a 10s order; the wizard refused anything under 30s, so
 * short orders were blocked client-side by a rule the API never had. Owner
 * decision: the floor is 10s everywhere. These tests pin the accepted/rejected
 * boundary so the two ends cannot drift apart again.
 *
 * website_review is the only type carrying a floor at all — every other type is
 * unfloored, so it is the one that exercises `durationsValid`.
 */
const FLOOR = 10;

function armVideoWebsiteReview() {
	createWizard.projectType = 'website_review';
	// website_review's video pipeline is opt-in; the duration floor only applies
	// while a video is actually produced (`producesVideo` gates it).
	createWizard.generateVideo = true;
	createWizard.generateRedesign = true;
	createWizard.generateCritique = true;
}

function setDuration(seconds: number | null) {
	createWizard.deliverables = [
		{
			name: 'review video',
			format: '16x9',
			target_duration_seconds: seconds,
			captions_mode: 'none'
		}
	];
}

describe('deliverable duration floor', () => {
	beforeEach(() => {
		armVideoWebsiteReview();
	});

	it('exposes the floor as 10 seconds, matching the backend', () => {
		expect(minDurationSecondsFor('website_review')).toBe(FLOOR);
		expect(createWizard.minDurationSeconds).toBe(FLOOR);
	});

	it('ACCEPTS a duration exactly at the floor (10s)', () => {
		setDuration(10);
		expect(createWizard.durationsValid).toBe(true);
	});

	it('REJECTS a duration one second below the floor (9s)', () => {
		setDuration(9);
		expect(createWizard.durationsValid).toBe(false);
	});

	it('still accepts a duration well above the floor', () => {
		setDuration(120);
		expect(createWizard.durationsValid).toBe(true);
	});

	it('accepts an empty duration — it falls back to the type default', () => {
		setDuration(null);
		expect(createWizard.durationsValid).toBe(true);
	});

	// Guards the gate that makes the floor reachable at all: a critique-only
	// website_review produces no video, so no duration can block it.
	it('does not apply any floor when the run produces no video', () => {
		createWizard.generateVideo = false;
		createWizard.generateRedesign = false;
		setDuration(9);
		expect(createWizard.minDurationSeconds).toBeNull();
		expect(createWizard.durationsValid).toBe(true);
	});

	it('leaves types without a declared floor unfloored', () => {
		expect(minDurationSecondsFor('promo')).toBeNull();
	});
});
