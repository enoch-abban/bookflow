export type ApiResult<T = unknown> = { ok: true; data: T } | { ok: false; status: number; message: string };

/** JSON fetch against our API; error responses are turned into a readable message. */
export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<ApiResult<T>> {
	const res = await fetch(url, {
		method,
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const data = await res.json().catch(() => null);
	if (!res.ok) return { ok: false, status: res.status, message: data?.message ?? `Something went wrong (${res.status}).` };
	return { ok: true, data: data as T };
}
