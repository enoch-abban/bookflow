import type { PageServerLoad } from './$types';
import { resolvePerson } from '#lib/server/api-auth.ts';
import { transferByToken } from '#lib/server/admin-transfer.ts';
import { ROLE_LABEL } from '#lib/roles.ts';

// Accept or decline an admin role transfer (spec: /admin-transfer/[token]); the named
// recipient, signed in. Others see whom the link is for.
export const load: PageServerLoad = async ({ params, locals }) => {
	const me = await resolvePerson(locals);
	const found = await transferByToken(params.token);
	if (!found) return { state: 'invalid' as const };
	const { t, from, to, state } = found;
	return {
		state,
		token: params.token,
		id: t.id,
		from: from?.displayName ?? 'Someone',
		to: to?.displayName ?? 'Someone',
		senderBecomes: ROLE_LABEL[t.senderNewRole],
		expiresAt: t.expiresAt,
		isRecipient: me.personId === t.toPersonId,
		isSender: me.personId === t.fromPersonId,
	};
};
