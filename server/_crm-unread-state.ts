type SqlClient = any;

export type CrmUnreadInput = {
  leadId: string;
  conversationId?: string | null;
  createdAt: string;
  messageId?: string | null;
  messagePath?: string | null;
  messageKey: string;
};

export type CrmReadInput = {
  leadId: string;
  conversationId?: string | null;
  readThroughAt: string;
  readThroughMessageKey?: string | null;
};

export async function markCrmLeadUnread(sql: SqlClient, input: CrmUnreadInput) {
  return sql.begin(async (transaction: SqlClient) => {
    const [updated] = await transaction<any[]>`
      update crm.leads
      set
        unread_count=case
          when coalesce(coalesce(extra_data,'{}'::jsonb)->>'lastUnreadMessageKey','')=${input.messageKey} then greatest(1,coalesce(unread_count,0))
          else greatest(1,coalesce(unread_count,0)+1)
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
        and (
          coalesce(coalesce(extra_data,'{}'::jsonb)->>'lastUnreadMessageKey','')<>${input.messageKey}
          or coalesce(unread_count,0)>0
          or dashboard_unread=true
          or has_unread_message=true
          or has_unread_messages=true
          or message_unread=true
          or is_unread=true
        )
      returning *,id::text,assigned_to::text,call_center_assigned_to::text
    `;

    if (updated) {
      await transaction`
        update crm.conversations
        set unread_count=case
              when coalesce(coalesce(metadata,'{}'::jsonb)->>'lastUnreadMessageKey','')=${input.messageKey} then greatest(1,coalesce(unread_count,0))
              else greatest(1,coalesce(unread_count,0)+1)
            end,
            last_customer_message_at=greatest(coalesce(last_customer_message_at,'epoch'::timestamptz),${input.createdAt}::timestamptz),
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

export async function markCrmLeadRead(sql: SqlClient, input: CrmReadInput) {
  return sql.begin(async (transaction: SqlClient) => {
    const [updated] = await transaction<any[]>`
      update crm.leads
      set unread_count=0,
          dashboard_unread=false,
          has_unread_message=false,
          has_unread_messages=false,
          message_unread=false,
          is_unread=false,
          dashboard_message_read_at=greatest(coalesce(dashboard_message_read_at,'epoch'::timestamptz),${input.readThroughAt}::timestamptz),
          updated_at=now()
      where id=${input.leadId}::uuid
        and (
          ${input.readThroughMessageKey || null}::text is not null
          and coalesce(coalesce(extra_data,'{}'::jsonb)->>'lastUnreadMessageKey','')=${input.readThroughMessageKey || null}
          or (
            ${input.readThroughMessageKey || null}::text is null
            and (last_incoming_message_at is null or last_incoming_message_at<=${input.readThroughAt}::timestamptz)
          )
        )
      returning *,id::text,assigned_to::text,call_center_assigned_to::text
    `;

    if (updated) {
      await transaction`
        update crm.conversations
        set unread_count=0,
            metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('lastReadAt',${input.readThroughAt}::text),
            updated_at=now()
        where lead_id=${input.leadId}::uuid
          and (${input.conversationId || null}::text is null or id::text=${input.conversationId || null} or legacy_id=${input.conversationId || null})
          and (
            ${input.readThroughMessageKey || null}::text is not null
            and coalesce(coalesce(metadata,'{}'::jsonb)->>'lastUnreadMessageKey','')=${input.readThroughMessageKey || null}
            or (
              ${input.readThroughMessageKey || null}::text is null
              and (last_customer_message_at is null or last_customer_message_at<=${input.readThroughAt}::timestamptz)
            )
          )
      `;
    }

    if (updated) return { row: updated, cleared: true };
    const [current] = await transaction<any[]>`
      select *,id::text,assigned_to::text,call_center_assigned_to::text
      from crm.leads where id=${input.leadId}::uuid limit 1
    `;
    return { row: current || null, cleared: false };
  });
}
