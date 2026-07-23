import assert from "node:assert/strict";

function buildTasks(instances) {
  const tasks = [];
  const unique = new Set();
  for (const instance of instances) {
    const templates = new Map();
    for (const writer of instance.writers) {
      const key = `${instance.id}:template:${writer}`;
      assert(!unique.has(key), `duplicate template ${key}`);
      unique.add(key);
      const id = `TPL-${key}`;
      templates.set(writer, id);
      tasks.push({ id, kind: "template", instanceId: instance.id, writer, status: "required" });
    }
    for (const assignment of instance.assignments) {
      for (const writer of assignment.writers) {
        assert(templates.has(writer), "execution writer must belong to the same instance");
        const key = `${instance.id}:execution:${assignment.department}:${assignment.user}:${writer}`;
        assert(!unique.has(key), `duplicate execution ${key}`);
        unique.add(key);
        tasks.push({ id: `EXE-${key}`, kind: "execution", instanceId: instance.id, writer, user: assignment.user, department: assignment.department, templateTaskId: templates.get(writer), status: "waiting_template" });
      }
    }
  }
  return tasks;
}

function approveTemplate(tasks, templateId) {
  return tasks.map((task) => task.id === templateId ? { ...task, status: "completed", approved: true } : task.templateTaskId === templateId ? { ...task, status: "required" } : task);
}

function receive(task, now) {
  if (task.receivedAt) return task;
  if (task.kind === "execution" && task.status === "waiting_template") throw new Error("template not approved");
  return { ...task, receivedAt: now, status: "active" };
}

function weightedProgress(actions) {
  const total = actions.filter((row) => row.required).reduce((sum, row) => sum + row.percentage, 0);
  const complete = actions.filter((row) => row.required && row.completed).reduce((sum, row) => sum + row.percentage, 0);
  return total ? Math.min(100, complete * 100 / total) : 0;
}

function projectProgress(tasks) {
  const byDepartment = new Map();
  for (const task of tasks.filter((row) => row.kind === "execution")) {
    const values = byDepartment.get(task.department) || [];
    values.push(task.progress || 0);
    byDepartment.set(task.department, values);
  }
  const departments = [...byDepartment.values()].map((values) => values.reduce((sum, value) => sum + value, 0) / values.length);
  return departments.length ? departments.reduce((sum, value) => sum + value, 0) / departments.length : 0;
}

const instances = [
  { id: "N01", writers: ["writer-a", "writer-b"], assignments: [
    { department: "design", user: "ahmed", writers: ["writer-a", "writer-b"] },
    { department: "design", user: "belal", writers: ["writer-a"] },
    { department: "photo", user: "mahmoud", writers: ["writer-b"] },
  ] },
  { id: "N02", writers: ["writer-a"], assignments: [{ department: "design", user: "ahmed", writers: ["writer-a"] }] },
];

const tasks = buildTasks(instances);
assert.equal(tasks.filter((row) => row.kind === "template").length, 3, "one template per writer per instance");
assert.equal(tasks.filter((row) => row.kind === "execution").length, 5, "one execution task per exact relation");
assert.equal(new Set(tasks.map((row) => row.id)).size, tasks.length, "all task identities are unique");

const n01WriterA = tasks.find((row) => row.kind === "template" && row.instanceId === "N01" && row.writer === "writer-a");
assert(n01WriterA);
const approved = approveTemplate(tasks, n01WriterA.id);
assert.equal(approved.filter((row) => row.templateTaskId === n01WriterA.id && row.status === "required").length, 2, "approval opens only related execution tasks");
assert.equal(approved.filter((row) => row.kind === "execution" && row.writer === "writer-b" && row.status === "waiting_template").length, 2, "unrelated writer tasks remain locked");

const locked = tasks.find((row) => row.kind === "execution");
assert.throws(() => receive(locked, "2026-07-23T15:00:00Z"), /template not approved/, "execution cannot be received before template approval");
const open = approved.find((row) => row.kind === "execution" && row.status === "required");
assert(open);
const received = receive(open, "2026-07-23T15:00:00Z");
assert.equal(receive(received, "2026-07-24T15:00:00Z").receivedAt, "2026-07-23T15:00:00Z", "actual receive timestamp is immutable");

assert.equal(weightedProgress([{ percentage: 20, required: true, completed: true }, { percentage: 30, required: true, completed: false }, { percentage: 50, required: true, completed: true }]), 70, "task progress follows configured percentages");
assert.equal(weightedProgress([{ percentage: 10, required: true, completed: true }, { percentage: 10, required: true, completed: true }]), 100, "percentages are normalized when their sum is not 100");
assert.equal(projectProgress([{ kind: "execution", department: "design", progress: 100 }, { kind: "execution", department: "design", progress: 0 }, { kind: "execution", department: "photo", progress: 100 }]), 75, "departments have equal weight in project progress");
assert.equal(projectProgress([{ kind: "execution", department: "design", progress: 100 }, { kind: "execution", department: "photo", progress: 100 }]) >= 99.99, true, "publishing gate opens only at full department readiness");
assert.equal(projectProgress([{ kind: "execution", department: "design", progress: 100 }, { kind: "execution", department: "photo", progress: 99 }]) >= 99.99, false, "publishing gate remains closed below 100 percent");

const idempotency = new Map();
const createOnce = (key, value) => idempotency.has(key) ? idempotency.get(key) : (idempotency.set(key, value), value);
assert.equal(createOnce("same-browser-request", "campaign-1"), "campaign-1");
assert.equal(createOnce("same-browser-request", "campaign-2"), "campaign-1", "repeat submission returns the original project identity");

const inRange = (date, start, end) => date >= start && date <= end;
assert.equal(inRange("2026-07-23", "2026-07-20", "2026-07-25"), true);
assert.equal(inRange("2026-07-26", "2026-07-20", "2026-07-25"), false, "publish date outside project range is rejected");

console.log("Marketing domain scenario tests passed: 15");
