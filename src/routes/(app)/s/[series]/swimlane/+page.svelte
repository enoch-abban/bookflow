<script lang="ts">
	import type { PageProps } from './$types';
	import Swimlane from '#lib/components/Swimlane.svelte';

	let { data }: PageProps = $props();
</script>

<Swimlane
	series={data.series}
	stages={data.stages}
	books={data.books}
	tasks={data.tasks}
	assignees={data.assignees}
	deps={data.deps}
	windows={data.windows}
	people={data.people}
	members={data.members}
	today={data.today}
	holidays={data.holidays}
/>
