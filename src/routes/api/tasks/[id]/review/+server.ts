import type { RequestHandler } from './$types';
import { parseBody } from '#lib/server/api-auth.ts';
import { parseOr400, reviewSchema } from '#lib/server/validation.ts';
import { recordReview } from '#lib/server/reviews.ts';

// POST /api/tasks/:id/review — Approve (Done) or Return with changes (Returned, next round)
// a task in review. Reviewers on the book's next review stage, or a coordinator.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const body = parseOr400(reviewSchema, await parseBody(request));
	return recordReview({ locals, taskId: params.id, ...body });
};
