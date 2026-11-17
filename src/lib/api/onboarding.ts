/**
 * Tenant-not-onboarded: the licences service holds no w2v grant for this
 * workspace (its owning app never onboarded it to w2v). The orchestrator says so
 * two ways — `GET /api/license/status` → `state: 'not_onboarded'`, and a 403
 * `TENANT_NOT_ONBOARDED` on any gated request. Both render this one message:
 * it is not "buy a licence" (no Renew), it is "an administrator must set this
 * workspace up".
 */
export const TENANT_NOT_ONBOARDED = 'TENANT_NOT_ONBOARDED';

export const TENANT_NOT_ONBOARDED_MESSAGE =
	"This workspace isn't set up for Studio yet — contact your administrator.";
