import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react';

export function OperationsModal({open,title,onClose,children,className=''}:{open:boolean;title:string;onClose:()=>void;children:React.ReactNode;className?:string}){
  useEffect(()=>{if(!open)return;const handler=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};document.addEventListener('keydown',handler);document.body.classList.add('modal-open');return()=>{document.removeEventListener('keydown',handler);document.body.classList.remove('modal-open');};},[open,onClose]);
  if(!open)return null;
  return createPortal(<div className="operations-modal-backdrop" onMouseDown={(event)=>{if(event.currentTarget===event.target)onClose();}}><section className={`operations-modal ${className}`} role="dialog" aria-modal="true"><header><h2>{title}</h2><button type="button" onClick={onClose} aria-label="إغلاق"><X size={22}/></button></header><div className="operations-modal-body">{children}</div></section></div>,document.body);
}
