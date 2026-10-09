// App-wide roles (spec: Users, roles and permissions), shared by the People page and the server.

export type SystemRole = 'admin' | 'manager' | 'member';

export const ROLE_LABEL: Record<SystemRole, string> = { admin: 'Admin', manager: 'Manager', member: 'Member' };

export const ROLE_SUMMARY: Record<SystemRole, string> = {
	admin: 'Everything across all series, including system roles, deactivating anyone and holidays.',
	manager: 'Everything an admin can do, and coordinator on every series, except system roles, holidays, and other admins’ and managers’ accounts.',
	member: 'Only the series roles they hold: coordinator, contributor or viewer on each series.',
};

export type PersonChange = { displayName?: string; active?: boolean; systemRole?: SystemRole };

/**
 * Who may change whose account (spec: Users, roles and permissions):
 * - only admins grant or remove the admin and manager roles;
 * - managers rename, deactivate or reactivate only people whose role is Member;
 * - nobody deactivates themselves or changes their own role, except that an admin can step
 *   down once another active admin exists;
 * - the app always keeps at least one active admin.
 */
/** Why this change is refused, as an HTTP status and message, or null. Pure, for tests. */
export function personChangeRefusal(
	actor: { personId: string; systemRole: SystemRole },
	target: { id: string; displayName: string; systemRole: SystemRole; active: number },
	change: PersonChange,
	otherActiveAdmins: number,
): { status: 403 | 409; message: string } | null {
	const self = actor.personId === target.id;
	const roleChange = change.systemRole !== undefined && change.systemRole !== target.systemRole;

	if (roleChange) {
		if (actor.systemRole !== 'admin') return { status: 403, message: 'Only an admin can grant or remove the admin and manager roles.' };
		if (self && !(target.systemRole === 'admin' && change.systemRole !== 'admin')) return { status: 403, message: 'You cannot change your own role.' };
	}
	// Managers look after members only; admins after anyone.
	if (actor.systemRole !== 'admin' && target.systemRole !== 'member' && (change.displayName !== undefined || change.active !== undefined))
		return { status: 403, message: self ? 'Change your own name from the account menu.' : 'Only an admin can change an admin’s or manager’s account.' };
	if (change.active === false && self) return { status: 409, message: 'You cannot deactivate yourself.' };

	// Never leave the app without an active admin.
	const losesAdmin = target.systemRole === 'admin' && !!target.active && ((roleChange && change.systemRole !== 'admin') || change.active === false);
	if (losesAdmin && otherActiveAdmins === 0)
		return { status: 409, message: self ? 'You are the only active admin. Make someone else an admin before stepping down.' : `${target.displayName} is the only active admin, so they must stay one.` };
	return null;
}

