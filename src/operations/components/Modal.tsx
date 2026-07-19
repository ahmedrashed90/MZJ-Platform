import { useEffect } from "react";
import { X } from "@phosphor-icons/react";

export function Modal({open,title,subtitle,onClose,children,className="",dirty=false}:{open:boolean;title:string;subtitle?:string;onClose:()=>void;children:React.ReactNode;className?:string;dirty?:boolean}) {
  useEffect(()=>{
    if (!open) return;
    const onKey=(event:KeyboardEvent)=>{ if (event.key==="Escape") { if (!dirty || window.confirm("توجد بيانات غير محفوظة. هل تريد الإغلاق؟")) onClose(); } };
    document.addEventListener("keydown",onKey); return ()=>document.removeEventListener("keydown",onKey);
  },[open,onClose,dirty]);
  if (!open) return null;
  const close=()=>{ if (!dirty || window.confirm("توجد بيانات غير محفوظة. هل تريد الإغلاق؟")) onClose(); };
  return <div className="operations-modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget) close();}}>
    <section className={`operations-modal ${className}`} role="dialog" aria-modal="true" aria-label={title}>
      <header><div><h2>{title}</h2>{subtitle?<p>{subtitle}</p>:null}</div><button type="button" className="icon" onClick={close} aria-label="إغلاق"><X size={20}/></button></header>
      <div className="operations-modal-body">{children}</div>
    </section>
  </div>;
}
