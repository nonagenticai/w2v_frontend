import { describe, it, expect } from 'vitest';
import type { YouTubeAuthStatusResponse } from '$lib/types';
import { ApiError } from '$lib/api/client';
import {
	allowedFromPlatformPolicy,
	canPublishToYouTube,
	platformPolicyFromAllowed,
	youtubeActionError,
	youtubeConnectionState,
	youtubeGrantActions,
	youtubeGrantWritability,
	youtubeMode,
	youtubeStatusLine
} from './youtube-status';

const base = { tenant_id: 't-1' };

describe('youtube status (new backend: status + can_publish)', () => {
	it('connected — own grant: state connected, can publish', () => {
		const s: YouTubeAuthStatusResponse = {
			...base,
			connected: true,
			status: 'connected',
			can_publish: true
		};
		expect(youtubeConnectionState(s)).toBe('connected');
		expect(canPublishToYouTube(s)).toBe(true);
	});

	it('platform_default — connected=false but can_publish=true publishes', () => {
		const s: YouTubeAuthStatusResponse = {
			...base,
			connected: false,
			status: 'platform_default',
			can_publish: true
		};
		expect(youtubeConnectionState(s)).toBe('platform_default');
		expect(canPublishToYouTube(s)).toBe(true);
	});

	it('reconnect_required — cannot publish', () => {
		const s: YouTubeAuthStatusResponse = {
			...base,
			connected: false,
			status: 'reconnect_required',
			can_publish: false,
			reconnect_reason: 'invalid_grant'
		};
		expect(youtubeConnectionState(s)).toBe('reconnect_required');
		expect(canPublishToYouTube(s)).toBe(false);
	});

	it('not_connected — cannot publish', () => {
		const s: YouTubeAuthStatusResponse = {
			...base,
			connected: false,
			status: 'not_connected',
			can_publish: false
		};
		expect(youtubeConnectionState(s)).toBe('not_connected');
		expect(canPublishToYouTube(s)).toBe(false);
	});

	it('can_publish wins over connected (never gates on connected when present)', () => {
		// Defensive: a contradictory payload must follow can_publish.
		const s: YouTubeAuthStatusResponse = {
			...base,
			connected: true,
			status: 'connected',
			can_publish: false
		};
		expect(canPublishToYouTube(s)).toBe(false);
	});
});

describe('youtube status (old backend: no status / can_publish)', () => {
	it('connected=true falls back to connected + can publish', () => {
		const s: YouTubeAuthStatusResponse = { ...base, connected: true };
		expect(youtubeConnectionState(s)).toBe('connected');
		expect(canPublishToYouTube(s)).toBe(true);
	});

	it('connected=false falls back to not_connected + cannot publish', () => {
		const s: YouTubeAuthStatusResponse = { ...base, connected: false };
		expect(youtubeConnectionState(s)).toBe('not_connected');
		expect(canPublishToYouTube(s)).toBe(false);
	});
});

describe('youtubeActionError', () => {
	it('403 names the tenant_admin requirement', () => {
		const msg = youtubeActionError(new ApiError(403, 'Forbidden', 'tenant_admin required'), 'x');
		expect(msg).toBe(
			'Only a workspace admin can connect or disconnect YouTube. (tenant_admin required)'
		);
	});

	it('other ApiError surfaces the backend detail', () => {
		expect(youtubeActionError(new ApiError(503, 'Unavailable', 'Redis unavailable'), 'x')).toBe(
			'Redis unavailable'
		);
	});

	it('ApiError with empty detail uses the fallback', () => {
		expect(youtubeActionError(new ApiError(500, 'Err', ''), 'Connection failed')).toBe(
			'Connection failed'
		);
	});

	it('plain Error uses its message; non-Error uses the fallback', () => {
		expect(youtubeActionError(new Error('boom'), 'x')).toBe('boom');
		expect(youtubeActionError('nope', 'Disconnect failed')).toBe('Disconnect failed');
	});
});

describe('per-tenant config backend: mode + needs_reconnect', () => {
	const m = (over: Partial<YouTubeAuthStatusResponse>): YouTubeAuthStatusResponse => ({
		...base,
		connected: false,
		...over
	});

	it('mode is authoritative over a stale status', () => {
		const s = m({ mode: 'none', status: 'platform_default' });
		expect(youtubeConnectionState(s)).toBe('not_connected');
		expect(youtubeMode(s)).toBe('none');
	});

	it.each([
		['tenant', 'connected'],
		['platform', 'platform_default'],
		['none', 'not_connected']
	] as const)('mode %s → state %s', (mode, state) => {
		expect(youtubeConnectionState(m({ mode }))).toBe(state);
		expect(youtubeMode(m({ mode }))).toBe(mode);
	});

	it('needs_reconnect → reconnect_required, mode stays tenant', () => {
		const s = m({ mode: 'tenant', needs_reconnect: true });
		expect(youtubeConnectionState(s)).toBe('reconnect_required');
		expect(youtubeMode(s)).toBe('tenant');
	});

	it('no mode: derived from the older status', () => {
		expect(youtubeMode(m({ status: 'reconnect_required' }))).toBe('tenant');
		expect(youtubeMode(m({ status: 'platform_default' }))).toBe('platform');
		expect(youtubeMode(m({}))).toBe('none');
	});
});

