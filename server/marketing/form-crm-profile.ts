/** Marketing form profile enrichment; deliberately independent of CRM routing.
 * The original answers, including numeric ranges, remain stored in the form. */
import { getSql } from '../_db.js';
import { formCrmAnswers, financeProfileValue, financeProfileRangeKey, FINANCE_PROFILE_FIELDS, type FormCrmAnswer, type ProfileField } from '../../shared/lead-form-crm-fields.js';

type FormProfileInput = {
  id: string;
  created_at: string | Date;
  answers: Record<string,string>;
  answer_labels: Record<string,string>;
  answer_crm_fields?: Record<string,unknown>;
};
type ProfileRecord = Partial<Record<ProfileField, unknown>> & { car_name?: unknown; notes?: string | null; extra_data?: Record<string, unknown> | null };
const isBlank = (value: unknown) => value === null || value === undefined || String(value).trim() === '';
function sameValue(current: unknown, value: string | number): boolean {
  if (isBlank(current)) return false;
  return typeof value === 'number' ? Number(current) === value : String(current).trim() === value;
}

/** Plan from the actual locked customer row. For repeat customers we only add
 * the submitted answers to notes; a first submission may fill blank fields.
 * Conflicting/ambiguous answers always remain visible in notes, never guessed. */
export function planFormProfile(answers: FormCrmAnswer[], current: ProfileRecord, allowFields: boolean) {
  const fields: Partial<Record<ProfileField, string | number>> = {};
  const notes: FormCrmAnswer[] = [];
  for (const answer of answers) {
    const {field, profileValue} = answer;
    if (!allowFields || field === 'notes' || profileValue === null) { notes.push(answer); continue; }
    const stored = fields[field] ?? (field === 'salary' || field === 'obligation'
      ? financeProfileValue(current[field], current.extra_data, field) : current[field]);
    // Do not place a conflicting car type alongside an existing car name.
    if (field === 'car_type' && !isBlank(current.car_name) && !sameValue(current.car_name,profileValue) && isBlank(stored)) { notes.push(answer); continue; }
    if (isBlank(stored)) fields[field] = profileValue;
    else if (!sameValue(stored,profileValue)) notes.push(answer);
  }
  return {fields, notes};
}

export function formProfileNote(answers: FormCrmAnswer[], createdAt: string | Date): string {
  if (!answers.length) return '';
  const date = new Date(createdAt);
  const timestamp = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-GB', {
    timeZone:'Asia/Riyadh', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false,
  }).format(date).replace(',', '') : '';
  return `${timestamp ? `[${timestamp}] ` : ''}إجابات فورم المنصات\n${answers.map(a=>`${a.label}: ${a.value}`).join('\n')}`;
}

/** Only remove exact generated lines from the uniquely matching original form
 * note. Never rewrite free-form representative notes or a conflicting choice. */
export function moveLegacyFinanceNotes(existing: string | null | undefined, answers: FormCrmAnswer[], createdAt: string | Date): string {
  const original = existing || '';
  if (!answers.length || !original) return original;
  const header = formProfileNote(answers, createdAt).split('\n')[0];
  const lines = new Set(answers.map(answer => `${answer.label}: ${answer.value}`));
  const blocks = original.split('\n\n');
  const matches = blocks.map((block, i) => ({ block, i })).filter(({block}) => {
    const rows = block.split('\n');
    return rows[0] === header && [...lines].every(line => rows.slice(1).includes(line));
  });
  if (matches.length !== 1) return original;
  const index = matches[0].i;
  const kept = blocks[index].split('\n').slice(1).filter(line => !lines.has(line));
  if (kept.length) blocks[index] = [header, ...kept].join('\n');
  else blocks.splice(index, 1);
  return blocks.join('\n\n');
}

/** Atomic/idempotent per CRM customer and form submission, including admin
 * retries. The event marker and notes are committed together, and a row lock
 * protects concurrent enrichment. There is no global customer backfill. */
