const $=id=>document.getElementById(id), log=$("alarmLog");
let events=[], totalEvents=0;
function f(v){return v==null?"—":Number(v).toFixed(1)+" °C"}
function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
function todayISO(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
const KINDS={
  ALARM:e=>/TEMPERATURE ALARM|REMINDER/.test(e), ACK:e=>/ACKNOWLEDGED/.test(e), NORMAL:e=>/RETURN TO NORMAL/.test(e),
  CHANGE:e=>/CHANGED|ENABLED|DISABLED|ADDED|REMOVED|RESET|SUSPENDED/.test(e), LOGIN:e=>/LOGIN|LOGOUT|LOCKED/.test(e)};
function periodChanged(){
  const day=$("evPeriod").value==="day", range=$("evPeriod").value==="range";
  $("evDateWrap").classList.toggle("hidden",!day);
  document.querySelectorAll(".evRange").forEach(el=>el.classList.toggle("hidden",!range));
  if(day&&!$("evDate").value)$("evDate").value=todayISO();
  if(range&&!$("evTo").value){$("evTo").value=todayISO();const d=new Date();d.setDate(d.getDate()-6);
    $("evFrom").value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
  localStorage.setItem("thermoiq.events.period",$("evPeriod").value);
  loadEvents();
}
function query(){
  const p=$("evPeriod").value, q=new URLSearchParams({limit:"5000"});
  if(p==="today")q.set("date",todayISO());
  else if(p==="day")q.set("date",$("evDate").value||todayISO());
  else if(p==="range"){q.set("start",$("evFrom").value||todayISO());q.set("end",$("evTo").value||todayISO());}
  else if(p!=="all")q.set("days",p);
  if($("evLogger").value)q.set("logger",$("evLogger").value);
  return q;
}
async function loadLoggers(){
  try{const x=await (await fetch("/api/current")).json();
    $("evLogger").innerHTML='<option value="">All loggers</option>'+(x.devices||[]).map(d=>`<option value="${esc(d.logger_sn)}">${esc(d.name)}</option>`).join("");}catch(e){}
}
async function loadEvents(){
  try{const r=await fetch("/api/alarm-events?"+query()),x=await r.json();
    if(!r.ok){log.innerHTML=`<tr><td colspan="7">${esc(x.detail||"Unable to load event history.")}</td></tr>`;$("evCount").textContent="";return;}
    events=x.events||[];totalEvents=x.total||events.length;renderEvents();}
  catch(e){log.innerHTML=`<tr><td colspan="7">Unable to load event history.</td></tr>`}
}
function downloadEventsXlsx(){
  const q=query();q.delete("limit");if($("evKind").value)q.set("kind",$("evKind").value);
  window.location.href="/api/alarm-events.xlsx?"+q;
}
function qaPeriodChanged(){
  const custom=$("qaPeriod").value==="custom";
  document.querySelectorAll(".qaRange").forEach(el=>el.classList.toggle("hidden",!custom));
  if(custom&&!$("qaTo").value){$("qaTo").value=todayISO();$("qaFrom").value=todayISO().slice(0,8)+"01";}
}
async function downloadQa(){
  const p=$("qaPeriod").value, q=new URLSearchParams();
  if(p==="custom"){q.set("start",$("qaFrom").value);q.set("end",$("qaTo").value);}else q.set("period",p);
  const btn=$("qaBtn"), msg=$("qaMsg"); btn.disabled=true; msg.textContent="Building the workbook…";
  try{
    const r=await fetch("/api/period-report.xlsx?"+q);
    if(!r.ok){const x=await r.json().catch(()=>({}));msg.textContent=x.detail||"Could not build the report";return;}
    const name=((r.headers.get("Content-Disposition")||"").match(/filename="([^"]+)"/)||[])[1]||"PBF_QA_Report.xlsx";
    const url=URL.createObjectURL(await r.blob()), a=document.createElement("a");
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
    msg.textContent="Downloaded "+name;
  }catch(e){msg.textContent="Could not build the report";}
  finally{btn.disabled=false;}
}
function renderEvents(){
  const kind=$("evKind").value, rows=events.slice().reverse().filter(e=>!kind||KINDS[kind](String(e.event||"").toUpperCase()));
  $("evCount").textContent=`${rows.length} event${rows.length===1?"":"s"}`+(totalEvents>events.length?` (newest ${events.length} of ${totalEvents})`:"");
  log.innerHTML=rows.length?rows.map(e=>`<tr><td>${new Date(e.time).toLocaleString()}</td><td>${esc(e.name||e.logger_sn)}</td><td><b>${esc(e.event)}</b>${e.detail?`<br><small>${esc(e.detail)}</small>`:""}</td><td>${f(e.reading)}</td><td>${e.limit==null?"—":(e.alarm_type==="low"?"Low ":"High ")+Number(e.limit).toFixed(1)+" °C"}</td><td>${esc(e.email||"—")}</td><td>${esc(e.push||"—")}</td></tr>`).join("")
    :`<tr><td colspan="7">No events in this period.</td></tr>`;
}
const savedPeriod=localStorage.getItem("thermoiq.events.period");
if(savedPeriod&&savedPeriod!=="day"&&savedPeriod!=="range"&&[...$("evPeriod").options].some(o=>o.value===savedPeriod))$("evPeriod").value=savedPeriod;
loadLoggers().then(loadEvents);setInterval(loadEvents,30000);
