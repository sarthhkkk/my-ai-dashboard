/* ===== opencode-diagnostic v1 =====
 * Standalone diagnostic tool for web UIs.
 * Include: <script src="diag.js"></script>
 * Shortcuts:
 *   Ctrl+Shift+D  — show diagnostic report
 *   Ctrl+Shift+I  — inspect element (click to capture)
 *   Esc           — exit inspect mode
 * API: window.__diag.show(extraData)
 * Repo: https://github.com/sarthhkkk/opencode-diagnostic
 */
(function(){
var errors=[],fetches=[],inspected=[],diag={},_inspect=null,_overlay=null,_info=null;

// Capture JS errors
window.onerror=function(msg,url,line,col,err){
  errors.push({t:Date.now(),type:'error',msg:msg,url:url||'',line:line})
};
// Capture unhandled rejections
window.onunhandledrejection=function(e){
  var msg=e.reason&&e.reason.message?e.reason.message:String(e.reason)
  errors.push({t:Date.now(),type:'unhandled',msg:msg})
};
// Intercept fetch to log failures
var _fetch=window.fetch;
window.fetch=function(u,o){
  return _fetch(u,o).then(function(r){if(!r.ok)fetches.push({t:Date.now(),url:typeof u==='string'?u:u.url,status:r.status});return r})
  .catch(function(err){fetches.push({t:Date.now(),url:typeof u==='string'?u:'fetch error',status:0});throw err})
};

function browserInfo(){
  return{ua:navigator.userAgent,vp:window.innerWidth+'x'+window.innerHeight,theme:document.documentElement.className||'',url:window.location.href}
}
function layoutState(){
  var s={};
  ['sidebar','msgsWrap','pipelineMain','diagMain','panel','msgs','sViews'].forEach(function(id){
    var el=document.getElementById(id)||document.querySelector('.'+id);
    if(!el)return;
    var r=el.getBoundingClientRect(),st=window.getComputedStyle(el);
    s[id]={v:el.style.display!=='none'&&st.display!=='none',w:Math.round(r.width),h:Math.round(r.height),o:st.overflowY,d:st.display}
  });
  return s
}

function inspectEl(el){
  if(!el)return null;
  var r=el.getBoundingClientRect(),st=window.getComputedStyle(el);
  var parents=[];
  var p=el;
  while(p&&p!==document.body){parents.push({tag:p.tagName,id:p.id||'',cls:p.className||'',nth:Array.from(p.parentNode.children).indexOf(p)+1});p=p.parentNode}
  return{
    tag:el.tagName,id:el.id||'',cls:el.className||'',text:(el.textContent||'').substring(0,200),
    rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)},
    css:{display:st.display,position:st.position,overflow:st.overflow,opacity:st.opacity,zIndex:st.zIndex},
    parents:parents
  }
}

diag.generate=function(extra){
  return{ts:new Date().toISOString(),browser:browserInfo(),errors:errors.slice(-30),fetches:fetches.slice(-30),layout:layoutState(),inspected:inspected.slice(),extra:extra||{}}
};

diag.show=function(extra){
  if(_inspect)diag.exitInspect();
  var r=diag.generate(extra),txt=JSON.stringify(r,null,2);
  var ov=document.createElement('div');
  ov.id='__diagOv';ov.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif';
  var box=document.createElement('div');
  box.style.cssText='background:#111;border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:24px;max-width:700px;width:90vw;max-height:80vh;display:flex;flex-direction:column;color:#e8e8ed;box-shadow:0 24px 80px rgba(0,0,0,0.6)';
  var hdr='<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px"><span style="font-size:20px">&#128295;</span><span style="font-size:16px;font-weight:700;flex:1">Diagnostic Report</span>';
  if(inspected.length)hdr+='<span style="font-size:10px;background:rgba(16,163,127,0.15);color:#22c55e;padding:2px 10px;border-radius:12px">'+inspected.length+' inspected</span>';
  hdr+='<button id="__diagClose" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:#aaa;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:14px">&times;</button></div>';
  box.innerHTML=hdr+
  '<div style="flex:1;overflow:auto;background:rgba(0,0,0,0.3);border-radius:8px;padding:12px;font-family:monospace;font-size:11px;line-height:1.6;white-space:pre-wrap;color:#ccc;margin-bottom:12px" id="__diagBody">'+escHtml(txt)+'</div>'+
  '<div style="display:flex;gap:8px;justify-content:space-between;align-items:center">'+
  '<span style="font-size:10px;color:#666">Ctrl+Shift+I inspect &bull; Ctrl+Shift+D report</span>'+
  '<div style="display:flex;gap:8px">'+
  '<button id="__diagHelp" title="How to use this tool" style="background:none;border:1px solid rgba(255,255,255,0.08);color:#666;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:14px">&#10067;</button>'+
  '<button id="__diagInspect" style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);color:#eab308;border-radius:8px;padding:8px 18px;cursor:pointer;font-size:12px">&#128270; Inspect</button>'+
  '<button id="__diagCopy" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:#e8e8ed;border-radius:8px;padding:8px 18px;cursor:pointer;font-size:12px">&#128203; Copy</button>'+
  '</div></div>';
  ov.appendChild(box);document.body.appendChild(ov);
  document.getElementById('__diagClose').onclick=function(){document.body.removeChild(ov)};
  document.getElementById('__diagCopy').onclick=function(){
    navigator.clipboard.writeText(txt).then(function(){
      var b=document.getElementById('__diagCopy');b.textContent='&#10003; Copied!';setTimeout(function(){b.innerHTML='&#128203; Copy'},2000)
    }).catch(function(){var ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta)})
  };
  document.getElementById('__diagInspect').onclick=function(){document.body.removeChild(ov);diag.inspect()};
  document.getElementById('__diagHelp').onclick=function(){
    alert('HOW TO USE\n\n1. Inspect: Ctrl+Shift+I, then click any element on the page to capture its info (HTML tag, CSS classes, dimensions, styles, parent chain).\n\n2. Report: Ctrl+Shift+D opens a full diagnostic report including all errors, failed API calls, layout state, pipeline status, and inspected elements.\n\n3. Share: Click Copy and paste the report into your OpenCode chat. Say something like:\n   "This element is broken: [paste]" or "Fix this layout: [paste]"\n\n4. The report gives me everything: browser, viewport, errors, layout sizes, element details. No screenshots needed.')
  };
  ov.addEventListener('click',function(e){if(e.target===ov)document.body.removeChild(ov)})
};

