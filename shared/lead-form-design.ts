/** Visual layout primitives for MZJ lead forms. All data is JSON-safe and declarative. */
export type DesignBaseTemplate = 'steps' | 'visual' | 'chat' | 'quiz' | 'minimal' | 'classic';
export type FormChoiceLayout = 'list' | 'cards' | 'tiles' | 'pills';
export type DesignBlockKind = 'brand' | 'cover' | 'heading' | 'progress' | 'question' | 'contact' | 'actions' | 'trust' | 'success' | 'text' | 'image' | 'badge' | 'divider' | 'spacer' | 'title' | 'video';
export type DesignBlock = {
  id: string;
  kind: DesignBlockKind;
  /** Explicit binding permits several independent questions on the same screen. */
  fieldId?: string;
  videoUrl?: string;
  text?: string;
  imageUrl?: string;
  align?: 'right' | 'center' | 'left';
  width?: 'full' | 'half';
  size?: 'sm' | 'md' | 'lg';
  height?: number;
};
export type FormDesign = {
  version: 1;
  screens: Record<string, DesignBlock[]>;
  animation: 'slide' | 'fade' | 'zoom' | 'none';
  /** Default for forms created before per-question designs were available. */
  choices: FormChoiceLayout;
  /** Per-question option layout, keyed by the stable question ID. */
  choiceLayouts?: Record<string, FormChoiceLayout>;
  surface: 'paper' | 'soft' | 'dark' | 'borderless';
  buttonShape: 'rounded' | 'pill' | 'square';
  maxWidth: number;
};
export const DESIGN_BLOCK_LABELS: Record<DesignBlockKind,string> = {
  brand:'الشعار والهوية', cover:'صورة الغلاف', heading:'عنوان الخطوة', progress:'شريط التقدم', question:'الإجابات والاختيارات',
  contact:'بيانات التواصل', actions:'أزرار التنقل والإرسال', trust:'الخصوصية', success:'رسالة النجاح', text:'نص', image:'صورة',
  badge:'شارة نصية', divider:'فاصل', spacer:'مسافة فارغة', title:'عنوان', video:'فيديو',
};
export const REQUIRED_DESIGN_BLOCKS: DesignBlockKind[] = ['contact','actions','success'];
export const SYSTEM_DESIGN_BLOCKS: DesignBlockKind[] = ['brand','cover','heading','progress','question','contact','actions','trust','success'];
const block = (kind:DesignBlockKind, suffix:string):DesignBlock=>({id:`${suffix}_${kind}`,kind,width:'full',align:'right',size:'md'});
export type StepField = {id:string;stepId?:string};
export function fieldStepId(field:StepField):string {return field.stepId || field.id;}
export function formStepIds(fields:StepField[]):string[]{return [...new Set(fields.map(fieldStepId))];}
export function blockFieldId(block:DesignBlock,screen:string):string{return block.fieldId || screen;}
/** Question order is the actual screen/block order, not stale field insertion order. */
export function orderedFormFields<T extends StepField>(fields:T[],design?:FormDesign):T[]{
  return formStepIds(fields).flatMap(screen=>{
    const group=fields.filter(field=>fieldStepId(field)===screen);
    const order=(design?.screens[screen]||[]).filter(b=>b.kind==='question').map(b=>blockFieldId(b,screen));
    return [...group].sort((a,b)=>{const ai=order.indexOf(a.id),bi=order.indexOf(b.id);return (ai<0?Infinity:ai)-(bi<0?Infinity:bi)||0;});
  });
}
export function createTemplateDesign(template:DesignBaseTemplate, fields:StepField[]):FormDesign {
  const settings: Record<DesignBaseTemplate, Pick<FormDesign,'animation'|'choices'|'surface'|'buttonShape'|'maxWidth'>> = {
    steps:{animation:'slide',choices:'list',surface:'paper',buttonShape:'rounded',maxWidth:490},
    visual:{animation:'zoom',choices:'cards',surface:'soft',buttonShape:'rounded',maxWidth:720},
    chat:{animation:'fade',choices:'pills',surface:'paper',buttonShape:'pill',maxWidth:570},
    quiz:{animation:'slide',choices:'tiles',surface:'dark',buttonShape:'pill',maxWidth:640},
    minimal:{animation:'fade',choices:'list',surface:'borderless',buttonShape:'square',maxWidth:500},
    classic:{animation:'none',choices:'tiles',surface:'paper',buttonShape:'rounded',maxWidth:720},
  };
  const screens:Record<string,DesignBlock[]>={};
  for(const [i,screen] of formStepIds(fields).entries()){
    const group=fields.filter(f=>fieldStepId(f)===screen);
    const ordered:DesignBlockKind[] = template==='chat'
      ? ['brand','progress','heading','question','actions']
      : template==='visual' ? ['brand','cover','heading','progress','question','actions']
      : template==='quiz' ? ['brand','progress','heading','question','actions']
      : template==='minimal' ? ['brand','heading','question','progress','actions']
      : template==='classic' ? ['brand','heading','progress','question','actions']
      : ['brand','cover','heading','progress','question','actions'];
    screens[screen]=ordered.filter(k=>k!=='cover'||i===0).flatMap(k=>k==='question'
      ? group.map(f=>({...block(k,f.id),...(f.id!==screen||group.length>1?{fieldId:f.id}:{})}))
      : [block(k,screen)]);
  }
  screens.contact=(['brand','progress','heading','contact','actions'] as DesignBlockKind[]).map(k=>block(k,'contact'));
  screens.success=(['brand','success'] as DesignBlockKind[]).map(k=>block(k,'success'));
  return {version:1,screens,...settings[template]};
}
/** Use the saved layout, while giving newly added questions a working screen by default. */
export function resolveFormDesign(saved:FormDesign|undefined, template:DesignBaseTemplate, fields:StepField[]):FormDesign {
  const defaults=createTemplateDesign(template,fields);
  if(!saved||saved.version!==1||!saved.screens)return defaults;
  return {...defaults,...saved,screens:{...defaults.screens,...saved.screens},choiceLayouts:{...defaults.choiceLayouts,...saved.choiceLayouts}};
}

/** Switching a question's option style must not affect its siblings. */
export function choiceLayoutFor(design: Pick<FormDesign, 'choices' | 'choiceLayouts'>, questionId: string): FormChoiceLayout {
  return design.choiceLayouts?.[questionId] || design.choices;
}
