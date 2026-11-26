/** Marketing form profile enrichment; deliberately independent of CRM routing.
 * The original answers, including numeric ranges, remain stored in the form. */
import { getSql } from '../_db.js';
import { formCrmAnswers, financeProfileValue, financeProfileRangeKey, FINANCE_PROFILE_FIELDS, isJobProfileLabel, type FormCrmAnswer, type ProfileField } from '../../shared/lead-form-crm-fields.js';

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

type JobFieldDefinition = { field_key: string; label: string; field_type: string; options: unknown };

/** CRM custom fields may use generated keys. Resolve the existing active field
 * by its label, never by an invented key or a new column. Ambiguous definitions
 * are not guessed, and reserved finance-profile keys cannot be overwritten. */
export function findJobField(definitions: JobFieldDefinition[]): JobFieldDefinition | undefined {
  const matches = definitions.filter(d => isJobProfileLabel(d.label)
    && ['text','textarea','select'].includes(d.field_type)
    && /^[a-z0-9_]+$/u.test(d.field_key)
    && !d.field_key.startsWith('mzj_form_')
    && !Object.hasOwn(Object.prototype,d.field_key));
  return matches.length === 1 ? matches[0] : undefined;
}

function jobFieldValue(field: JobFieldDefinition | undefined, answer: FormCrmAnswer): string | null {
  if (!field || typeof answer.profileValue !== 'string') return null;
  if (field.field_type !== 'select') return answer.profileValue;
  // Select fields store their configured option value, not an unrecognized
  // display label. If the form answer cannot be represented, keep it in notes.
  const options = Array.isArray(field.options) ? field.options : [];
  const matches = new Set<string>();
  for (const option of options) {
    const value = typeof option === 'string' ? option.trim()
      : option && typeof option === 'object' ? String(option.value ?? option.key ?? option.label ?? '').trim() : '';
    const label = typeof option === 'string' ? value : String(option?.label ?? option?.name ?? value).trim();
    if (value && (value === answer.profileValue || label === answer.profileValue)) matches.add(value);
  }
  return matches.size === 1 ? [...matches][0] : null;
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
export function moveLegacyProfileNotes(existing: string | null | undefined, answers: FormCrmAnswer[], createdAt: string | Date): string {
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
  const originalAnswers = formCrmAnswers(row.answers,row.answer_labels,row.answer_crm_fields);
  if (!originalAnswers.length) return false;
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
    const [prior] = await tx<{ id: string; finance_ranges_version: string | null; job_profile_version: string | null }[]>`
      select id::text,details->>'financeRangesVersion' as finance_ranges_version,
        details->>'jobProfileVersion' as job_profile_version from crm.lead_events where lead_id=${leadId}::uuid
        and event_type='marketing_form_answers_saved' and details->>'formLeadId'=${row.id} limit 1
    `;
    const sameSubmission = newlyCreated || Boolean(current.same_submission);
    if (prior && (!sameSubmission || (prior.finance_ranges_version === '2' && prior.job_profile_version === '1'))) return sameSubmission;

    let jobField: JobFieldDefinition | undefined;
    if (sameSubmission && prior?.job_profile_version !== '1' && originalAnswers.some(a => a.field === 'job' && a.profileValue !== null)) {
      const definitions = await tx<JobFieldDefinition[]>`
        select field_key,label,field_type,options from crm.customer_field_definitions
        where is_active=true and is_system=false
          and (cardinality(department_keys)=0 or 'finance'=any(department_keys))
        for share
      `;
      jobField = findJobField(definitions);
    }
    const answers = originalAnswers.map(a => a.field === 'job' ? { ...a, profileValue: jobFieldValue(jobField,a) } : a);
    const profileCurrent = { ...current, job: jobField ? current.extra_data?.[jobField.field_key] : undefined };

    // Re-sync only the original submission. Upgrade previously generated notes
    // independently for finance ranges and the newly configured job field.
    if (prior) {
      const upgradeFinance = prior.finance_ranges_version !== '2';
      const legacy = answers.filter(a => (
        (upgradeFinance && (a.field === 'salary' || a.field === 'obligation') && typeof a.profileValue === 'string')
        || (jobField && a.field === 'job' && a.profileValue !== null)
      ) && moveLegacyProfileNotes(current.notes,[a],row.created_at) !== (current.notes || ''));
      const {fields} = planFormProfile(legacy,profileCurrent,true);
      const rangePatch: Record<string,string> = {};
      for (const field of FINANCE_PROFILE_FIELDS) {
        const value = fields[field];
        if (typeof value === 'string') rangePatch[financeProfileRangeKey(field)] = value;
      }
      const extraPatch: Record<string,string> = { ...rangePatch };
      if (jobField && typeof fields.job === 'string') extraPatch[jobField.field_key] = fields.job;
      const moved = legacy.filter(a => {
        if (a.field === 'salary' || a.field === 'obligation') return sameValue(fields[a.field] ?? financeProfileValue(current[a.field],current.extra_data,a.field),a.value);
        return a.field === 'job' && a.profileValue !== null && sameValue(fields.job ?? profileCurrent.job,a.profileValue);
      });
      const nextNotes = moved.reduce((text, answer) => moveLegacyProfileNotes(text,[answer],row.created_at),current.notes || '');
      const hasNewRange = Object.keys(rangePatch).length > 0;
      if (Object.keys(extraPatch).length || nextNotes !== (current.notes || '')) await tx`
        update crm.leads set extra_data=coalesce(extra_data,'{}'::jsonb)||${tx.json(extraPatch)}::jsonb,
          notes=${nextNotes || null}::text,
          credit_limit=case when ${hasNewRange}::boolean then null else credit_limit end,
          credit_qualified=case when ${hasNewRange}::boolean then null else credit_qualified end,
          updated_at=now() where id=${leadId}::uuid and is_deleted=false
      `;
      const versions: Record<string,number> = {};
      if (upgradeFinance) versions.financeRangesVersion = 2;
      // A conflicting manual value is not overwritten or resurrected if it is
      // later cleared. Missing/incompatible targets remain eligible for retry.
      if (legacy.some(a => a.field === 'job')) versions.jobProfileVersion = 1;
      if (Object.keys(versions).length) await tx`update crm.lead_events set details=coalesce(details,'{}'::jsonb)||${tx.json(versions)}::jsonb
        where id=${prior.id}::bigint and lead_id=${leadId}::uuid`;
      return true;
    }
    const {fields, notes} = planFormProfile(answers,profileCurrent,sameSubmission);
    const rangePatch: Record<string,string> = {};
    for (const field of FINANCE_PROFILE_FIELDS) {
      const value = fields[field];
      if (typeof value === 'string') rangePatch[financeProfileRangeKey(field)] = value;
    }
    const hasNewRange = Object.keys(rangePatch).length > 0;
    const extraPatch: Record<string,string> = { ...rangePatch };
    if (jobField && typeof fields.job === 'string') extraPatch[jobField.field_key] = fields.job;
    const jobHandled = sameSubmission && answers.some(a => a.field === 'job' && a.profileValue !== null);
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
        extra_data=coalesce(extra_data,'{}'::jsonb)||${tx.json(extraPatch)}::jsonb,
        credit_limit=case when ${hasNewRange}::boolean then null else credit_limit end,
        credit_qualified=case when ${hasNewRange}::boolean then null else credit_qualified end,
        updated_at=now()
      where id=${leadId}::uuid and is_deleted=false
    `;
    await tx`
      insert into crm.lead_events(lead_id,event_type,actor_name,note,details)
      values(${leadId}::uuid,'marketing_form_answers_saved','فورم المنصات','تم حفظ إجابات الفورم في بيانات العميل',
        ${tx.json({formLeadId:row.id,eventKey,fields:Object.keys(fields),noteCount:notes.length,financeRangesVersion:2,...(jobHandled?{jobProfileVersion:1}:{})})})
    `;
    return sameSubmission;
  });
}