// ===== INSPECT MODE =====
diag.inspect=function(){
  if(_inspect)return;
  _inspect=true;
  // Overlay for highlighting
  _overlay=document.createElement('div');
  _overlay.id='__diagOv';
  _overlay.style.cssText='position:fixed;pointer-events:none;z-index:99998;border:2px solid #eab308;background:rgba(234,179,8,0.08);transition:all .08s;display:none';
  document.body.appendChild(_overlay);
  // Info pill
  _info=document.createElement('div');
  _info.id='__diagInfo';
  _info.style.cssText='position:fixed;pointer-events:none;z-index:99999;background:rgba(0,0,0,0.85);color:#eab308;padding:4px 10px;border-radius:6px;font-family:monospace;font-size:10px;white-space:nowrap;display:none;border:1px solid rgba(234,179,8,0.3)';
  document.body.appendChild(_info);
  // Banner
  var banner=document.createElement('div');
  banner.id='__diagBanner';
  banner.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;background:rgba(234,179,8,0.12);backdrop-filter:blur(10px);border-bottom:1px solid rgba(234,179,8,0.3);padding:8px 16px;display:flex;align-items:center;gap:12px;font-family:system-ui,sans-serif;font-size:12px;color:#eab308';
  banner.innerHTML='<span style="font-weight:600">&#128270; Inspect Mode</span><span style="color:rgba(255,255,255,0.5)">Click any element to capture its info</span><span style="flex:1"></span><span style="font-size:10px;color:rgba(255,255,255,0.3)">Esc to exit</span>';
  var exitBtn=document.createElement('button');
  exitBtn.textContent='Exit';
  exitBtn.style.cssText='background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);color:#e8e8ed;border-radius:6px;padding:4px 14px;cursor:pointer;font-size:11px';
  exitBtn.onclick=diag.exitInspect;
  banner.appendChild(exitBtn);
  document.body.appendChild(banner);

  function onMove(e){
    var el=document.elementFromPoint(e.clientX,e.clientY);
    if(!el||el===_overlay||el===_info||el===banner||el===exitBtn||el.closest&&el.closest('#__diagBanner,#__diagInfo,#__diagOv'))return;
    var r=el.getBoundingClientRect();
    _overlay.style.display='block';
    _overlay.style.left=r.left+'px';_overlay.style.top=r.top+'px';
    _overlay.style.width=r.width+'px';_overlay.style.height=r.height+'px';
    var tag=el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(el.className&&typeof el.className==='string'?'.'+el.className.split(' ').filter(Boolean).join('.'):'');
    _info.style.display='block';
    _info.style.left=Math.min(e.clientX,window.innerWidth-400)+'px';
    _info.style.top=Math.max(0,e.clientY-28)+'px';
    _info.textContent=tag+'  \u2022  '+Math.round(r.width)+'\u00d7'+Math.round(r.height);
  }
  function onClick(e){
    e.preventDefault();e.stopPropagation();
    var el=document.elementFromPoint(e.clientX,e.clientY);
    if(!el||el===_overlay||el===_info||el.closest('#__diagBanner'))return;
    var data=inspectEl(el);
    if(data)inspected.push(data);
    diag.exitInspect();
    diag.show();
  }
  function onKey(e){
    if(e.key==='Escape')diag.exitInspect();
  }
  document.addEventListener('mousemove',onMove,true);
  document.addEventListener('click',onClick,true);
  document.addEventListener('keydown',onKey);
  _inspectCleanup=function(){document.removeEventListener('mousemove',onMove,true);document.removeEventListener('click',onClick,true);document.removeEventListener('keydown',onKey)};
};

diag.exitInspect=function(){
  if(!_inspect)return;
  _inspect=false;
  if(_inspectCleanup)_inspectCleanup();
  if(_overlay&&_overlay.parentNode)document.body.removeChild(_overlay);
  if(_info&&_info.parentNode)document.body.removeChild(_info);
  var b=document.getElementById('__diagBanner');if(b&&b.parentNode)document.body.removeChild(b);
  _overlay=null;_info=null;
};

diag.clearInspected=function(){inspected=[]};

function escHtml(s){if(!s)return'';var d=document.createElement('div');d.textContent=s;return d.innerHTML}

// Keyboard shortcuts
document.addEventListener('keydown',function(e){
  if(e.ctrlKey&&e.shiftKey&&e.key==='D'){e.preventDefault();if(typeof switchView==='function')switchView('diag');else diag.show()}
  if(e.ctrlKey&&e.shiftKey&&e.key==='I'){e.preventDefault();if(_inspect)diag.exitInspect();else diag.inspect()}
  if(e.key==='Escape'&&_inspect)diag.exitInspect()
});

window.__diag=diag;
})();
