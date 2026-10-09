// Which task the drawer shows (spec: Task drawer). One drawer lives in the app layout;
// any page opens it with openTask, from a matrix cell, swimlane bar, My tasks row or book page.

export const taskDrawer = $state<{ taskId: string | null }>({ taskId: null });

export function openTask(taskId: string) {
	taskDrawer.taskId = taskId;
}

export function closeTask() {
	taskDrawer.taskId = null;
}
