import type { User, Session } from 'better-auth';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	// Injected at build time by vite.config.ts; read through #lib/version.ts.
	const __APP_VERSION__: string;
	const __APP_COMMIT__: string;

	namespace App {
		interface Locals { user?: User; session?: Session }

		// Errors may carry a machine-readable code and details, e.g. strict mode's
		// predecessor_conflict with the tasks it names.
		interface Error { message: string; error?: string; taskIds?: string[]; conflicts?: unknown[] }
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
