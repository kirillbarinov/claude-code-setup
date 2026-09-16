#!/usr/bin/env bash
# OpenRouter helper. Ключ читается из ~/.claude/secrets.env и НИКОГДА не печатается.
#   or.sh credits                  — остаток баланса
#   or.sh models images [фильтр]   — модели изображений + реальные цены (из /endpoints)
#   or.sh models video  [фильтр]   — модели видео + цены
#   or.sh price <model-id>         — цены по провайдерам для конкретной модели
set -euo pipefail
NODE="$(command -v node || echo /opt/homebrew/opt/node@20/bin/node)"
exec "$NODE" -e '
const fs=require("fs"),os=require("os"),path=require("path");
let key=null;
try{const m=fs.readFileSync(path.join(os.homedir(),".claude/secrets.env"),"utf8").match(/OPENROUTER_API_KEY=(\S+)/);if(m)key=m[1].replace(/^["\x27]|["\x27]$/g,"");}catch(e){}
if(!key||key==="PASTE_YOUR_KEY_HERE"){console.log("KEY_MISSING — впиши ключ в ~/.claude/secrets.env");process.exit(2);}
const H={Authorization:"Bearer "+key};
const [cmd,a2,a3]=process.argv.slice(1);
const get=async u=>{const r=await fetch(u,{headers:H});const t=await r.text();
  if(!r.ok)throw new Error("HTTP "+r.status+" "+u+" :: "+t.slice(0,200));return JSON.parse(t);};
const priceOf=async id=>{try{
  const d=await get("https://openrouter.ai/api/v1/models/"+id+"/endpoints");
  const eps=(d.data&&d.data.endpoints)||[];
  return eps.map(e=>{const p=e.pricing||{};
    const parts=Object.entries(p).filter(([k,v])=>v&&v!=="0"&&k!=="discount").map(([k,v])=>k+"=$"+Number(v).toPrecision(3));
    return (e.provider_name||"?")+": "+(parts.join(" ")||"free/по запросу");});
}catch(e){return ["цена недоступна ("+e.message.slice(0,60)+")"];}};
(async()=>{
 if(cmd==="credits"){const d=(await get("https://openrouter.ai/api/v1/credits")).data;
   console.log("remaining=$"+(d.total_credits-d.total_usage).toFixed(3)+"  (пополнено $"+d.total_credits+", потрачено $"+d.total_usage.toFixed(3)+")");return;}
 if(cmd==="models"){const kind=a2==="video"?"videos":"images";
   const all=(await get("https://openrouter.ai/api/v1/"+kind+"/models")).data||[];
   const rows=all.filter(m=>!a3||((m.id||"")+" "+(m.name||"")).toLowerCase().includes(a3.toLowerCase()));
   console.log(rows.length+"/"+all.length+" моделей ("+kind+")"+(a3?" фильтр \x27"+a3+"\x27":"")+"  — цены на "+new Date().toISOString().slice(0,10));
   const prices=await Promise.all(rows.map(m=>priceOf(m.id)));
   rows.forEach((m,i)=>{console.log("\n  "+m.id+"  ("+(m.name||"")+")");prices[i].forEach(p=>console.log("      "+p));});
   return;}
 if(cmd==="price"){(await priceOf(a2)).forEach(p=>console.log("  "+p));return;}
 console.log("usage: or.sh credits | models images|video [filter] | price <model-id>");
})().catch(e=>{console.log(e.message);process.exit(3);});
' "${1:-credits}" "${2:-}" "${3:-}"
