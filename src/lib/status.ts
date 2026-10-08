// Task statuses in words, shared by every page that shows one.

export const STATUS_LABEL: Record<string, string> = {
	not_started: 'Not started',
	in_progress: 'In progress',
	in_review:   'In review',
	returned:    'Returned',
	done:        'Done',
	blocked:     'Blocked',
};

/** The label for a status, or the raw code if it is one we don't know. */
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;
