// Reassigning by dragging a bar between person lanes (spec: Swimlane editor, Reassign).
// The person whose lane the bar left is swapped for the person whose lane it lands in,
// keeping lead status; out of the Unassigned lane assigns the task; into it unassigns it.

export const UNASSIGNED = '__unassigned';
export type Assignment = { personIds: string[]; leadId: string | null };

/** The assignment after dropping a bar from lane `from` into lane `to`, or null for no change. */
export function reassignDrop(current: Assignment, from: string, to: string): Assignment | null {
	if (from === to) return null;
	if (to === UNASSIGNED) return current.personIds.length ? { personIds: [], leadId: null } : null;
	if (from === UNASSIGNED) return { personIds: [to], leadId: to };
	if (!current.personIds.includes(from)) return null;
	const lead = current.leadId === from ? to : current.leadId;
	// Already assigned to the target person: the one dragged away simply leaves.
	if (current.personIds.includes(to)) return { personIds: current.personIds.filter((p) => p !== from), leadId: lead };
	return { personIds: current.personIds.map((p) => (p === from ? to : p)), leadId: lead };
}
