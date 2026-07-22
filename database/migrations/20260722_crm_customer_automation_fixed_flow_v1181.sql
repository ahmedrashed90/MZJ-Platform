update crm.automation_settings
set automation_enabled=true,
    service_selection_enabled=true,
    automation_name='أوتوميشن استقبال عملاء CRM',
    trigger_mode='every_message',
    schedule_enabled=false,
    automation_messages=jsonb_build_object(
      'start',jsonb_build_object('enabled',false,'text',''),
      'welcome',jsonb_build_object('enabled',true,'text','مرحباً بك في مجموعة محمد بن ذعار العجمي للسيارات 👋'),
      'servicePrompt',jsonb_build_object('enabled',true,'text','برجاء اختيار الخدمة:'),
      'noMatch',jsonb_build_object('enabled',true,'text','برجاء اختيار إحدى الخدمات الظاهرة في القائمة.'),
      'validationFallback',jsonb_build_object('enabled',true,'text','برجاء إدخال البيانات بصورة صحيحة.'),
      'cancelled',jsonb_build_object('enabled',true,'text','تم إلغاء الطلب الحالي. يمكنك إرسال رسالة جديدة للبدء مرة أخرى.'),
      'restarted',jsonb_build_object('enabled',false,'text','')
    ),
    service_selection_message='برجاء اختيار الخدمة:',
    service_options=jsonb_build_array(
      jsonb_build_object(
        'key','cash','label','مبيعات الكاش','emoji','💰','active',true,'sortOrder',10,
        'serviceKey','cash','departmentCode','cash_sales','defaultBranch','','flowType','message',
        'aliases',to_jsonb(array['كاش','مبيعات كاش','مبيعات الكاش','شراء كاش']::text[]),
        'startMessage',jsonb_build_object('enabled',false,'text',''),
        'endMessage',jsonb_build_object('enabled',true,'text',E'تم تحويل طلبك إلى قسم مبيعات الكاش ✅\nسيتم التواصل معك قريباً'),
        'steps','[]'::jsonb,'system',true
      ),
      jsonb_build_object(
        'key','finance','label','مبيعات التمويل','emoji','🏦','active',true,'sortOrder',20,
        'serviceKey','finance','departmentCode','finance_sales','defaultBranch','online','flowType','questions',
        'aliases',to_jsonb(array['تمويل','مبيعات تمويل','مبيعات التمويل','شراء تمويل']::text[]),
        'startMessage',jsonb_build_object('enabled',true,'text','برجاء إدخال بيانات التمويل 👇'),
        'endMessage',jsonb_build_object('enabled',true,'text',E'سيتم التواصل معك في أقرب وقت\nنسعد بخدمتكم دائمًا 🌹'),
        'steps',jsonb_build_array(
          jsonb_build_object('key','name','name','الاسم','prompt','الاسم','sortOrder',10,'answerType','text','fieldKey','customer_name','required',true,'errorMessage','برجاء إدخال الاسم.','maxAttempts',3,'active',true,'options','[]'::jsonb),
          jsonb_build_object('key','car','name','السيارة','prompt','السيارة','sortOrder',20,'answerType','text','fieldKey','car_name','required',true,'errorMessage','برجاء إدخال السيارة المطلوبة.','maxAttempts',3,'active',true,'options','[]'::jsonb),
          jsonb_build_object('key','phone','name','رقم الجوال','prompt','رقم الجوال','sortOrder',30,'answerType','phone','fieldKey','phone','required',true,'errorMessage','برجاء إدخال رقم جوال صحيح.','maxAttempts',3,'active',true,'options','[]'::jsonb)
        ),
        'system',true
      ),
      jsonb_build_object(
        'key','service','label','خدمة العملاء','emoji','🛠','active',true,'sortOrder',30,
        'serviceKey','service','departmentCode','customer_service','defaultBranch','customer_service','flowType','message',
        'aliases',to_jsonb(array['خدمة العملاء','خدمه العملاء','خدمة','خدمة عملاء']::text[]),
        'startMessage',jsonb_build_object('enabled',false,'text',''),
        'endMessage',jsonb_build_object('enabled',true,'text','سيتم التواصل معك قريباً من أحد ممثلي قسم خدمة العملاء 👨‍🔧'),
        'steps','[]'::jsonb,'system',true
      )
    ),
    flow_timeout_value=24,
    flow_timeout_unit='hour',
    restart_keywords=array['البداية','ابدأ من جديد','القائمة'],
    cancel_keywords=array['إلغاء','الغاء','خروج'],
    automation_version=automation_version+1,
    updated_at=now()
where id='default';

insert into core.schema_migrations(version)
values('crm-customer-automation-fixed-flow-v1.18.1')
on conflict(version) do nothing;