export async function saveMarketingFormProfile(leadId: string, row: FormProfileInput, newlyCreated: boolean) {
  const answers = formCrmAnswers(row.answers,row.answer_labels,row.answer_crm_fields);
  if (!answers.length) return false;
  const eventKey = `marketing-form:${row.id}`;
  const sql = getSql();
  return sql.begin(async tx => {
    const [current] = await tx<(ProfileRecord & { same_submission: boolean })[]>`
      select l.age,l.salary,l.obligation,l.salary_bank,l.location,l.car_name,l.car_type,l.car_model,l.car_category,l.color,l.notes,l.extra_data,
        exists(select 1 from crm.service_requests r where r.id=l.current_request_id and r.lead_id=l.id
          and r.classification_method='lead_import' and r.metadata->>'eventKey'=${eventKey}
          and nullif(r.metadata->>'previousRequestId','') is null) as same_submission
      from crm.leads l where l.id=${leadId}::uuid and l.is_deleted=false for update of l
    `;
    if (!current) throw new Error('العميل غير موجود أثناء حفظ إجابات الفورم');
    const [prior] = await tx<{ id: string; finance_ranges_version: string | null }[]>`
      select id::text,details->>'financeRangesVersion' as finance_ranges_version from crm.lead_events where lead_id=${leadId}::uuid
        and event_type='marketing_form_answers_saved' and details->>'formLeadId'=${row.id} limit 1
    `;
    const sameSubmission = newlyCreated || Boolean(current.same_submission);
    // Explicit re-sync of a previously saved original submission upgrades the
    // old note-only salary/obligation ranges without repeating other answers.
    if (prior) {
      if (!sameSubmission || prior.finance_ranges_version === '2') return sameSubmission;
      const ranges = answers.filter(a => (a.field === 'salary' || a.field === 'obligation') && typeof a.profileValue === 'string'
        && moveLegacyFinanceNotes(current.notes,[a],row.created_at) !== (current.notes || ''));
      const {fields} = planFormProfile(ranges,current,true);
      const rangePatch: Record<string,string> = {};
      for (const field of FINANCE_PROFILE_FIELDS) {
        const value = fields[field];
        if (typeof value === 'string') rangePatch[financeProfileRangeKey(field)] = value;
      }
      const moved = ranges.filter(a => (a.field === 'salary' || a.field === 'obligation') &&
        sameValue(fields[a.field] ?? financeProfileValue(current[a.field],current.extra_data,a.field), a.value));
      const nextNotes = moved.reduce((text, answer) => moveLegacyFinanceNotes(text,[answer],row.created_at),current.notes || '');
      if (Object.keys(rangePatch).length || nextNotes !== (current.notes || '')) await tx`
        update crm.leads set extra_data=coalesce(extra_data,'{}'::jsonb)||${tx.json(rangePatch)}::jsonb,
          notes=${nextNotes || null}::text,
          credit_limit=case when ${Object.keys(rangePatch).length > 0}::boolean then null else credit_limit end,
          credit_qualified=case when ${Object.keys(rangePatch).length > 0}::boolean then null else credit_qualified end,
          updated_at=now() where id=${leadId}::uuid and is_deleted=false
      `;
      await tx`update crm.lead_events set details=coalesce(details,'{}'::jsonb)||${tx.json({financeRangesVersion:2})}::jsonb
        where id=${prior.id}::bigint and lead_id=${leadId}::uuid`;
      return true;
    }
    const {fields, notes} = planFormProfile(answers,current,sameSubmission);
    const rangePatch: Record<string,string> = {};
    for (const field of FINANCE_PROFILE_FIELDS) {
      const value = fields[field];
      if (typeof value === 'string') rangePatch[financeProfileRangeKey(field)] = value;
    }
    const hasNewRange = Object.keys(rangePatch).length > 0;
    const note = formProfileNote(notes,row.created_at);
    const carName = fields.car_type ?? (!isBlank(current.car_type) && isBlank(current.car_name)
      && answers.some(a => a.field==='car_type' && a.profileValue!==null && sameValue(current.car_type,a.profileValue))
      && sameSubmission ? String(current.car_type) : null);
    // Each value in fields is populated only if the corresponding locked field
    // was blank. Do not replace a manual CRM edit or modify operational fields.
    await tx`
      update crm.leads set
        age=coalesce(${fields.age ?? null}::integer,age),
        salary=coalesce(${typeof fields.salary === 'number' ? fields.salary : null}::numeric,salary),
        obligation=coalesce(${typeof fields.obligation === 'number' ? fields.obligation : null}::numeric,obligation),
        salary_bank=coalesce(${fields.salary_bank ?? null}::text,salary_bank),
        location=coalesce(${fields.location ?? null}::text,location),
        car_type=coalesce(${fields.car_type ?? null}::text,car_type),
        car_name=coalesce(${carName}::text,car_name),
        car_model=coalesce(${fields.car_model ?? null}::text,car_model),
        car_category=coalesce(${fields.car_category ?? null}::text,car_category),
        color=coalesce(${fields.color ?? null}::text,color),
        notes=case when ${note}::text='' then notes else concat_ws(E'\n\n',nullif(notes,''),${note}::text) end,
        extra_data=coalesce(extra_data,'{}'::jsonb)||${tx.json(rangePatch)}::jsonb,
        credit_limit=case when ${hasNewRange}::boolean then null else credit_limit end,
        credit_qualified=case when ${hasNewRange}::boolean then null else credit_qualified end,
        updated_at=now()
      where id=${leadId}::uuid and is_deleted=false
    `;
    await tx`
      insert into crm.lead_events(lead_id,event_type,actor_name,note,details)
      values(${leadId}::uuid,'marketing_form_answers_saved','فورم المنصات','تم حفظ إجابات الفورم في بيانات العميل',
        ${tx.json({formLeadId:row.id,eventKey,fields:Object.keys(fields),noteCount:notes.length,financeRangesVersion:2})})
    `;
    return sameSubmission;
  });
}
