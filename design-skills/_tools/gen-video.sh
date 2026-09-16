#!/usr/bin/env bash
# gen-video.sh <промпт> <выходной-файл.mp4> [секунды 5..15] [разрешение 480P|768P] [аспект]
# Генерация видео через fal.ai queue API, модель minimax/h3-max/text-to-video.
# Звук генерируется нативно вместе с картинкой — описывай его в том же промпте.
# Ключ: FAL_KEY в ~/.claude/secrets.env (строка вида FAL_KEY=...), либо переменная окружения FAL_KEY.
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: gen-video.sh <промпт> <выходной-файл.mp4> [секунды 5..15] [480P|768P] [21:9|16:9|4:3|1:1|3:4|9:16]" >&2
  exit 1
fi

NODE="$(command -v node || echo /opt/homebrew/opt/node@20/bin/node)"
exec "$NODE" -e '
const fs=require("fs"),os=require("os"),path=require("path");
let key=process.env.FAL_KEY||null;
if(!key){try{const m=fs.readFileSync(path.join(os.homedir(),".claude/secrets.env"),"utf8").match(/FAL_KEY=(\S+)/);if(m)key=m[1].replace(/^["\x27]|["\x27]$/g,"");}catch(e){}}
if(!key||key==="PASTE_YOUR_KEY_HERE"){
  console.log("KEY_MISSING — нет ключа fal.ai.");
  console.log("Возьми ключ на https://fal.ai/dashboard/keys и добавь строкой в ~/.claude/secrets.env:");
  console.log("  FAL_KEY=<твой ключ>");
  process.exit(2);
}

const [prompt,outPath,durRaw="5",resolution="768P",aspect="16:9"]=process.argv.slice(1);
const duration=parseInt(durRaw,10);
if(!Number.isInteger(duration)||duration<5||duration>15){console.log("Длительность должна быть целым от 5 до 15 секунд, получено: "+durRaw);process.exit(1);}
if(!["480P","768P"].includes(resolution)){console.log("Разрешение только 480P или 768P, получено: "+resolution);process.exit(1);}
const ASPECTS=["21:9","16:9","4:3","1:1","3:4","9:16"];
if(!ASPECTS.includes(aspect)){console.log("Неверный аспект \x27"+aspect+"\x27. Допустимы: "+ASPECTS.join(" "));process.exit(1);}

const EP="minimax/h3-max/text-to-video";
const BASE="https://queue.fal.run/"+EP;
// Статус и результат живут по id ПРИЛОЖЕНИЯ, без хвостового сегмента маршрута:
// POST .../minimax/h3-max/text-to-video, но GET .../minimax/h3-max/requests/<id>/status.
// Полный путь на опросе отдаёт 405 с пустым телом.
const QBASE="https://queue.fal.run/"+EP.split("/").slice(0,2).join("/");
const H={Authorization:"Key "+key,"Content-Type":"application/json"};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const explain=(status,text)=>{
  let msg=text.slice(0,300);
  try{const j=JSON.parse(text);msg=j.detail?(typeof j.detail==="string"?j.detail:JSON.stringify(j.detail)):(j.error||msg);}catch(e){}
  if(status===401||status===403)return "Ключ fal отклонён ("+status+"): "+msg;
  if(status===402)return "Не хватает средств на балансе fal (402): "+msg;
  if(status===422)return "fal отверг параметры запроса (422): "+msg;
  if(status===429)return "Лимит запросов fal (429), подожди и повтори: "+msg;
  return "Ошибка HTTP "+status+": "+msg;
};

(async()=>{
  const body={prompt,duration,resolution,aspect_ratio:aspect,prompt_expansion_mode:"balanced"};
  const sub=await fetch(BASE,{method:"POST",headers:H,body:JSON.stringify(body)});
  const subText=await sub.text();
  if(!sub.ok){console.log(explain(sub.status,subText));process.exit(3);}
  const {request_id,status_url,response_url}=JSON.parse(subText);
  if(!request_id){console.log("fal не вернул request_id: "+subText.slice(0,300));process.exit(3);}
  const ST_URL=status_url||(QBASE+"/requests/"+request_id+"/status");
  const RES_URL=response_url||(QBASE+"/requests/"+request_id);
  console.log("Запрос в очереди fal: "+request_id+"  ("+duration+"с, "+resolution+", "+aspect+")");

  // Очередь: опрашиваем статус, пока не COMPLETED. Потолок ожидания — 10 минут.
  const deadline=Date.now()+10*60*1000;
  let status="IN_QUEUE";
  while(status!=="COMPLETED"){
    if(Date.now()>deadline){console.log("Истекли 10 минут ожидания. Запрос ещё жив, забери позже: "+RES_URL);process.exit(4);}
    await sleep(3000);
    const st=await fetch(ST_URL,{headers:{Authorization:"Key "+key}});
    const stText=await st.text();
    if(!st.ok){console.log(explain(st.status,stText));process.exit(3);}
    const s=JSON.parse(stText);
    if(s.status!==status){status=s.status;console.log("  статус: "+status+(s.queue_position!=null?" (позиция "+s.queue_position+")":""));}
  }

  const res=await fetch(RES_URL,{headers:{Authorization:"Key "+key}});
  const resText=await res.text();
  if(!res.ok){console.log(explain(res.status,resText));process.exit(3);}
  const d=JSON.parse(resText);
  const url=d.video&&d.video.url;
  if(!url){console.log("В ответе fal нет video.url: "+resText.slice(0,300));process.exit(4);}

  const bin=await fetch(url);
  if(!bin.ok){console.log("Не удалось скачать готовый файл: HTTP "+bin.status+" "+url);process.exit(5);}
  const buf=Buffer.from(await bin.arrayBuffer());
  fs.mkdirSync(path.dirname(path.resolve(outPath)),{recursive:true});
  fs.writeFileSync(outPath,buf);
  console.log("Готово: "+outPath+"  ("+Math.round(buf.length/1024)+" КБ, звук внутри)");
  if(d.timings&&d.timings.inference)console.log("Инференс: "+d.timings.inference.toFixed(1)+" с");
})().catch(e=>{console.log("Сбой сети/выполнения: "+e.message);process.exit(6);});
' "$1" "$2" "${3:-5}" "${4:-768P}" "${5:-16:9}"
