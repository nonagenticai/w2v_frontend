// Human label for a tenant. The tenant registry name is optional (null until a
// super_admin names it), and a bare UUID in the picker or the "Acting as" badge
// reads as a bug, not a workspace. Fall back to an explicit "Unnamed workspace"
// label carrying a short id so two unnamed tenants stay distinguishable.

import { shortId } from './format';

export interface TenantLike {
	tenant_id: string;
	name?: string | null;
}

export function tenantLabel(tenant: TenantLike): string {
	const name = tenant.name?.trim();
	if (name) return name;
	return `Unnamed workspace · ${shortId(tenant.tenant_id)}`;
}
