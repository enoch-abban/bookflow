import type { RequestHandler } from './$types';
import { parseBody } from '#lib/server/api-auth.ts';
import { parseOr400, printRecordSchema } from '#lib/server/validation.ts';
import { updateRecord } from '#lib/server/print-records.ts';

// PATCH /api/books/:id/print-record — production progress (printing, binding and deposit
// assignees, coordinators); copies planned and deposit copies are coordinator-only.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const { version, ...edit } = parseOr400(printRecordSchema, await parseBody(request));
	return updateRecord({ locals, bookId: params.id, edit, version });
};
