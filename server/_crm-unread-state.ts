type SqlClient = any;

export type CrmUnreadInput = {
  leadId: string;
  conversationId?: string | null;
  createdAt: string;
  messageId?: string | null;
  messagePath?: string | null;
  messageKey: string;
};

export async function markCrmLeadUnread(sql: SqlClient, input: CrmUnreadInput) {
  return sql.begin(async (transaction: SqlClient) => {
    const [updated] = await transaction<any[]>`
      update crm.leads
      set
        unread_count=case
          when coalesce(extra_data->>'lastUnreadMessageKey','')=${input.messageKey} then greatest(1,coalesce(unread_count,0))
          when last_incoming_message_at is null or last_incoming_message_at<=${input.createdAt}::timestamptz then greatest(1,coalesce(unread_count,0)+1)
          else greatest(1,coalesce(unread_count,0))
        end,
        dashboard_unread=true,
        has_unread_message=true,
        has_unread_messages=true,
        message_unread=true,
        is_unread=true,
        last_message_direction='in',
        last_incoming_message_at=greatest(coalesce(last_incoming_message_at,'epoch'::timestamptz),${input.createdAt}::timestamptz),
        last_message_at=greatest(coalesce(last_message_at,'epoch'::timestamptz),${input.createdAt}::timestamptz),
        extra_data=jsonb_set(
          jsonb_set(coalesce(extra_data,'{}'::jsonb),'{lastFirestoreMessageId}',to_jsonb(${input.messageId || null}::text),true),
          '{lastFirestoreMessagePath}',to_jsonb(${input.messagePath || null}::text),true
        ) || jsonb_build_object('lastUnreadMessageKey',${input.messageKey}::text),
        updated_at=now()
      where id=${input.leadId}::uuid
        and (dashboard_message_read_at is null or dashboard_message_read_at<${input.createdAt}::timestamptz)
      returning *,id::text,assigned_to::text,call_center_assigned_to::text
    `;

    if (updated) {
      await transaction`
        update crm.conversations
        set unread_count=case
              when coalesce(metadata->>'lastUnreadMessageKey','')=${input.messageKey} then greatest(1,coalesce(unread_count,0))
              when last_message_at is null or last_message_at<=${input.createdAt}::timestamptz then greatest(1,coalesce(unread_count,0)+1)
              else greatest(1,coalesce(unread_count,0))
            end,
            last_message_at=greatest(coalesce(last_message_at,'epoch'::timestamptz),${input.createdAt}::timestamptz),
            metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{lastUnreadMessageKey}',to_jsonb(${input.messageKey}::text),true),
            updated_at=now()
        where lead_id=${input.leadId}::uuid
          and (${input.conversationId || null}::text is null or id::text=${input.conversationId || null} or legacy_id=${input.conversationId || null})
      `;
    }
    return updated || null;
  });
}

export async function markCrmLeadRead(sql: SqlClient, leadId: string) {
  return sql.begin(async (transaction: SqlClient) => {
    const [updated] = await transaction<any[]>`
      update crm.leads
      set unread_count=0,dashboard_unread=false,has_unread_message=false,has_unread_messages=false,
          message_unread=false,is_unread=false,dashboard_message_read_at=now(),updated_at=now()
      where id=${leadId}::uuid
      returning *,id::text,assigned_to::text,call_center_assigned_to::text
    `;
    await transaction`update crm.conversations set unread_count=0,updated_at=now() where lead_id=${leadId}::uuid`;
    return updated || null;
  });
}
