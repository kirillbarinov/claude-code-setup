#!/usr/bin/env bash
# gen-image.sh <промпт> <выходной-файл.png> [аспект]
# Генерация через OpenRouter Images API, модель openai/gpt-image-2, quality=medium.
# Аспект — один из: 1:1 3:2 2:3 4:3 3:4 16:9 9:16 21:9 auto  (по умолчанию 1:1).
# Пиксельных размеров модель НЕ принимает — только aspect_ratio.
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: gen-image.sh <промпт> <выходной-файл.png> [аспект: 1:1|3:2|2:3|4:3|3:4|16:9|9:16|21:9|auto]" >&2
  exit 1
fi

NODE="$(command -v node || echo /opt/homebrew/opt/node@20/bin/node)"
exec "$NODE" -e '
const fs=require("fs"),os=require("os"),path=require("path");
let key=null;
try{const m=fs.readFileSync(path.join(os.homedir(),".claude/secrets.env"),"utf8").match(/OPENROUTER_API_KEY=(\S+)/);if(m)key=m[1].replace(/^["\x27]|["\x27]$/g,"");}catch(e){}
if(!key||key==="PASTE_YOUR_KEY_HERE"){console.log("KEY_MISSING — впиши OPENROUTER_API_KEY в ~/.claude/secrets.env");process.exit(2);}

const [prompt,outPath,aspect="1:1"]=process.argv.slice(1);
const ASPECTS=["1:1","3:2","2:3","4:3","3:4","16:9","9:16","21:9","auto"];
if(!ASPECTS.includes(aspect)){console.log("Неверный аспект \x27"+aspect+"\x27. Допустимы: "+ASPECTS.join(" "));process.exit(1);}

const body={model:"openai/gpt-image-2",prompt,quality:"medium",aspect_ratio:aspect};

(async()=>{
  const r=await fetch("https://openrouter.ai/api/v1/images",{
    method:"POST",
    headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},
    body:JSON.stringify(body)});
  const t=await r.text();
  if(!r.ok){
    let msg=t.slice(0,300);
    try{msg=JSON.parse(t).error?.message||msg;}catch(e){}
    if(r.status===401)console.log("Ключ отклонён (401): "+msg);
    else if(r.status===402)console.log("Не хватает кредитов на OpenRouter (402): "+msg+"  — проверь: or.sh credits");
    else if(r.status===400)console.log("API отверг запрос (400): "+msg);
    else if(r.status===429)console.log("Лимит запросов (429), подожди и повтори: "+msg);
    else console.log("Ошибка HTTP "+r.status+": "+msg);
    process.exit(3);
  }
  const d=JSON.parse(t);
  const img=(d.data||[])[0];
  if(!img||!img.b64_json){console.log("Ответ без картинки: "+t.slice(0,300));process.exit(4);}
  const buf=Buffer.from(img.b64_json,"base64");
  fs.mkdirSync(path.dirname(path.resolve(outPath)),{recursive:true});
  fs.writeFileSync(outPath,buf);
  const cost=d.usage&&d.usage.cost;
  console.log("Готово: "+outPath+"  ("+Math.round(buf.length/1024)+" КБ, "+aspect+", quality=medium)");
  if(cost!=null)console.log("Цена этой генерации: $"+Number(cost).toFixed(5)+"  (баланс в биллинге обновляется с задержкой)");
  console.log("Дальше: optimize-assets.sh "+path.dirname(path.resolve(outPath)));
})().catch(e=>{console.log("Сбой сети/выполнения: "+e.message);process.exit(5);});
' "$1" "$2" "${3:-1:1}"
