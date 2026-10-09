import { describe, expect, it } from 'vitest';
import { personChangeRefusal } from './roles.ts';

const admin = { personId: 'a', systemRole: 'admin' as const };
const manager = { personId: 'm', systemRole: 'manager' as const };
const P = (id: string, systemRole: 'admin' | 'manager' | 'member', active = 1) => ({ id, displayName: id.toUpperCase(), systemRole, active });
const status = (r: ReturnType<typeof personChangeRefusal>) => r?.status ?? 'ok';

describe('who may change whose account', () => {
	it('lets only admins grant or remove admin and manager', () => {
		expect(status(personChangeRefusal(admin, P('x', 'member'), { systemRole: 'manager' }, 1))).toBe('ok');
		expect(status(personChangeRefusal(manager, P('x', 'member'), { systemRole: 'manager' }, 1))).toBe(403);
		expect(status(personChangeRefusal(manager, P('x', 'admin'), { systemRole: 'member' }, 1))).toBe(403);
	});

	it('lets managers rename, deactivate or reactivate members only', () => {
		expect(status(personChangeRefusal(manager, P('x', 'member'), { displayName: 'New' }, 1))).toBe('ok');
		expect(status(personChangeRefusal(manager, P('x', 'member', 0), { active: true }, 1))).toBe('ok');
		expect(status(personChangeRefusal(manager, P('y', 'manager'), { active: false }, 1))).toBe(403);
		expect(status(personChangeRefusal(manager, P('a', 'admin'), { displayName: 'New' }, 1))).toBe(403);
		expect(personChangeRefusal(manager, P('m', 'manager'), { displayName: 'Me' }, 1)?.message).toMatch(/account menu/);
	});

	it('stops anyone deactivating themselves or changing their own role, except an admin stepping down', () => {
		expect(status(personChangeRefusal(admin, P('a', 'admin'), { active: false }, 2))).toBe(409);
		expect(status(personChangeRefusal(admin, P('a', 'admin'), { systemRole: 'manager' }, 1))).toBe('ok');
		expect(status(personChangeRefusal(manager, P('m', 'manager'), { systemRole: 'admin' }, 1))).toBe(403);
	});

	it('always keeps one active admin', () => {
		expect(personChangeRefusal(admin, P('a', 'admin'), { systemRole: 'member' }, 0)).toMatchObject({ status: 409, message: expect.stringMatching(/only active admin/) });
		expect(status(personChangeRefusal(admin, P('b', 'admin'), { active: false }, 0))).toBe(409);
		expect(status(personChangeRefusal(admin, P('b', 'admin'), { active: false }, 1))).toBe('ok');
		// A deactivated admin can be demoted without leaving the app adminless.
		expect(status(personChangeRefusal(admin, P('b', 'admin', 0), { systemRole: 'member' }, 0))).toBe('ok');
	});
});
