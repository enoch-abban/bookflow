import type { PageServerLoad } from './$types';
import { requireAdmin } from '#lib/server/api-auth.ts';
import { listTemplates } from '#lib/server/templates.ts';

// New series (spec: /series/new): a simple admin form, from a saved template or blank.
export const load: PageServerLoad = async ({ locals, url, parent }) => {
	await requireAdmin(locals);
	const { seriesList } = await parent();
	const templates = (await listTemplates()).filter((t) => t.usable);
	const asked = url.searchParams.get('template');
	return {
		first: seriesList.length === 0,
		templates: templates.map((t) => ({ id: t.id, name: t.name, description: t.description, definition: t.definition! })),
		selected: templates.find((t) => t.id === asked)?.id ?? templates[0]?.id ?? '',
		today: new Date().toISOString().slice(0, 10),
	};
};
