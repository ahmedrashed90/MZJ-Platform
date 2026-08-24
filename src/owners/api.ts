async function read(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || "تعذر تنفيذ الطلب");
  return payload;
}
export async function ownersAdminGet(scope='',params:Record<string,string>={}){const q=new URLSearchParams(params);if(scope)q.set('scope',scope);const suffix=q.toString()?`?${q.toString()}`:'';return read(await fetch(`/api/owners${suffix}`,{credentials:'include',cache:'no-store'}));}
export async function ownersAdminPost(payload:Record<string,unknown>){return read(await fetch('/api/owners',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}));}
export async function ownersPublicGet(action:string,params:Record<string,string>={}){const q=new URLSearchParams({action,...params});return read(await fetch(`/api/owners/public?${q}`,{credentials:'include',cache:'no-store'}));}
export async function ownersPublicPost(payload:Record<string,unknown>){return read(await fetch('/api/owners/public',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}));}
