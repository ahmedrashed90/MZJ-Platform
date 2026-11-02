/** Visual layout primitives for MZJ lead forms. All data is JSON-safe and declarative. */
export type DesignBaseTemplate = 'steps' | 'visual' | 'chat' | 'quiz' | 'minimal' | 'classic';
export type DesignBlockKind = 'brand' | 'cover' | 'heading' | 'progress' | 'question' | 'contact' | 'actions' | 'trust' | 'success' | 'text' | 'image' | 'badge' | 'divider' | 'spacer';
export type DesignBlock = {
  id: string;
  kind: DesignBlockKind;
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
  choices: 'list' | 'cards' | 'tiles' | 'pills';
  surface: 'paper' | 'soft' | 'dark' | 'borderless';
  buttonShape: 'rounded' | 'pill' | 'square';
  maxWidth: number;
};
export const DESIGN_BLOCK_LABELS: Record<DesignBlockKind,string> = {
  brand:'الشعار والهوية', cover:'صورة الغلاف', heading:'عنوان الخطوة', progress:'شريط التقدم', question:'الإجابات والاختيارات',
  contact:'بيانات التواصل', actions:'أزرار التنقل والإرسال', trust:'الخصوصية', success:'رسالة النجاح', text:'نص', image:'صورة',
  badge:'شارة نصية', divider:'فاصل', spacer:'مسافة فارغة',
};
export const REQUIRED_DESIGN_BLOCKS: DesignBlockKind[] = ['question','contact','actions','success'];
export const SYSTEM_DESIGN_BLOCKS: DesignBlockKind[] = ['brand','cover','heading','progress','question','contact','actions','trust','success'];
const block = (kind:DesignBlockKind, suffix:string):DesignBlock=>({id:`${suffix}_${kind}`,kind,width:'full',align:'right',size:'md'});
export function createTemplateDesign(template:DesignBaseTemplate, fields:{id:string}[]):FormDesign {
  const settings: Record<DesignBaseTemplate, Pick<FormDesign,'animation'|'choices'|'surface'|'buttonShape'|'maxWidth'>> = {
    steps:{animation:'slide',choices:'list',surface:'paper',buttonShape:'rounded',maxWidth:490},
    visual:{animation:'zoom',choices:'cards',surface:'soft',buttonShape:'rounded',maxWidth:720},
    chat:{animation:'fade',choices:'pills',surface:'paper',buttonShape:'pill',maxWidth:570},
    quiz:{animation:'slide',choices:'tiles',surface:'dark',buttonShape:'pill',maxWidth:640},
    minimal:{animation:'fade',choices:'list',surface:'borderless',buttonShape:'square',maxWidth:500},
    classic:{animation:'none',choices:'tiles',surface:'paper',buttonShape:'rounded',maxWidth:720},
  };
  const screens:Record<string,DesignBlock[]>={};
  for(const [i,field] of fields.entries()){
    const ordered:DesignBlockKind[] = template==='chat'
      ? ['brand','progress','heading','question','actions','trust']
      : template==='visual' ? ['brand','cover','heading','progress','question','actions','trust']
      : template==='quiz' ? ['brand','progress','heading','question','actions','trust']
      : template==='minimal' ? ['brand','heading','question','progress','actions','trust']
      : template==='classic' ? ['brand','heading','progress','question','actions','trust']
      : ['brand','cover','heading','progress','question','actions','trust'];
    screens[field.id]=ordered.filter(k=>k!=='cover'||i===0).map(k=>block(k,field.id));
  }
  screens.contact=(['brand','progress','heading','contact','actions','trust'] as DesignBlockKind[]).map(k=>block(k,'contact'));
  screens.success=(['brand','success'] as DesignBlockKind[]).map(k=>block(k,'success'));
  return {version:1,screens,...settings[template]};
}
/** Use the saved layout, while giving newly added questions a working screen by default. */
export function resolveFormDesign(saved:FormDesign|undefined, template:DesignBaseTemplate, fields:{id:string}[]):FormDesign {
  const defaults=createTemplateDesign(template,fields);
  if(!saved||saved.version!==1||!saved.screens)return defaults;
  return {...defaults,...saved,screens:{...defaults.screens,...saved.screens}};
}
