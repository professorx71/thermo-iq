// Collapsible sections: <details data-fold="name">. Open/closed state is remembered on this computer.
function initFolds(root=document){
  root.querySelectorAll("details[data-fold]").forEach(el=>{
    const key="thermoiq.fold."+el.dataset.fold, saved=localStorage.getItem(key);
    if(saved!==null)el.open=saved==="1";
    if(!el.dataset.foldBound){el.dataset.foldBound="1";el.addEventListener("toggle",()=>localStorage.setItem(key,el.open?"1":"0"));}
  });
}
function setAllFolds(open){document.querySelectorAll("main details[data-fold]").forEach(el=>{if(!el.classList.contains("hidden"))el.open=open;});}
initFolds();
