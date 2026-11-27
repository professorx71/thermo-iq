const $=id=>document.getElementById(id), log=$("alarmLog");
let events=[], totalEvents=0;
function f(v){return v==null?"—":Number(v).toFixed(1)+" °C"}
function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
function todayISO(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
const KINDS={
  ALARM:e=>/TEMPERATURE ALARM|REMINDER/.test(e), ACK:e=>/ACKNOWLEDGED/.test(e), NORMAL:e=>/RETURN TO NORMAL/.test(e),
  CHANGE:e=>/CHANGED|ENABLED|DISABLED|ADDED|REMOVED|RESET|SUSPENDED/.test(e), LOGIN:e=>/LOGIN|LOGOUT|LOCKED/.test(e)};
function periodChanged(){
  const day=$("evPeriod").value==="day";
  $("evDateWrap").classList.toggle("hidden",!day);
  if(day&&!$("evDate").value)$("evDate").value=todayISO();
  localStorage.setItem("thermoiq.events.period",$("evPeriod").value);
  loadEvents();
}
function query(){
  const p=$("evPeriod").value, q=new URLSearchParams({limit:"5000"});
  if(p==="today")q.set("date",todayISO());
  else if(p==="day")q.set("date",$("evDate").value||todayISO());
  else if(p!=="all")q.set("days",p);
  if($("evLogger").value)q.set("logger",$("evLogger").value);
  return q;
}
async function loadLoggers(){
  try{const x=await (await fetch("/api/current")).json();
    $("evLogger").innerHTML='<option value="">All loggers</option>'+(x.devices||[]).map(d=>`<option value="${esc(d.logger_sn)}">${esc(d.name)}</option>`).join("");}catch(e){}
}
async function loadEvents(){
  try{const x=await (await fetch("/api/alarm-events?"+query())).json();events=x.events||[];totalEvents=x.total||events.length;renderEvents();}
  catch(e){log.innerHTML=`<tr><td colspan="7">Unable to load event history.</td></tr>`}
}
function renderEvents(){
  const kind=$("evKind").value, rows=events.slice().reverse().filter(e=>!kind||KINDS[kind](String(e.event||"").toUpperCase()));
  $("evCount").textContent=`${rows.length} event${rows.length===1?"":"s"}`+(totalEvents>events.length?` (newest ${events.length} of ${totalEvents})`:"");
  log.innerHTML=rows.length?rows.map(e=>`<tr><td>${new Date(e.time).toLocaleString()}</td><td>${esc(e.name||e.logger_sn)}</td><td><b>${esc(e.event)}</b>${e.detail?`<br><small>${esc(e.detail)}</small>`:""}</td><td>${f(e.reading)}</td><td>${e.limit==null?"—":(e.alarm_type==="low"?"Low ":"High ")+Number(e.limit).toFixed(1)+" °C"}</td><td>${esc(e.email||"—")}</td><td>${esc(e.push||"—")}</td></tr>`).join("")
    :`<tr><td colspan="7">No events in this period.</td></tr>`;
}
const savedPeriod=localStorage.getItem("thermoiq.events.period");
if(savedPeriod&&savedPeriod!=="day"&&[...$("evPeriod").options].some(o=>o.value===savedPeriod))$("evPeriod").value=savedPeriod;
loadLoggers().then(loadEvents);setInterval(loadEvents,30000);
