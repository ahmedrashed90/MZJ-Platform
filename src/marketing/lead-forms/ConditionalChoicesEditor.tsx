import { Plus, Trash } from '@phosphor-icons/react';
import type { FormField } from '../../../shared/lead-forms';
import type { ChoiceCondition, ChoiceOptionRule } from '../../../shared/lead-form-rules';
import './lead-forms.css';

/** Configure different choices for a question based on one or more earlier answers. */
export function ConditionalChoicesEditor({field,fields,onChange}:{field:FormField;fields:FormField[];onChange:(patch:Partial<FormField>)=>void}) {
  if(field.type!=='choice')return null;
  const index=fields.findIndex(item=>item.id===field.id);
  const parents=fields.slice(0,index).filter(item=>item.type==='choice' && item.options.length>0);
  if(!parents.length)return null;
  const rules=field.optionRules || [];
  function replace(next:ChoiceOptionRule[]){onChange({optionRules:next});}
  function update(index:number,patch:Partial<ChoiceOptionRule>){replace(rules.map((rule,i)=>i===index?{...rule,...patch}:rule));}
  function condition(index:number,at:number,patch:Partial<ChoiceCondition>){
    const conditions=rules[index].conditions.map((value,i)=>i===at?{...value,...patch}:value);
    update(index,{conditions});
  }
  return <details className="mlf-rules-editor">
    <summary>اختيارات مخصصة حسب إجابات سابقة ({rules.length})</summary>
    <p>حدّد مثلًا «هيونداي» مع «كاش» لتظهر مجموعة اختيارات خاصة. تُستخدم الاختيارات الأساسية لو ما انطبقش أي شرط. أول قاعدة مطابقة هي المستخدمة.</p>
    {rules.map((rule,i)=><div className="mlf-rule-card" key={i}>
      <div className="mlf-rule-heading"><strong>القاعدة {i+1}</strong><button type="button" className="secondary" onClick={()=>replace(rules.filter((_,j)=>j!==i))}><Trash size={15}/> حذف القاعدة</button></div>
      {rule.conditions.map((item,j)=>{
        const parent=parents.find(p=>p.id===item.fieldId) || parents[0];
        return <div className="mlf-rule-condition" key={j}>
          <label>السؤال<select value={parent.id} onChange={e=>{const chosen=parents.find(p=>p.id===e.target.value) || parents[0];condition(i,j,{fieldId:chosen.id,equals:chosen.options[0]||''});}}>{parents.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
          <label>الإجابة<select value={item.equals} onChange={e=>condition(i,j,{equals:e.target.value})}>{parent.options.map(o=><option key={o} value={o}>{o}</option>)}</select></label>
          <button type="button" className="secondary" disabled={rule.conditions.length===1} title="إزالة الشرط" onClick={()=>update(i,{conditions:rule.conditions.filter((_,k)=>k!==j)})}><Trash size={15}/></button>
        </div>;
      })}
      <button type="button" className="secondary" disabled={rule.conditions.length>=4 || parents.every(p=>rule.conditions.some(c=>c.fieldId===p.id))} onClick={()=>{
        const next=parents.find(p=>!rule.conditions.some(c=>c.fieldId===p.id));
        if(next)update(i,{conditions:[...rule.conditions,{fieldId:next.id,equals:next.options[0]||''}]});
      }}><Plus size={14}/> إضافة شرط (و)</button>
      <label>الاختيارات التي تظهر عند تحقق الشروط<textarea rows={3} value={rule.options.join('\n')} onChange={e=>update(i,{options:e.target.value.split('\n').slice(0,12)})} placeholder="اختيار في كل سطر"/></label>
    </div>)}
    <button type="button" className="secondary" disabled={rules.length>=16} onClick={()=>replace([...rules,{conditions:[{fieldId:parents[0].id,equals:parents[0].options[0]||''}],options:[...field.options]}])}><Plus size={16}/> إضافة قاعدة اختيارات</button>
  </details>;
}
