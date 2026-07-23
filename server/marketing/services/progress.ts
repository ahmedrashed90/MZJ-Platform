export type TaskProgressInput = {
  task_type?: string | null;
  status?: string | null;
  requires_final_file?: boolean | null;
  active_final_files?: number | string | null;
  action_weight_done?: number | string | null;
  action_weight_total?: number | string | null;
};

const CONTENT_COMPLETE = new Set(["template_approved", "content_done", "completed"]);
const EXECUTION_COMPLETE = new Set(["completed"]);

export function calculateTaskProgress(task: TaskProgressInput) {
  const type = String(task.task_type || "execution");
  if (type === "content_template") {
    if (CONTENT_COMPLETE.has(String(task.status || ""))) return 100;
    if (task.status === "template_submitted") return 70;
    if (task.status === "changes_requested") return 45;
    return 0;
  }
  if (EXECUTION_COMPLETE.has(String(task.status || ""))) {
    if (task.requires_final_file && Number(task.active_final_files || 0) < 1) return 95;
    return 100;
  }
  const total = Number(task.action_weight_total || 0);
  const done = Number(task.action_weight_done || 0);
  const weighted = total > 0 ? Math.round((done / total) * 95) : 0;
  const stateFloor: Record<string, number> = {
    blocked_by_template: 0,
    ready: 5,
    received: 10,
    in_progress: 20,
    changes_requested: 40,
    under_review: 90,
  };
  return Math.max(weighted, stateFloor[String(task.status || "")] || 0);
}

export function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}
