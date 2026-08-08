alter table crm.assignment_rules
  add column if not exists branch_codes text[] not null default '{}';

update crm.assignment_rules
set branch_codes=array[branch_code]
where nullif(branch_code,'') is not null
  and coalesce(array_length(branch_codes,1),0)=0;

create index if not exists crm_assignment_rules_scope_idx
  on crm.assignment_rules(department_code,is_active,sort_order);

create index if not exists crm_assignment_rules_branch_codes_gin_idx
  on crm.assignment_rules using gin(branch_codes);
