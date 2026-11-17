/**
 * Provider requirements manifest (P8) — `GET /api/provider-requirements`.
 *
 * The server's description of every slot a tenant can act on: the kinds each
 * accepts (deployment policy applied), each kind's form fields with the
 * server's own `required` rule, the secret's label, the base-URL rule, and the
 * platform dependencies a tenant can NOT configure (webscraper, media_discovery). The Providers page
 * renders its forms from this — the frontend holds no per-kind field table.
 *
 * Tenant-agnostic and static per deployment. Every type aliases the generated
 * schema (type-drift-check).
 */

import { api } from './client.js';
import type { components } from './types.gen.js';

type Schemas = components['schemas'];

export type ProviderRequirements = Schemas['ProviderRequirements'];
export type SlotRequirement = Schemas['SlotRequirement'];
export type KindRequirement = Schemas['KindRequirement'];
export type KindField = Schemas['KindField'];
export type PlatformDependency = Schemas['PlatformDependency'];

export const providerRequirements = {
	get(): Promise<ProviderRequirements> {
		return api.get<ProviderRequirements>('/provider-requirements');
	}
};
