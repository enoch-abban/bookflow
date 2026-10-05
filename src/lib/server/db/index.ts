import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';
import { DATABASE_URL } from '$app/env/private';

const url = DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const client = createClient({ url });

export const db = drizzle(client, { schema });
