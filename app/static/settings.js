const $=id=>document.getElementById(id);
let currentRole=null;
let currentUsername=null;
let deviceMap={};

async function status(){
  const r=await fetch("/api/admin/status",{cache:"no-store"});
  const x=await r.json();
  if(!x.configured){
    $("loginMsg").innerHTML='<span class="bad">Admin password is not configured. Run SET_ADMIN_PASSWORD.bat on the mini-PC.</span>';
  }
  if(x.logged_in){
    showSettings(x.username,x.role);
    await loadConfig();
  }
}

async function login(){
  $("loginMsg").textContent="Signing in…";
  const r=await fetch("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:$("adminUser").value,password:$("adminPass").value})});
  const x=await r.json().catch(()=>({}));
  if(!r.ok){$("loginMsg").innerHTML='<span class="bad">'+(x.detail||"Login failed")+'</span>';return;}
  $("adminPass").value="";
  showSettings(x.username,x.role);
  await loadConfig();
}

function showSettings(user,role){
  currentUsername=user; currentRole=role;
  $("loginBox").classList.add("hidden");
  $("settingsBox").classList.remove("hidden");
  $("loggedInUser").textContent="Logged in: "+user;
  $("roleBadge").textContent=(role||"").toUpperCase();
  $("roleBadge").classList.toggle("operator",role==="operator");
  $("securityPanel").classList.toggle("hidden",role!=="admin");
  $("reportPanel").classList.toggle("hidden",role!=="admin");
  $("notifyPanel").classList.toggle("hidden",role!=="admin");
  $("roleDescription").textContent=role==="admin"
    ? "Administrator access: setpoints, RUNNING / NOT IN USE, calibration offsets, schedules, alarm recipients and account passwords."
    : "Operator access: alarm notification scheduler only. Setpoints, calibration, equipment mode and passwords are locked.";
}

async function logout(){await fetch("/api/admin/logout",{method:"POST"});location.reload();}

const dayNames=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const WEEKDAYS_24H=dayNames.map((_,i)=>({on:i<5,start:"00:00",end:"00:00"}));
function signed(v,suffix){const n=Number(v||0);return `${n>=0?"+":""}${n.toFixed(1)} ${suffix}`;}

// One row per day: alarms ON/OFF, 24 h, Alarm ON time, Alarm OFF time.
function weekEditor(d){
  const week=d.schedule_week||WEEKDAYS_24H;
  const rows=week.map((day,i)=>{const all=day.start===day.end;return `
    <div class="week-row" data-day="${i}">
      <b class="week-day">${dayNames[i]}</b>
      <label class="day-chip day-switch week-on"><input type="checkbox" class="wk-on" ${day.on?"checked":""} onchange="refreshWeekRow('${d.logger_sn}',${i})"><span><em class="day-state"></em></span></label>
      <label class="week-24"><input type="checkbox" class="wk-24" ${all?"checked":""} onchange="refreshWeekRow('${d.logger_sn}',${i})">24 h</label>
      <input type="time" class="wk-start" value="${day.start}" aria-label="${dayNames[i]} alarm ON time">
      <input type="time" class="wk-end" value="${all&&day.start==="00:00"?"00:00":day.end}" aria-label="${dayNames[i]} alarm OFF time">
    </div>`;}).join("");
  return `<div class="week-table" id="week-${d.logger_sn}">
    <div class="week-row week-header"><span>Day</span><span>Alarms</span><span>All day</span><span>Alarm ON</span><span>Alarm OFF</span></div>${rows}</div>`;
}
function weekRows(sn){return [...document.querySelectorAll(`#week-${sn} .week-row[data-day]`)];}
function refreshWeekRow(sn,i){
  const row=weekRows(sn)[i]; if(!row)return;
  const on=row.querySelector(".wk-on").checked, all=row.querySelector(".wk-24").checked;
  row.classList.toggle("week-off",!on);
  row.querySelector(".wk-24").disabled=!on;
  row.querySelector(".wk-start").disabled=!on||all;
  row.querySelector(".wk-end").disabled=!on||all;
}
function refreshWeek(sn){weekRows(sn).forEach((_,i)=>refreshWeekRow(sn,i));}
function readWeek(sn){
  return weekRows(sn).map(row=>{
    const on=row.querySelector(".wk-on").checked, all=row.querySelector(".wk-24").checked;
    const start=row.querySelector(".wk-start").value||"00:00", end=row.querySelector(".wk-end").value||"00:00";
    return all?{on,start:"00:00",end:"00:00"}:{on,start,end};
  });
}
function setWeek(sn,week){
  weekRows(sn).forEach((row,i)=>{const day=week[i];
    row.querySelector(".wk-on").checked=day.on;
    row.querySelector(".wk-24").checked=day.start===day.end;
    row.querySelector(".wk-start").value=day.start; row.querySelector(".wk-end").value=day.end;});
  refreshWeek(sn);
}
function weekProblem(week){
  for(let i=0;i<7;i++){const d=week[i]; if(d.on&&d.start===d.end&&d.start!=="00:00")return `${dayNames[i]}: Alarm ON and OFF times are the same. Tick "24 h" for all day.`;}
  return "";
}
function presetWeekdays24h(sn){$("schedule-enabled-"+sn).value="on";setWeek(sn,WEEKDAYS_24H);$("msg-"+sn).innerHTML='<span class="good">Mon–Fri 24 h ON · Sat–Sun OFF selected. Click Save.</span>';}
function copyMondayTo(sn,days){
  const week=readWeek(sn),mon=week[0];
  days.forEach(i=>{week[i]={...mon};}); setWeek(sn,week);
  $("msg-"+sn).innerHTML=`<span class="good">Monday copied to ${days.map(i=>dayNames[i]).join(", ")}. Click Save.</span>`;
}

async function postAllSchedules(payload,label){
  const msg=$("allScheduleMsg");
  msg.textContent="Applying schedule to all loggers…";
  const r=await fetch("/api/admin/schedule/all",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const x=await r.json().catch(()=>({}));
  if(!r.ok){msg.innerHTML='<span class="bad">'+(x.detail||"Unable to apply schedule")+'</span>';return false;}
  msg.innerHTML='<span class="good">Applied to '+x.count+' loggers: '+label+'</span>';
  await loadConfig();
  return true;
}
async function applyWeekday24hAll(){
  if(!confirm("Apply notifications ON Monday-Friday 24 hours and OFF Saturday-Sunday to ALL loggers?"))return;
  await postAllSchedules({schedule_enabled:true,schedule_week:WEEKDAYS_24H},"Mon–Fri ON 24 h · Sat–Sun OFF.");
}
async function applyCardScheduleToAll(sn){
  const d=deviceMap[String(sn)]||{}, week=readWeek(sn), schedule_enabled=$("schedule-enabled-"+sn).value==="on";
  const problem=weekProblem(week); if(problem){$("msg-"+sn).innerHTML='<span class="bad">'+problem+'</span>';return;}
  if(!confirm(`Copy the weekly schedule shown on ${d.name||sn} to ALL loggers?`))return;
  if(await postAllSchedules({schedule_enabled,schedule_week:week},`schedule copied from ${d.name||sn}.`))
    $("allScheduleMsg").scrollIntoView({behavior:"smooth",block:"center"});
}

function adminControls(d){
  if(currentRole!=="admin")return "";
  const monitorOnly=d.alarm_type==="monitor";
  const alarmFields=monitorOnly
    ? `<div class="monitor-only-note"><b>Temperature + Humidity Monitor</b><br>${d.model||"Logger"} is displayed and logged without a temperature alarm setpoint. Calibration offsets remain available below.</div>`
    : `<label>Temperature alarm setpoint (°C)<input id="limit-${d.logger_sn}" type="number" step="0.1" min="-40" max="100" value="${Number(d.limit).toFixed(1)}"></label>
       <label>Equipment operating mode<select id="mode-${d.logger_sn}"><option value="running" ${d.monitoring_enabled?"selected":""}>RUNNING — permit alarms</option><option value="idle" ${d.monitoring_enabled?"":"selected"}>NOT IN USE — suppress all alarms</option></select></label>`;
  return `<div class="admin-only-block"><div class="control-section-title">Admin Controls</div>${alarmFields}
    <div class="calibration-box"><div class="schedule-title">Reading Calibration Offset</div><p class="calibration-help">Adjusted reading = LI-COR raw reading + offset. Use a negative value when the logger reads high; positive when it reads low.</p>
      <div class="calibration-grid"><label>Temperature offset (°C)<input id="temp-offset-${d.logger_sn}" type="number" step="0.1" min="-20" max="20" value="${Number(d.temperature_offset||0).toFixed(1)}"></label>
      <label>Humidity offset (%RH)<input id="rh-offset-${d.logger_sn}" type="number" step="0.1" min="-50" max="50" value="${Number(d.humidity_offset||0).toFixed(1)}"></label></div>
      <div class="calibration-status">Current calibration: Temperature ${signed(d.temperature_offset,"°C")} · Humidity ${signed(d.humidity_offset,"%RH")}</div>
    </div></div>`;
}

function scheduleControls(d){
  if(d.alarm_type==="monitor") return `<div class="schedule-box monitor-only-schedule"><div class="schedule-title">Alarm Notification Scheduler</div><div class="schedule-current good">Not required for this monitor-only logger.</div></div>`;
  const sn=d.logger_sn;
  return `<div class="schedule-box"><div class="schedule-title">Alarm Notification Scheduler <span class="access-tag">Admin + Operator</span></div>
    <label>Weekly scheduler<select id="schedule-enabled-${sn}"><option value="off" ${d.schedule_enabled?"":"selected"}>OFF — manual mode only</option><option value="on" ${d.schedule_enabled?"selected":""}>ON — follow the daily times below</option></select></label>
    <div class="schedule-label">Daily Alarm ON / OFF times · Pacific Time</div>
    ${weekEditor(d)}
    <p class="week-help">An OFF time earlier than the ON time runs overnight, e.g. ON 22:00 · OFF 06:00 keeps alarms on until 06:00 the next morning.</p>
    <div class="week-tools">
      <button class="schedule-preset-btn" type="button" onclick="copyMondayTo('${sn}',[1,2,3,4])">Copy Mon → Tue–Fri</button>
      <button class="schedule-preset-btn" type="button" onclick="copyMondayTo('${sn}',[1,2,3,4,5,6])">Copy Mon → every day</button>
      <button class="schedule-preset-btn" type="button" onclick="presetWeekdays24h('${sn}')">Preset: Mon–Fri 24 h · Sat–Sun OFF</button>
      <button class="schedule-preset-btn" type="button" onclick="applyCardScheduleToAll('${sn}')">Apply this schedule to ALL loggers</button>
    </div>
    <div class="schedule-current ${d.schedule_active_now?"good":"warn"}">${d.schedule_enabled?`Scheduler is ${d.schedule_active_now?"ACTIVE":"OFF"} now · ${d.schedule_summary}`:"Scheduler OFF — manual operating mode controls alarms"}</div></div>`;
}

async function loadConfig(){
  const r=await fetch("/api/admin/config",{cache:"no-store"});
  if(r.status===401||r.status===403){location.reload();return;}
  const x=await r.json(); currentRole=x.role; currentUsername=x.username; showSettings(x.username,x.role);
  deviceMap=Object.fromEntries((x.devices||[]).map(d=>[String(d.logger_sn),d]));
  if($("operatorUsername"))$("operatorUsername").value=x.operator_username||"operator";
  if($("adminUsernameEdit"))$("adminUsernameEdit").value=x.username||"";
  if(x.report_config&&$("reportEnabled")){
    $("reportEnabled").value=x.report_config.enabled?"on":"off";
    $("reportTime").value=x.report_config.time||"08:00";
    $("reportRecipient").value=x.report_config.recipient||"";
    $("reportHours").value=String(x.report_config.hours||24);
  }
  if(x.notification_config)fillNotifications(x.notification_config);
  const visibleDevices=currentRole==="operator" ? x.devices.filter(d=>d.alarm_type!=="monitor") : x.devices;
  $("configGrid").innerHTML=visibleDevices.map(d=>{const monitorOnly=d.alarm_type==="monitor";const headText=monitorOnly?`${d.model||"Logger"} · TEMPERATURE + HUMIDITY MONITOR`:`${d.alarm_type.toUpperCase()} alarm`;const badge=monitorOnly?"MONITOR":(d.effective_mode||"RUNNING");return `<article class="config-card ${(!monitorOnly&&!d.effective_monitoring_enabled)?"config-disabled":""}"><div class="config-head"><div><h3>${d.name}</h3><small>Logger ${d.logger_sn} · ${headText}</small></div><span class="pill ${(!monitorOnly&&!d.effective_monitoring_enabled)?"warn":""}">${badge}</span></div>
    ${adminControls(d)}${scheduleControls(d)}
    <div class="config-warning">${monitorOnly?"Temperature and humidity are displayed/logged. Admin can apply calibration offsets; no temperature alarm is configured.":(currentRole==="operator"?"Operator access: schedule changes only.":(!d.monitoring_enabled?"Temperature is still displayed/logged, but alarms are suppressed by NOT IN USE.":"Admin controls are enabled. Calibration offsets affect displayed/logged readings and temperature alarm evaluation."))}</div>
    <button class="primary" onclick="saveDevice('${d.logger_sn}')">${monitorOnly?"Save Calibration":(currentRole==="admin"?"Save All Settings":"Save Schedule")} — ${d.name}</button><div id="msg-${d.logger_sn}" class="admin-message"></div></article>`;}).join("");
  visibleDevices.filter(d=>d.alarm_type!=="monitor").forEach(d=>refreshWeek(d.logger_sn));
}

async function saveDevice(sn){
  const d=deviceMap[String(sn)]||{};
  const monitorOnly=d.alarm_type==="monitor";
  const msg=$("msg-"+sn);
  const payload={};

  if(!monitorOnly){
    const schedule_enabled=$("schedule-enabled-"+sn).value==="on";
    const schedule_week=readWeek(sn);
    const problem=weekProblem(schedule_week);
    if(problem){msg.innerHTML='<span class="bad">'+problem+'</span>';return;}
    if(schedule_enabled&&!schedule_week.some(day=>day.on)){msg.innerHTML='<span class="bad">Turn alarms ON for at least one day.</span>';return;}
    Object.assign(payload,{schedule_enabled,schedule_week});
  }

  if(currentRole==="admin"){
    if(!monitorOnly){payload.limit=Number($("limit-"+sn).value);payload.monitoring_enabled=$("mode-"+sn).value==="running";}
    payload.temperature_offset=Number($("temp-offset-"+sn).value);
    payload.humidity_offset=Number($("rh-offset-"+sn).value);
  }
  msg.textContent="Saving…";
  const r=await fetch("/api/admin/config/"+sn,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const x=await r.json().catch(()=>({}));
  if(!r.ok){msg.innerHTML='<span class="bad">'+(x.detail||"Save failed")+'</span>';return;}
  msg.innerHTML='<span class="good">Saved and recorded in Event Log.</span>';setTimeout(loadConfig,700);
}

async function changePassword(){
  const msg=$("passwordMsg");
  const new_username=($("adminUsernameEdit")?.value||"").trim();
  const current_password=$("currentPassword").value;
  const new_password=$("newPassword").value;
  const confirm_password=$("confirmPassword").value;
  if(!new_username){msg.innerHTML='<span class="bad">Enter an Admin username.</span>';return;}
  if(new_username.length>64){msg.innerHTML='<span class="bad">Admin username must be 64 characters or fewer.</span>';return;}
  if(/[\r\n]/.test(new_username)){msg.innerHTML='<span class="bad">Admin username cannot contain line breaks.</span>';return;}
  if(!current_password||!new_password||!confirm_password){msg.innerHTML='<span class="bad">Complete all Admin password fields.</span>';return;}
  if(!/^[A-Za-z0-9]{6}$/.test(new_password)){msg.innerHTML='<span class="bad">New Admin password must be exactly 6 letters or numbers.</span>';return;}
  if(new_password!==confirm_password){msg.innerHTML='<span class="bad">New Admin passwords do not match.</span>';return;}
  const r=await fetch("/api/admin/change-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({new_username,current_password,new_password,confirm_password})});
  const x=await r.json().catch(()=>({}));
  if(!r.ok){msg.innerHTML='<span class="bad">'+(x.detail||"Admin login change failed")+'</span>';return;}
  $("currentPassword").value=$("newPassword").value=$("confirmPassword").value="";
  if($("adminUsernameEdit"))$("adminUsernameEdit").value=x.username||new_username;
  msg.innerHTML='<span class="good">Admin username/password updated successfully.</span>';
}

async function setOperatorPassword(){
  const msg=$("operatorPasswordMsg"),username=$("operatorUsername").value.trim()||"operator",new_password=$("operatorPassword").value,confirm_password=$("operatorConfirm").value;
  if(!username){msg.innerHTML='<span class="bad">Enter an Operator username.</span>';return;}
  if(username.length>64||/[\\r\\n]/.test(username)){msg.innerHTML='<span class="bad">Operator username must be 1-64 printable characters without line breaks.</span>';return;}
  if(!new_password||!confirm_password){msg.innerHTML='<span class="bad">Enter and confirm the Operator password.</span>';return;}
  if(!/^[A-Za-z0-9]{6}$/.test(new_password)){msg.innerHTML='<span class="bad">Operator password must be exactly 6 letters or numbers.</span>';return;}
  if(new_password!==confirm_password){msg.innerHTML='<span class="bad">Operator passwords do not match.</span>';return;}
  const r=await fetch("/api/admin/operator-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,new_password,confirm_password})});
  const x=await r.json().catch(()=>({}));if(!r.ok){msg.innerHTML='<span class="bad">'+(x.detail||"Unable to save Operator login")+'</span>';return;}
  $("operatorPassword").value=$("operatorConfirm").value="";msg.innerHTML='<span class="good">Operator login saved. Username: '+x.username+'</span>';
}


async function saveReportConfig(){
  const msg=$("reportConfigMsg");
  const payload={
    enabled:$("reportEnabled").value==="on",
    time:$("reportTime").value||"08:00",
    recipient:$("reportRecipient").value.split(/[\s,;]+/).filter(Boolean),
    hours:Number($("reportHours").value||24)
  };
  msg.textContent="Saving…";
  const r=await fetch("/api/admin/report-config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const x=await r.json().catch(()=>({}));
  if(!r.ok){msg.innerHTML='<span class="bad">'+(x.detail||"Unable to save report settings")+'</span>';return;}
  msg.innerHTML='<span class="good">Daily report saved. Next automatic email follows the Pacific Time schedule.</span>';
}

async function sendReportNow(){
  const msg=$("reportSendMsg");
  msg.textContent="Building 24-hour report and sending email…";
  const r=await fetch("/api/admin/send-maintenance-report",{method:"POST"});
  const x=await r.json().catch(()=>({}));
  if(!r.ok){msg.innerHTML='<span class="bad">'+(x.detail||"Report email failed")+'</span>';return;}
  msg.innerHTML='<span class="good">Report emailed to '+x.recipient+'.</span>';
}

// ---- Alarm notifications: email + text message (Admin only) ----
// Carrier email-to-text domains. Confirm each phone with "Send Test Text".
const SMS_CARRIERS=[
  ["Bell","txt.bell.ca"],["Rogers","pcs.rogers.com"],["Telus","msg.telus.com"],["Fido","fido.ca"],
  ["Koodo","msg.koodomobile.com"],["Virgin Plus","vmobile.ca"],["Freedom Mobile","txt.freedommobile.ca"],
  ["Public Mobile","msg.telus.com"],["Chatr","pcs.rogers.com"],["SaskTel","sms.sasktel.com"],
  ["Verizon (US)","vtext.com"],["T-Mobile (US)","tmomail.net"]];
function lines(id){return $(id).value.split(/[\s,;]+/).map(s=>s.trim()).filter(Boolean);}
function fillNotifications(n){
  $("senderLine").innerHTML=n.sender_configured
    ? `Sent from <b>${escapeHtml(n.sender_name)}</b> &lt;${escapeHtml(n.sender_email)}&gt; via ${escapeHtml(n.smtp_host)}`
    : '<span class="bad">No sending account. Set GMAIL_SENDER and GMAIL_APP_PASSWORD in .env, then restart.</span>';
  $("senderName").value=n.sender_name||"ThermoIQ Alerts";
  $("emailEnabled").value=n.email_enabled?"on":"off";
  $("smsEnabled").value=n.sms_enabled?"on":"off";
  $("emailRecipients").value=(n.email_recipients||[]).join("\n");
  $("smsRecipients").value=(n.sms_recipients||[]).join("\n");
  if(!$("smsCarrier").options.length)
    $("smsCarrier").innerHTML=SMS_CARRIERS.map(([name,domain])=>`<option value="${domain}">${name} — @${domain}</option>`).join("");
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function addSmsRecipient(){
  let digits=$("smsPhone").value.replace(/\D/g,"");
  if(digits.length===11&&digits.startsWith("1"))digits=digits.slice(1);
  if(digits.length!==10){$("smsMsg").innerHTML='<span class="bad">Enter a 10-digit mobile number.</span>';return;}
  const addr=`${digits}@${$("smsCarrier").value}`;
  const list=lines("smsRecipients");
  if(!list.includes(addr))list.push(addr);
  $("smsRecipients").value=list.join("\n"); $("smsPhone").value="";
  $("smsMsg").innerHTML=`<span class="good">Added ${addr}. Click Save Notification Settings.</span>`;
}
async function saveNotifications(msgId){
  const msg=$(msgId); msg.textContent="Saving…";
  const payload={sender_name:$("senderName").value.trim(),email_enabled:$("emailEnabled").value==="on",
    email_recipients:lines("emailRecipients"),sms_enabled:$("smsEnabled").value==="on",sms_recipients:lines("smsRecipients")};
  const r=await fetch("/api/admin/notifications",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const x=await r.json().catch(()=>({}));
  if(!r.ok){msg.innerHTML='<span class="bad">'+escapeHtml(x.detail||"Unable to save")+'</span>';return false;}
  fillNotifications(x.notification_config);
  msg.innerHTML=`<span class="good">Saved: ${x.notification_config.email_recipients.length} email and ${x.notification_config.sms_recipients.length} text recipient(s).</span>`;
  return true;
}
async function testNotification(kind){
  const msgId=kind==="email"?"emailMsg":"smsMsg", msg=$(msgId);
  if(!await saveNotifications(msgId))return;
  msg.textContent=kind==="email"?"Sending test email…":"Sending test text…";
  const r=await fetch(`/api/admin/notifications/test-${kind}`,{method:"POST"});
  const x=await r.json().catch(()=>({}));
  if(!r.ok){msg.innerHTML='<span class="bad">'+escapeHtml(x.detail||"Test failed")+'</span>';return;}
  const failed=(x.errors||[]).length?` · ${x.errors.length} failed: ${escapeHtml(x.errors[0])}`:"";
  msg.innerHTML=`<span class="${failed?"warn":"good"}">Test sent to ${x.sent} recipient(s)${failed}.</span>`;
}

status();
