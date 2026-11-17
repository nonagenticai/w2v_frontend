import { describe, expect, it } from 'vitest';
import { PROJECT_STATUS_LABELS, projectStatusLabel, projectStatusTone } from './project-status';

describe('project status presentation', () => {
	it('labels every status in words, not enum strings', () => {
		expect(projectStatusLabel('producing')).toBe('In production');
		expect(projectStatusLabel('drafting')).toBe('Draft');
		for (const label of Object.values(PROJECT_STATUS_LABELS)) expect(label).not.toMatch(/_/);
	});

	it('shows an unknown status verbatim rather than dropping it', () => {
		expect(projectStatusLabel('mystery')).toBe('mystery');
	});

	it('colours failure as danger and completion as success', () => {
		expect(projectStatusTone('failed')).toBe('danger');
		expect(projectStatusTone('completed')).toBe('success');
		expect(projectStatusTone('drafting')).toBe('neutral');
	});

	it('says Needs review for a producing project whose last run is paused', () => {
		expect(projectStatusLabel('producing', 'paused', 'checkpoint')).toBe('Needs review');
		expect(projectStatusTone('producing', 'paused', 'checkpoint')).toBe('warning');
	});

	// A run someone PAUSED (POST /runs/{id}/pause) has nothing to review.
	it('says Paused, never Needs review, when the last run was paused by a person', () => {
		expect(projectStatusLabel('producing', 'paused', 'manual')).toBe('Paused');
		expect(projectStatusTone('producing', 'paused', 'manual')).toBe('warning');
		// Unclassified (pre-0102) or no reason: neutral "Paused", never a guess.
		expect(projectStatusLabel('producing', 'paused', 'unknown')).toBe('Paused');
		expect(projectStatusLabel('producing', 'paused')).toBe('Paused');
	});

	it('keeps In production while the last run is actually running', () => {
		expect(projectStatusLabel('producing', 'running')).toBe('In production');
		expect(projectStatusLabel('producing', null)).toBe('In production');
		expect(projectStatusTone('producing', 'running')).toBe('accent');
	});
});
