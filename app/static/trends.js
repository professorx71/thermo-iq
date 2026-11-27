// Trends: view one logger, all loggers, or compare several on one chart; quick ranges or custom dates.
let minutes=1440,useF=false,lastData=null;
let custom=null;                 // {start:"YYYY-MM-DD", end:"YYYY-MM-DD"} when a custom date range is applied
let compareMode=false;           // true: chips toggle loggers into one combined chart
let compareSet=new Set(JSON.parse(localStorage.getItem("thermoiq.trends.compare")||"[]"));
// Which logger is shown: "ALL" or a serial. Kept in the address (#serial) so a link opens that logger.
let selected=decodeURIComponent(location.hash.slice(1))||localStorage.getItem("thermoiq.trends.logger")||"ALL";
const $=id=>document.getElementById(id),cv=c=>useF?(c*9/5+32):c,unit=()=>useF?"°F":"°C";
const COMPARE_COLORS=["#3ab5ff","#3ce39a","#ffb259","#b99cff","#ff6f91","#f2cf5b","#5ef2e6","#ff8a4c"];

function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
function rangeLabel(){
  if(custom)return custom.start===custom.end?custom.start:`${custom.start} to ${custom.end}`;
  if(minutes===60)return "1 Hour";
  if(minutes===1440)return "24 Hours";
  if(minutes===10080)return "7 Days";
  if(minutes%1440===0)return `${minutes/1440} Days`;
  if(minutes%60===0)return `${minutes/60} Hours`;
  return `${minutes} Minutes`;
}
function rangeQuery(){return custom?`start=${custom.start}&end=${custom.end}`:`minutes=${minutes}`;}
function updateDownloadLabels(){
  const label=rangeLabel();
  const all=$("downloadAll");
  if(all)all.textContent=`Download ${label} - All Loggers Temp + RH CSV`;
  document.querySelectorAll(".logger-download").forEach(b=>{b.textContent=`Download ${label} Temp + RH CSV`;});
  $("rangeNow").textContent="Showing: "+label;
}
function downloadAllLoggers(){location.href=`/api/download-range-all.csv?${rangeQuery()}`;}
function localTodayISO(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function initializeHistoryCalendar(){
  const today=localTodayISO();
  ["historyDate","rangeStart","rangeEnd"].forEach(id=>{const el=$(id);if(el){el.max=today;if(!el.value)el.value=today;}});
  const wk=new Date(Date.now()-6*864e5);
  $("rangeStart").value=`${wk.getFullYear()}-${String(wk.getMonth()+1).padStart(2,"0")}-${String(wk.getDate()).padStart(2,"0")}`;
}
function populateHistoryLogger(){
  const sel=$("historyLogger");
  if(!sel||!lastData||!Array.isArray(lastData.devices))return;
  const current=sel.value||"ALL";
  sel.innerHTML='<option value="ALL">All Loggers</option>'+
    lastData.devices.map(d=>`<option value="${d.logger_sn}">${esc(d.name)} — ${d.logger_sn}</option>`).join("");
  if([...sel.options].some(o=>o.value===current))sel.value=current;
}
function downloadCalendarHistory(){
  const date=$("historyDate")?.value||"", sn=$("historyLogger")?.value||"ALL", msg=$("historyMessage");
  if(!date){if(msg)msg.innerHTML='<span class="bad">Select a calendar date first.</span>';return;}
  if(date>localTodayISO()){if(msg)msg.innerHTML='<span class="bad">Future dates are not available.</span>';return;}
  if(msg)msg.innerHTML='<span class="good">Preparing '+date+' history CSV…</span>';
  location.href=sn==="ALL"?`/api/download-date-all.csv?date=${encodeURIComponent(date)}`
    :`/api/download-date/${encodeURIComponent(sn)}?date=${encodeURIComponent(date)}`;
}
function toggleUnit(){useF=!useF;load()}

// ---- range: quick buttons or custom dates ----
function markRangeButtons(){
  document.querySelectorAll("[data-min]").forEach(x=>x.classList.toggle("primary",!custom&&Number(x.dataset.min)===minutes));
  $("customBtn").classList.toggle("primary",!!custom);
}
document.querySelectorAll("[data-min]").forEach(b=>b.onclick=()=>{
  minutes=Number(b.dataset.min);custom=null;$("customRange").classList.add("hidden");markRangeButtons();updateDownloadLabels();load();});
function toggleCustom(){$("customRange").classList.toggle("hidden");}
function applyCustomRange(){
  const start=$("rangeStart").value,end=$("rangeEnd").value,msg=$("rangeMsg");
  if(!start||!end){msg.innerHTML='<span class="bad">Pick a start and an end date.</span>';return;}
  if(end<start){msg.innerHTML='<span class="bad">The end date is before the start date.</span>';return;}
  if(end>localTodayISO()){msg.innerHTML='<span class="bad">Future dates are not available.</span>';return;}
  const days=(new Date(end)-new Date(start))/864e5+1;
  if(days>31){msg.innerHTML='<span class="bad">Choose 31 days or fewer.</span>';return;}
  msg.innerHTML=days>7?'<span class="good">Loading — long ranges can take up to a minute.</span>':"";
  custom={start,end};markRangeButtons();updateDownloadLabels();load();
}

// ---- loggers: chips, single / all / compare ----
async function load(){
  try{
    const r=await fetch("/api/current");lastData=await r.json();
    $("conn").innerHTML='<span class="good">● LI-COR CONNECTED</span>';
    populateHistoryLogger();
    if(selected!=="ALL"&&!lastData.devices.some(d=>d.logger_sn===selected))selected="ALL";
    compareSet=new Set([...compareSet].filter(sn=>lastData.devices.some(d=>d.logger_sn===sn)));
    renderChips();renderCards();await loadShown();
  }catch(e){$("conn").innerHTML='<span class="bad">● CONNECTION ERROR</span>'}
}
function shownDevices(){
  if(compareMode)return lastData.devices.filter(d=>compareSet.has(d.logger_sn));
  return selected==="ALL"?lastData.devices:lastData.devices.filter(d=>d.logger_sn===selected);
}
function chipState(d){
  if(d.comm_status&&d.comm_status!=="ONLINE")return "stale";
  if(d.alarm_type==="monitor")return "monitor";
  return d.alarm?"alarm":"ok";
}
function compareColor(sn){return COMPARE_COLORS[lastData.devices.findIndex(d=>d.logger_sn===sn)%COMPARE_COLORS.length];}
function renderChips(){
  $("compareBtn").classList.toggle("primary",compareMode);
  $("compareBtn").textContent=compareMode?"Compare: ON — tick loggers":"Compare loggers";
  const all=compareMode?"":`<button type="button" class="logger-chip ${selected==="ALL"?"active":""}" onclick="pickLogger('ALL')"><b>All loggers</b><small>${lastData.devices.length} loggers</small></button>`;
  $("loggerChips").innerHTML=all+lastData.devices.map(d=>{
    const t=Number(d.temperature), on=compareMode?compareSet.has(d.logger_sn):selected===d.logger_sn;
    const swatch=compareMode?`<i class="chip-swatch" style="background:${compareColor(d.logger_sn)}"></i>`:"";
    return `<button type="button" class="logger-chip chip-${chipState(d)} ${on?"active":""}" aria-pressed="${on}" onclick="pickLogger('${d.logger_sn}')">
      <b>${swatch}${compareMode?(on?"☑ ":"☐ "):""}${esc(d.name)}</b><small>${Number.isFinite(t)?cv(t).toFixed(1)+" "+unit():"--"}${d.alarm?" · ALARM":""}</small></button>`;}).join("");
}
function toggleCompare(){
  compareMode=!compareMode;
  if(compareMode&&!compareSet.size)(selected==="ALL"?lastData.devices.slice(0,2):lastData.devices.filter(d=>d.logger_sn===selected)).forEach(d=>compareSet.add(d.logger_sn));
  renderChips();renderCards();loadShown();
}
function pickLogger(sn){
  if(compareMode){
    compareSet.has(sn)?compareSet.delete(sn):compareSet.add(sn);
    localStorage.setItem("thermoiq.trends.compare",JSON.stringify([...compareSet]));
  }else{
    selected=sn; localStorage.setItem("thermoiq.trends.logger",sn);
    history.replaceState(null,"",sn==="ALL"?location.pathname:"#"+encodeURIComponent(sn));
    const sel=$("historyLogger"); if(sel&&[...sel.options].some(o=>o.value===sn))sel.value=sn;
  }
  renderChips();renderCards();loadShown();
}
function renderCards(){
  const grid=$("trendGrid");
  grid.classList.toggle("single",compareMode||selected!=="ALL");
  if(compareMode){
    const devs=shownDevices();
    grid.innerHTML=devs.length?`<article class="trend-card"><h3>Compare ${devs.length} logger${devs.length===1?"":"s"}</h3>
      <div class="compare-legend">${devs.map(d=>`<span><i style="background:${compareColor(d.logger_sn)}"></i>${esc(d.name)}</span>`).join("")}</div>
      <div class="chart-title">Temperature (${unit()}) — dashed lines are each logger's alarm limit</div><canvas id="t-compare"></canvas>
      <div class="chart-title">Relative Humidity (%)</div><canvas id="r-compare"></canvas></article>`
      :`<article class="trend-card"><h3>Tick two or more loggers above to compare them.</h3></article>`;
    return;
  }
  grid.innerHTML=shownDevices().map(d=>{
    const monitorOnly=d.alarm_type==="monitor";
    const temp=Number(d.temperature), rh=Number(d.rh);
    const tempText=Number.isFinite(temp)?cv(temp).toFixed(1):"--";
    const rhText=Number.isFinite(rh)?rh.toFixed(1):"--";
    const meta=monitorOnly
      ? `Current ${tempText} ${unit()} · RH ${rhText}% · ${d.model||"Monitor only"} · Monitor only`
      : `Current ${tempText} ${unit()} · RH ${rhText}% · ${d.alarm_type==="low"?"Low":"High"} limit ${cv(Number(d.limit)).toFixed(1)} ${unit()}`;
    return `<article class="trend-card"><h3>${esc(d.name)}</h3><div class="trend-meta">Logger ${d.logger_sn}${d.model?" · "+esc(d.model):""}<br>${meta}</div><div class="chart-title">Temperature</div><canvas id="t-${d.logger_sn}"></canvas><div class="chart-title">Relative Humidity</div><canvas id="r-${d.logger_sn}"></canvas><button class="download-btn logger-download" onclick="location.href='/api/download-range/${d.logger_sn}?'+rangeQuery()">Download ${rangeLabel()} Temp + RH CSV</button></article>`;
  }).join("");
}
async function fetchSeries(d){
  const r=await fetch(`/api/history/${d.logger_sn}?${rangeQuery()}`);
  if(!r.ok){const x=await r.json().catch(()=>({}));throw new Error(x.detail||"Unable to load history");}
  const x=await r.json(), pick=k=>x.data.filter(q=>(q.sensor_measurement_type||"").toLowerCase()===k);
  return {t:pick("temperature").map(q=>({t:new Date(q.timestamp),v:cv(Number(q.value))})),
          h:pick("rh").map(q=>({t:new Date(q.timestamp),v:Number(q.value)}))};
}
function limitOf(d){return (d.alarm_type==="high"||d.alarm_type==="low")?cv(Number(d.limit)):null;}
async function loadShown(){
  const devs=shownDevices(), msg=$("rangeMsg");
  try{
    if(compareMode){
      if(!devs.length)return;
      const all=await Promise.all(devs.map(fetchSeries));
      const span=chartSpan(all.flatMap(s=>s.t.concat(s.h)));
      drawSeries($("t-compare"),devs.map((d,i)=>({pts:all[i].t,color:compareColor(d.logger_sn),limit:limitOf(d)})),"temp",span);
      drawSeries($("r-compare"),devs.map((d,i)=>({pts:all[i].h,color:compareColor(d.logger_sn)})),"rh",span);
    }else{
      await Promise.all(devs.map(async d=>{
        const s=await fetchSeries(d), span=chartSpan(s.t.concat(s.h));
        drawSeries($("t-"+d.logger_sn),[{pts:s.t,color:"#3ab5ff",limit:limitOf(d),limitColor:"#ff5d67"}],"temp",span);
        drawSeries($("r-"+d.logger_sn),[{pts:s.h,color:"#8f7bff"}],"rh",span);
      }));
    }
    if(msg&&custom)msg.innerHTML="";
  }catch(e){if(msg)msg.innerHTML='<span class="bad">'+esc(e.message)+'</span>';}
}
function chartSpan(pts){
  if(custom){
    const a=new Date(custom.start+"T00:00:00"), b=new Date(custom.end+"T00:00:00"); b.setDate(b.getDate()+1);
    return [a.getTime(),Math.min(b.getTime(),Date.now())];
  }
  const now=Date.now(); return [now-minutes*60000,now];
}
// Time-based line chart; several series share one axis. series: [{pts:[{t,v}], color, limit, limitColor}]
function drawSeries(c,series,kind,span){
  if(!c)return;
  const big=compareMode||selected!=="ALL";
  const ctx=c.getContext("2d"),w=c.clientWidth,h=big?340:210,dp=devicePixelRatio||1;
  c.width=w*dp;c.height=h*dp;ctx.scale(dp,dp);ctx.clearRect(0,0,w,h);
  const vals=series.flatMap(s=>s.pts.map(p=>p.v)).filter(Number.isFinite);
  const limits=series.map(s=>s.limit).filter(v=>v!=null&&Number.isFinite(v));
  ctx.font="11px Segoe UI";ctx.fillStyle="#8fb2c9";
  if(!vals.length){ctx.fillText("No readings in this period",w/2-60,h/2);return;}
  let mn,mx;
  if(kind==="rh"){mn=Math.max(0,Math.min(...vals)-5);mx=Math.min(100,Math.max(...vals)+5);}
  else{mn=Math.min(...vals,...limits)-2;mx=Math.max(...vals,...limits)+2;}
  if(mx<=mn)mx=mn+10;
  const [t0,t1]=span, p={l:48,r:15,t:15,b:28},cw=w-p.l-p.r,ch=h-p.t-p.b;
  const X=t=>p.l+(t-t0)/Math.max(1,t1-t0)*cw, Y=v=>p.t+ch-(v-mn)/(mx-mn)*ch;
  ctx.strokeStyle="#27475d";ctx.lineWidth=1;
  for(let i=0;i<4;i++){const v=mn+(mx-mn)*i/3,y=Y(v);ctx.beginPath();ctx.moveTo(p.l,y);ctx.lineTo(w-p.r,y);ctx.stroke();ctx.fillText(v.toFixed(1)+(kind==="rh"?"%":"°"),4,y+4);}
  // time labels
  const days=(t1-t0)/864e5, n=Math.max(2,Math.min(7,Math.floor(cw/120)));
  for(let i=0;i<=n;i++){
    const t=t0+(t1-t0)*i/n, d=new Date(t);
    const label=days>2?d.toLocaleDateString([], {month:"short",day:"numeric"}):d.toLocaleTimeString([], {hour:"numeric",minute:"2-digit"});
    const tw=ctx.measureText(label).width; ctx.fillText(label,Math.min(Math.max(X(t)-tw/2,p.l),w-p.r-tw),h-8);
  }
  series.forEach(s=>{
    if(!s.pts.length)return;
    ctx.strokeStyle=s.color;ctx.lineWidth=series.length>1?2.2:2.7;ctx.beginPath();
    let prev=null;
    s.pts.forEach(q=>{
      if(!Number.isFinite(q.v))return;
      const x=X(q.t.getTime()),y=Y(q.v);
      // break the line across gaps longer than 1 hour (logger offline)
      if(prev===null||q.t-prev>36e5)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      prev=q.t;
    });
    ctx.stroke();
    if(kind==="temp"&&s.limit!=null&&Number.isFinite(s.limit)){
      ctx.setLineDash([6,4]);ctx.strokeStyle=s.limitColor||s.color;ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(p.l,Y(s.limit));ctx.lineTo(w-p.r,Y(s.limit));ctx.stroke();ctx.setLineDash([]);
    }
  });
}
window.addEventListener("hashchange",()=>{const sn=decodeURIComponent(location.hash.slice(1))||"ALL";if(sn!==selected&&lastData&&!compareMode)pickLogger(sn);});
initializeHistoryCalendar();
updateDownloadLabels();
load();
