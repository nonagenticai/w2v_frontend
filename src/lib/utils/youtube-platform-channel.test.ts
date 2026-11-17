import { describe, it, expect } from 'vitest';
import { buildPlatformChannelPut, type PlatformChannelForm } from './youtube-platform-channel';

const form = (over: Partial<PlatformChannelForm> = {}): PlatformChannelForm => ({
	clientId: ' cid ',
	channelId: 'UC123',
	channelTitle: 'Platform',
	defaultForTenants: true,
	clientSecret: '',
	refreshToken: '',
	...over
});

describe('buildPlatformChannelPut', () => {
	it('existing row: blank secrets are OMITTED (keep), never sent empty', () => {
		const d = buildPlatformChannelPut(form(), { exists: true });
		expect(d).toEqual({
			ok: true,
			body: {
				client_id: 'cid',
				channel_id: 'UC123',
				channel_title: 'Platform',
				default_for_tenants: true
			}
		});
		if (d.ok) {
			expect('client_secret' in d.body).toBe(false);
			expect('refresh_token' in d.body).toBe(false);
		}
	});

	it('existing row: a filled secret replaces only that secret', () => {
		const d = buildPlatformChannelPut(form({ refreshToken: ' rt ' }), { exists: true });
		expect(d.ok && d.body.refresh_token).toBe('rt');
		expect(d.ok && 'client_secret' in d.body).toBe(false);
	});

	it('new row: both secrets are required', () => {
		expect(buildPlatformChannelPut(form({ clientSecret: 's' }), { exists: false }).ok).toBe(false);
		const d = buildPlatformChannelPut(form({ clientSecret: 's', refreshToken: 'r' }), {
			exists: false
		});
		expect(d.ok && d.body).toMatchObject({ client_secret: 's', refresh_token: 'r' });
	});

	it.each(['clientId', 'channelId', 'channelTitle'] as const)('blank %s is refused', (k) => {
		const d = buildPlatformChannelPut(form({ [k]: '   ' }), { exists: true });
		expect(d.ok).toBe(false);
	});

	it('default_for_tenants false is sent as false, not dropped', () => {
		const d = buildPlatformChannelPut(form({ defaultForTenants: false }), { exists: true });
		expect(d.ok && d.body.default_for_tenants).toBe(false);
	});
});
