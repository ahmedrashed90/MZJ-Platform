import { getSql } from "./_db.js";

export const CRM_CONVERSATION_AUTOMATION_MIGRATION = "20260723_crm_conversation_automation_v1181.sql";

const REQUIRED_RELATIONS = [
  "crm.conversation_automation_settings",
  "crm.conversation_automation_platforms",
  "crm.conversation_automation_start_messages",
  "crm.conversation_automation_flows",
  "crm.conversation_automation_flow_aliases",
  "crm.conversation_automation_flow_steps",
  "crm.conversation_automation_sessions",
  "crm.conversation_automation_inbound_events",
  "crm.conversation_automation_answers",
  "crm.conversation_automation_outbound_messages",
  "crm.conversation_automation_final_actions",
] as const;

export async function getCrmConversationAutomationSchemaStatus(db?: any) {
  const sql = db || getSql();
  const [row] = await sql<any[]>`
    select
      to_regclass('crm.conversation_automation_settings') is not null as settings,
      to_regclass('crm.conversation_automation_platforms') is not null as platforms,
      to_regclass('crm.conversation_automation_start_messages') is not null as start_messages,
      to_regclass('crm.conversation_automation_flows') is not null as flows,
      to_regclass('crm.conversation_automation_flow_aliases') is not null as flow_aliases,
      to_regclass('crm.conversation_automation_flow_steps') is not null as flow_steps,
      to_regclass('crm.conversation_automation_sessions') is not null as sessions,
      to_regclass('crm.conversation_automation_inbound_events') is not null as inbound_events,
      to_regclass('crm.conversation_automation_answers') is not null as answers,
      to_regclass('crm.conversation_automation_outbound_messages') is not null as outbound_messages,
      to_regclass('crm.conversation_automation_final_actions') is not null as final_actions
  `;
  const flags = [
    row?.settings,
    row?.platforms,
    row?.start_messages,
    row?.flows,
    row?.flow_aliases,
    row?.flow_steps,
    row?.sessions,
    row?.inbound_events,
    row?.answers,
    row?.outbound_messages,
    row?.final_actions,
  ];
  const missing = REQUIRED_RELATIONS.filter((_, index) => flags[index] !== true);
  return {
    ready: missing.length === 0,
    missing: [...missing],
    migration: CRM_CONVERSATION_AUTOMATION_MIGRATION,
  };
}
