/** The CRM postponement rule is shared by the customer editor and leads API. */
export const POSTPONED_FOLLOW_UP_REQUIRED = "اختر تاريخ المتابعة قبل حفظ العميل بحالة مؤجل";
export const POSTPONED_FOLLOW_UP_INVALID = "تاريخ المتابعة غير صحيح، اختر تاريخًا صحيحًا";

export function isPostponedStatus(status: unknown): boolean {
  return String(status ?? "").trim() === "مؤجل";
}

export function postponedFollowUpError(
  status: unknown,
  followUpAt: unknown,
  change?: { previousStatus: unknown; followUpDateProvided: boolean },
): string {
  if (!isPostponedStatus(status)) return "";
  if (change && !isPostponedStatus(change.previousStatus) && !change.followUpDateProvided) {
    return POSTPONED_FOLLOW_UP_REQUIRED;
  }
  const input = String(followUpAt ?? "").trim();
  if (!input) return POSTPONED_FOLLOW_UP_REQUIRED;

  // The form submits YYYY-MM-DD; existing PostgreSQL timestamps are also valid.
  const calendar = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(input);
  if (calendar) {
    const year = Number(calendar[1]);
    const month = Number(calendar[2]);
    const day = Number(calendar[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      return POSTPONED_FOLLOW_UP_INVALID;
    }
  }
  if (Number.isNaN(new Date(input).getTime()) || (!calendar && !/^\w{3} \w{3} \d{1,2} \d{4} /.test(input))) {
    return POSTPONED_FOLLOW_UP_INVALID;
  }
  return "";
}
