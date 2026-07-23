export type PhotographyActor = {
  id: string;
  name: string;
  role: string | null;
  branch: string | null;
};

export const photographyStageOrder = [
  "photography_requested",
  "photography_scheduled",
  "photography_in_progress",
  "completed",
] as const;

export const photographyStageLabels: Record<string, string> = {
  photography_requested: "تم استلام طلب التصوير",
  photography_scheduled: "تم جدولة التصوير",
  photography_in_progress: "جاري التصوير",
  completed: "تم التصوير",
};

export function nextPhotographyStage(currentStatus: string) {
  const index = photographyStageOrder.indexOf(currentStatus as typeof photographyStageOrder[number]);
  return index >= 0 ? photographyStageOrder[index + 1] || "" : "";
}

export async function transitionPhotographyRequest(
  tx: any,
  request: Record<string, any>,
  nextStatus: string,
  actor: PhotographyActor,
  note?: string | null,
) {
  const expected = nextPhotographyStage(String(request.status || ""));
  if (!expected || expected !== nextStatus) {
    const error = new Error("يجب تنفيذ مراحل طلب التصوير بالترتيب");
    (error as Error & { status?: number; code?: string }).status = 409;
    (error as Error & { status?: number; code?: string }).code = "INVALID_PHOTOGRAPHY_TRANSITION";
    throw error;
  }
  const [updated] = await tx<any[]>`
    update operations.transfer_requests set status=${nextStatus},
      completed_at=case when ${nextStatus}='completed' then now() else completed_at end,
      updated_at=now(),version=version+1
    where id=${request.id}::uuid returning *,id::text
  `;
  await tx`
    insert into operations.transfer_request_events(
      transfer_request_id,stage,action,note,actor_id,actor_name,actor_role,actor_branch,before_data,after_data
    ) values (
      ${request.id}::uuid,${nextStatus},'stage_completed',${note || null},${actor.id}::uuid,${actor.name},${actor.role},${actor.branch},
      ${tx.json({ status: request.status })},${tx.json({ status: nextStatus })}
    )
  `;
  return updated;
}

export async function cancelPhotographyRequest(
  tx: any,
  request: Record<string, any>,
  actor: PhotographyActor,
  reason: string,
) {
  const [updated] = await tx<any[]>`
    update operations.transfer_requests set cancelled_at=now(),cancelled_by=${actor.id}::uuid,cancellation_reason=${reason},updated_at=now(),version=version+1
    where id=${request.id}::uuid returning *,id::text
  `;
  await tx`
    insert into operations.transfer_request_events(
      transfer_request_id,stage,action,note,actor_id,actor_name,actor_role,actor_branch,before_data,after_data
    ) values (
      ${request.id}::uuid,${request.status},'cancelled',${reason},${actor.id}::uuid,${actor.name},${actor.role},${actor.branch},
      ${tx.json({ status: request.status })},${tx.json({ cancelled: true })}
    )
  `;
  return updated;
}
