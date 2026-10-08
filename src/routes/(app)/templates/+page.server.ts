import type { PageServerLoad } from './$types';
import { requireAdmin } from '#lib/server/api-auth.ts';
import { listTemplates } from '#lib/server/templates.ts';

// Templates (spec: /templates): saved pipelines new series can start from. Admin only.
export const load: PageServerLoad = async ({ locals, parent }) => {
	await requireAdmin(locals);
	const { seriesList, seriesId } = await parent();
	return { templates: await listTemplates(), seriesList, seriesId };
};
