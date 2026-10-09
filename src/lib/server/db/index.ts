import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle } from 'drizzle-orm/libsql';
import type { BatchItem } from 'drizzle-orm/batch';
import { createClient, type Client, type Transaction } from '@libsql/client';
import * as schema from './schema';
import { DATABASE_URL } from '$app/env/private';
import { dev } from '$app/env';

const url = DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

// ── Round-trip accounting ─────────────────────────────────────────────────────
// Against Turso every execute, batch, transaction statement, commit and rollback is a network
// round trip, so they are what makes a request slow. Each request counts them (see
// hooks.server.ts, which reports them in a Server-Timing header). In development,
// DB_SIMULATED_LATENCY_MS adds a delay per round trip to mimic a remote database.

export type DbStats = { trips: number; ms: number };
export const dbStats = new AsyncLocalStorage<DbStats>();
const simulated = dev ? Number(process.env.DB_SIMULATED_LATENCY_MS ?? 0) : 0;
// DB_TRACE=1 (development) prints each round trip's SQL, to find what a slow request is doing.
const trace = dev && !!process.env.DB_TRACE;
const sqlOf = (arg: unknown): string => {
	if (typeof arg === 'string') return arg;
	if (Array.isArray(arg)) return `batch of ${arg.length}: ${arg.map(sqlOf).join(' | ').slice(0, 160)}`;
	if (arg && typeof arg === 'object' && 'sql' in arg) return String((arg as { sql: unknown }).sql);
	return '';
};

function counted<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
	return async (...args: A) => {
		const stats = dbStats.getStore();
		const start = performance.now();
		if (simulated) await new Promise((r) => setTimeout(r, simulated));
		if (trace && stats) console.info(`  [sql ${stats.trips + 1}] ${sqlOf(args[0]).replace(/\s+/g, ' ').slice(0, 140)}`);
		try {
			return await fn(...args);
		} finally {
			if (stats) {
				stats.trips++;
				stats.ms += performance.now() - start;
			}
		}
	};
}

function countedTx(tx: Transaction): Transaction {
	return new Proxy(tx, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (typeof value !== 'function') return value;
			const bound = value.bind(target);
			return ['execute', 'batch', 'executeMultiple', 'commit', 'rollback'].includes(prop as string) ? counted(bound) : bound;
		},
	});
}

function countedClient(client: Client): Client {
	return new Proxy(client, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (typeof value !== 'function') return value;
			const bound = value.bind(target);
			if (prop === 'transaction') {
				const open = counted(bound as Client['transaction']);
				return async (...args: Parameters<Client['transaction']>) => countedTx(await open(...args));
			}
			return ['execute', 'batch', 'executeMultiple'].includes(prop as string) ? counted(bound) : bound;
		},
	});
}

const client = countedClient(createClient({ url }));

export const db = drizzle(client, { schema });

// ── Writes in one round trip ──────────────────────────────────────────────────
// Drizzle queries do nothing until awaited, so a write-only transaction can be built as a list
// and sent with db.batch: one round trip, applied atomically (all or nothing), instead of a
// round trip per statement plus begin and commit.

export type Write = BatchItem<'sqlite'>;

export async function writeAll(queries: Write[]) {
	if (!queries.length) return [];
	return db.batch(queries as [Write, ...Write[]]);
}