describe('youtubeStatusLine', () => {
	const m = (over: Partial<YouTubeAuthStatusResponse>): YouTubeAuthStatusResponse => ({
		...base,
		connected: false,
		...over
	});

	it('tenant', () => {
		expect(youtubeStatusLine(m({ mode: 'tenant', channel_title: 'merqi' }))).toBe(
			'Connected: merqi'
		);
		expect(youtubeStatusLine(m({ mode: 'tenant' }))).toBe('Connected to your own channel');
	});

	it('platform names the platform channel', () => {
		expect(youtubeStatusLine(m({ mode: 'platform', channel_title: 'George Dekker' }))).toBe(
			'No channel connected — videos publish to the platform channel George Dekker'
		);
	});

	it('none says publishing will fail', () => {
		expect(youtubeStatusLine(m({ mode: 'none' }))).toBe('Not connected — publishing will fail');
	});

	it('needs_reconnect says publishing fails until reconnect', () => {
		expect(youtubeStatusLine(m({ mode: 'tenant', needs_reconnect: true }))).toMatch(
			/^Reconnect required.*Publishing fails until you reconnect\.$/
		);
	});
});

describe('youtubeGrantActions — one derivation for every button', () => {
	const admin = { canManage: true, statusFailed: false };

	it('a member gets nothing, whatever the state', () => {
		for (const st of [
			'connected',
			'reconnect_required',
			'platform_default',
			'not_connected'
		] as const) {
			expect(youtubeGrantActions(st, { canManage: false, statusFailed: false })).toEqual({
				connect: false,
				reconnect: false,
				disconnect: false
			});
		}
		expect(youtubeGrantActions(null, { canManage: false, statusFailed: true }).connect).toBe(false);
	});

	it('admin: connected → Disconnect only', () => {
		expect(youtubeGrantActions('connected', admin)).toEqual({
			connect: false,
			reconnect: false,
			disconnect: true
		});
	});

	it('admin: reconnect_required → Reconnect + Disconnect', () => {
		expect(youtubeGrantActions('reconnect_required', admin)).toEqual({
			connect: false,
			reconnect: true,
			disconnect: true
		});
	});

	it.each(['platform_default', 'not_connected'] as const)('admin: %s → Connect only', (st) => {
		expect(youtubeGrantActions(st, admin)).toEqual({
			connect: true,
			reconnect: false,
			disconnect: false
		});
	});

	it('admin: unknown state → Connect only after a failed read', () => {
		expect(youtubeGrantActions(null, admin).connect).toBe(false);
		expect(youtubeGrantActions(null, { canManage: true, statusFailed: true }).connect).toBe(true);
	});
});

describe('youtubeGrantActions — slot writability gate', () => {
	const notWritable = { canManage: true, statusFailed: false, slotWritable: false };

	it.each(['platform_default', 'not_connected'] as const)(
		'admin, slot not writable: %s → no Connect',
		(st) => {
			expect(youtubeGrantActions(st, notWritable)).toEqual({
				connect: false,
				reconnect: false,
				disconnect: false
			});
		}
	);

	it('admin, slot not writable: no Reconnect, but Disconnect stays (revoking is safe)', () => {
		expect(youtubeGrantActions('reconnect_required', notWritable)).toEqual({
			connect: false,
			reconnect: false,
			disconnect: true
		});
		expect(youtubeGrantActions(null, { ...notWritable, statusFailed: true }).connect).toBe(false);
	});
});

describe('youtubeGrantWritability — what the API says about publish.youtube', () => {
	it('a grant slot is writable even though SlotView.writable is false for every grant', () => {
		expect(
			youtubeGrantWritability({
				view: { type: 'grant', writable: false },
				requirement: { type: 'grant' }
			})
		).toEqual({ writable: true, reason: null });
		expect(youtubeGrantWritability({ requirement: { type: 'grant' } }).writable).toBe(true);
		expect(youtubeGrantWritability({ view: { type: 'grant', writable: false } }).writable).toBe(
			true
		);
	});

	it('a non-writable connection slot is platform provided — not writable, with a reason', () => {
		const r = youtubeGrantWritability({ view: { type: 'connection', writable: false } });
		expect(r.writable).toBe(false);
		expect(r.reason).toMatch(/platform provided/);
	});

	it('listed by neither API → not offered on this deployment', () => {
		const r = youtubeGrantWritability({ view: null, requirement: null });
		expect(r.writable).toBe(false);
		expect(r.reason).toMatch(/not offered/);
	});
});

describe('platform channel policy tri-state', () => {
	it('round-trips null / true / false', () => {
		for (const v of [null, true, false]) {
			expect(allowedFromPlatformPolicy(platformPolicyFromAllowed(v))).toBe(v);
		}
	});

	it('undefined reads as default (callers that care must check undefined first)', () => {
		expect(platformPolicyFromAllowed(undefined)).toBe('default');
	});
});

describe('youtubeActionError — custom 403 copy', () => {
	it('uses the supplied forbidden message', () => {
		expect(youtubeActionError(new ApiError(403, 'Forbidden', ''), 'x', 'Nope.')).toBe('Nope.');
	});
});
