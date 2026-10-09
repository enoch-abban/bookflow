/**
 * A task's assignees as one value: the people, in order, and who leads. Used by the assignees
 * endpoint, and by undo and redo, which put a task's assignees back as they were.
 */
import { eq } from 'drizzle-orm';
import { db, type Write } from '#lib/server/db/index.ts';
import { taskAssignees } from '#lib/server/db/schema.ts';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Assignment = { personIds: string[]; leadId: string | null };

export async function currentAssignment(tx: Tx | typeof db, taskId: string): Promise<Assignment> {
	const rows = await tx.select().from(taskAssignees).where(eq(taskAssignees.taskId, taskId));
	const lead = rows.find((a) => a.isLead)?.personId ?? rows[0]?.personId ?? null;
	// Lead first, so "the first person is lead" holds when the list is read back.
	const personIds = [...rows.filter((a) => a.personId === lead), ...rows.filter((a) => a.personId !== lead)].map((a) => a.personId);
	return { personIds, leadId: lead };
}

/** The normalised assignment (no repeats; the lead among them, else the first) and the queries that write it. */
export function assignmentQueries(taskId: string, a: Assignment) {
	const personIds = [...new Set(a.personIds)];
	const leadId = personIds.length ? (a.leadId && personIds.includes(a.leadId) ? a.leadId : personIds[0]) : null;
	const queries: Write[] = [db.delete(taskAssignees).where(eq(taskAssignees.taskId, taskId))];
	if (personIds.length)
		queries.push(db.insert(taskAssignees).values(personIds.map((personId) => ({ taskId, personId, isLead: personId === leadId ? 1 : 0 }))));
	return { assignment: { personIds, leadId }, queries };
}

/** Replace the assignees; the lead defaults to the first person, and an empty list unassigns. */
export async function setAssignment(tx: Tx, taskId: string, a: Assignment) {
	const personIds = [...new Set(a.personIds)];
	const leadId = personIds.length ? (a.leadId && personIds.includes(a.leadId) ? a.leadId : personIds[0]) : null;
	await tx.delete(taskAssignees).where(eq(taskAssignees.taskId, taskId));
	if (personIds.length)
		await tx.insert(taskAssignees).values(personIds.map((personId) => ({ taskId, personId, isLead: personId === leadId ? 1 : 0 })));
	return { personIds, leadId };
}

export const sameAssignment = (a: Assignment, b: Assignment) =>
	a.leadId === b.leadId && a.personIds.length === b.personIds.length && a.personIds.every((p) => b.personIds.includes(p));
