import { useEffect, useRef } from "react";

export function StickyHorizontalScroll({ targetRef }: { targetRef: React.RefObject<HTMLDivElement | null> }) {
  const barRef=useRef<HTMLDivElement|null>(null); const innerRef=useRef<HTMLDivElement|null>(null); const syncing=useRef(false);
  useEffect(()=>{
    const target=targetRef.current,bar=barRef.current,inner=innerRef.current; if(!target||!bar||!inner)return;
    const resize=()=>{inner.style.width=`${target.scrollWidth}px`;bar.style.display=target.scrollWidth>target.clientWidth?"block":"none";bar.scrollLeft=target.scrollLeft;};
    const fromTarget=()=>{if(syncing.current)return;syncing.current=true;bar.scrollLeft=target.scrollLeft;requestAnimationFrame(()=>{syncing.current=false;});};
    const fromBar=()=>{if(syncing.current)return;syncing.current=true;target.scrollLeft=bar.scrollLeft;requestAnimationFrame(()=>{syncing.current=false;});};
    const observer=new ResizeObserver(resize); observer.observe(target); if(target.firstElementChild)observer.observe(target.firstElementChild);
    target.addEventListener("scroll",fromTarget,{passive:true}); bar.addEventListener("scroll",fromBar,{passive:true}); window.addEventListener("resize",resize); resize();
    return()=>{observer.disconnect();target.removeEventListener("scroll",fromTarget);bar.removeEventListener("scroll",fromBar);window.removeEventListener("resize",resize);};
  },[targetRef]);
  return <div className="operations-sticky-scroll" ref={barRef}><div ref={innerRef}/></div>;
}
