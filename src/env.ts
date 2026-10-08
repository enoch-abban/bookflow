import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	DATABASE_URL: { description: 'The database connection string.' },
	DATABASE_AUTH_TOKEN: {
		description: 'Auth token for a remote libSQL (Turso) database. Leave empty for a local `file:` database.',
		schema: (value) => value || undefined
	},
	ORIGIN: {
		description: 'The app origin (base URL), e.g. `http://localhost:5173`.'
	},
	BETTER_AUTH_SECRET: {
		description: 'Secret used to sign tokens. For production use 32 characters generated with high entropy. See [Better Auth installation](https://www.better-auth.com/docs/installation).'
	},
	RESEND_API_KEY: {
		description: 'API key for Resend transactional email. When unset, emails are printed to the server console instead.',
		schema: (value) => value || undefined
	},
	EMAIL_FROM: {
		description: 'Sender for transactional email; the domain must be verified in Resend.',
		schema: (value) => value || 'bookflow <noreply@bookflow.app>'
	},
});
