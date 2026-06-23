var sessions=[],currentSession=null,delTarget=null,refreshInt=null,autoRefresh=true,panelOpen=false,sid='',sTitle='',msgData=[],expandAll=false,dense=false,theme=localStorage.getItem('myd-theme')||'dark',codeMap={},codeIdx=0,curView='chats',dateRange='',projectsCache=[],_token=localStorage.getItem('myd-token')||''

function id(e){return document.getElementById(e)}
function esc(t){if(!t)return'';var d=document.createElement('div');d.textContent=t;return d.innerHTML}
function fmtNum(n){if(!n)return'0';return Number(n).toLocaleString()}
function fmtCost(n){if(!n||n==='0')return'$0';return'$'+parseFloat(n).toFixed(n<0.01?6:4)}
function fmtFile(f){return f.replace(/^.*[/\\]/,'').substring(0,30)}
function applyTheme(t){theme=t;document.documentElement.className=t;localStorage.setItem('myd-theme',t);id('themeBtn').innerHTML=t==='dark'?'&#9790;':'&#9788;'}
function tTheme(){applyTheme(theme==='dark'?'light':'dark');setTimeout(fixSpotColor,50)}
function prettyModel(m){
  if(!m)return''
  try{var o=JSON.parse(m);return o.id||o.name||o.model||m}catch(e){return m}
}
function fmtTime(t){
  var d=new Date(Number(t)),now=new Date(),opts={hour:'2-digit',minute:'2-digit'}
  if(d.toDateString()===now.toDateString())return d.toLocaleString(undefined,opts)
  var y=new Date(now);y.setDate(y.getDate()-1)
  if(d.toDateString()===y.toDateString())return'Yesterday '+d.toLocaleString(undefined,opts)
  return d.toLocaleString(undefined,{month:'short',day:'numeric'})+' '+d.toLocaleString(undefined,opts)
}
function msgDateSep(t){
  var d=new Date(Number(t)),now=new Date(),y=new Date(now);y.setDate(y.getDate()-1)
  var timeStr=d.toLocaleString(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'})
  if(d.toDateString()===now.toDateString())return'<div class="msg-date-sep"><span>Today</span><span class="msg-date-time">'+timeStr+'</span></div>'
  if(d.toDateString()===y.toDateString())return'<div class="msg-date-sep"><span>Yesterday</span><span class="msg-date-time">'+timeStr+'</span></div>'
  return'<div class="msg-date-sep"><span>'+d.toLocaleString(undefined,{month:'long',day:'numeric',year:'numeric'})+'</span><span class="msg-date-time">'+timeStr+'</span></div>'
}
function renderMsg(m,i,lastDate){
  var role=m.role||'assistant',type=m.part_type||'text',dr=type==='tool'||type==='tool-result'?'tool':role,isR=type==='reasoning',cls=isR?'reasoning':dr
  var content=m.text||'(empty)'
  var ts=m.msg_time?new Date(Number(m.msg_time)):null
  var timeStr=ts?ts.toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}):''
  var meta=content&&content!=='(empty)'&&role!=='tool'?'<span class="msg-meta">'+(content.length>999?Math.round(content.length/1000)+'k':content.length)+' chars</span>':''
  var hc=''
  if(dr==='tool'){
    var cmd=m.command||'',out=m.output||'',exit=m.exit_code,desc=m.cmd_description||'',toolName=m.tool_name||'bash'
    var header='<div class="tc-header"><span class="tc-prompt">$</span> '+esc(cmd)+(desc?' <span class="tc-desc">// '+esc(desc)+'</span>':'')+'</div>'
    var body=''
    if(out)body+='<div class="tc-output">'+esc(out)+'</div>'
    if(exit!==null&&exit!==undefined)body+='<div class="tc-status'+(exit==0?' tc-ok':' tc-err')+'">exit code: '+exit+'</div>'
    hc='<div class="mc collapsed terminal-msg" onclick="this.classList.toggle(\'collapsed\')">'+header+(body?'<div class="tc-body">'+body+'</div>':'')+'<span class="eh">&#9660; click to expand</span></div>'
  }
  else if(isR){hc='<div class="mc">'+esc(content)+'</div>'}
  else{hc='<div class="mc">'+md(content)+'</div>'}
  return '<div class="msg '+cls+'"><div class="av">'+(role==='user'?'U':role==='tool'?'T':'A')+'</div><div class="b"><div class="lbl">'+(role==='user'?'You':role==='tool'?'Terminal':'Assistant')+' <span class="tm">'+timeStr+'</span>'+meta+'</div>'+hc+'</div><button class="cmsg" onclick="cpMsg(this)" title="Copy message content">Copy</button></div>'
}
function relTime(t){var d=Date.now()-Number(t),m=Math.floor(d/6e4);if(m<1)return'just now';var h=Math.floor(m/60);if(h<1)return m+'m';var day=Math.floor(h/24);if(day<1)return h+'h';if(day<30)return day+'d';return Math.floor(day/30)+'mo'}
function toast(msg,type){var e=id('toast');e.textContent=msg;e.className='toast '+(type||'')+' show';clearTimeout(e._t);e._t=setTimeout(function(){e.classList.remove('show')},2500)}
function cSidebar(){id('sidebar').classList.remove('open');id('sBackdrop').classList.remove('show')}
function tSidebar(){id('sidebar').classList.toggle('open');id('sBackdrop').classList.toggle('show')}
function runMyAI(){window.open('opencode://','_blank')}
function scrollToBottom(){var el=id('msgs');el.scrollTop=el.scrollHeight;id('scrollBottom').classList.remove('show')}
function onMsgScroll(){var el=id('msgs');id('scrollBottom').classList.toggle('show',el.scrollTop<el.scrollHeight-el.clientHeight-200)}

function getGroup(t){var now=Date.now(),d=Number(t),diff=now-d;if(diff<864e5)return'Today';if(diff<1728e5)return'Yesterday';if(diff<6048e5)return'This Week';if(diff<2592e6)return'This Month';return'Older'}

// View switching
function switchView(view){
  if(view!=='pipeline'&&pipelineInt){clearInterval(pipelineInt);pipelineInt=null}
  curView=view
  document.querySelectorAll('.s-nav-btn').forEach(function(b){b.classList.toggle('active',b.dataset.view===view)})
  document.querySelectorAll('.s-view').forEach(function(v){v.classList.toggle('active',v.id==='view'+view.charAt(0).toUpperCase()+view.slice(1))})
  var search=id('sSearch'),fa=id('chatsFilterArea')
  // Reset main content for all views
  if(id('pipelineMain'))id('pipelineMain').classList.remove('show')
  if(id('diagMain'))id('diagMain').classList.remove('show')
  id('msgsWrap').classList.remove('hidden')
  id('msgSearchWrap').style.display=''
  if(id('mActions'))id('mActions').style.display=''
  // Apply per-view settings
  if(view==='chats'){search.placeholder='Search sessions...';fa.style.display='block';loadSessions()}
  else if(view==='uploads'){search.placeholder='Search...';fa.style.display='none';loadUploads()}
  else if(view==='pipeline'){search.placeholder='';fa.style.display='none';id('msgsWrap').classList.add('hidden');id('msgSearchWrap').style.display='none';id('mActions').style.display='none';id('mTitle').textContent='Pipeline';id('pipelineMain').classList.add('show');loadPipeline()}
  else if(view==='diag'){search.placeholder='';fa.style.display='none';id('msgsWrap').classList.add('hidden');id('msgSearchWrap').style.display='none';id('mActions').style.display='none';id('mTitle').textContent='Diagnostic Report';id('diagMain').classList.add('show');loadDiagView()}
  if(view!=='pipeline'&&view!=='diag'&&currentSession&&id('mTitle'))id('mTitle').textContent=currentSession.title||'Select a session'
}

function json(url){
  var opts={headers:{}}
  if(_token)opts.headers['Authorization']='Bearer '+_token
  return fetch(url,opts).then(function(r){if(r.status===401){showLogin();throw new Error('Unauthorized')};if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
}
function authFetch(url,opts){
  opts=opts||{};opts.headers=opts.headers||{}
  if(_token)opts.headers['Authorization']='Bearer '+_token
  return fetch(url,opts)
}

// === AUTH ===
function showLogin(){
  _token='';localStorage.removeItem('myd-token')
  document.cookie='myd-token=; path=/; max-age=0'
  window.location.href='/'
}
async function doLogin(){
  window.location.href='/'
}
var diagReportCache=null;
function openDiag(){
  switchView('diag')
}
async function loadDiagView(){
  var el=id('diagContent');if(!el)return
  el.innerHTML='<div class="loading">Loading...</div>'
  try{
    var results=await Promise.all([
      json('/api/pipeline').catch(function(){}),
      json('/api/diag').catch(function(){})
    ])
    var extra={pipeline:results[0]||null,server:results[1]||null,view:curView,session:currentSession?{id:currentSession.id,title:currentSession.title}:null}
    var report=window.__diag?window.__diag.generate(extra):{error:'diag.js not loaded'}
    diagReportCache=report
    renderDiagReport(el,report)
  }catch(e){el.innerHTML='<div class="empty-view"><p>Failed to load: '+esc(e.message)+'</p></div>'}
}
function renderDiagReport(el,r){
  var errCount=r.errors?r.errors.length:0, fetchCount=r.fetches?r.fetches.length:0, layoutIssues=0, inspectedCount=r.inspected?r.inspected.length:0
  if(r.layout){Object.keys(r.layout).forEach(function(k){if(!r.layout[k].v)layoutIssues++})}
  var totalIssues=errCount+fetchCount+layoutIssues

  var summary='<div class="dr-summary">'+
    '<div class="dr-sum-item '+(errCount?'dr-sum-bad':'dr-sum-ok')+'">&#9888; '+errCount+' error'+(errCount!==1?'s':'')+'</div>'+
    '<div class="dr-sum-item '+(fetchCount?'dr-sum-bad':'dr-sum-ok')+'">&#128230; '+fetchCount+' fetch'+(fetchCount!==1?'es':'')+'</div>'+
    '<div class="dr-sum-item '+(layoutIssues?'dr-sum-warn':'dr-sum-ok')+'">&#128207; '+layoutIssues+' layout</div>'+
    '<div class="dr-sum-item'+(inspectedCount?' dr-sum-info':'')+'">&#128270; '+inspectedCount+' inspected</div>'+
    '</div>'

  function section(id,label,icon,count,content){
    var open=count>0?' open':''
    return '<div class="dr-section'+open+'" onclick="diagToggle(this,event)"><div class="dr-shdr"><span class="dr-arrow">&#9654;</span>'+icon+' '+label+(count!==null?' <span class="dr-count">'+count+'</span>':'')+'</div><div class="dr-body">'+content+'</div></div>'
  }
  function escAttr(s){return String(s).replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

  var errors=errCount?r.errors.map(function(e,i){var t=e.t?fmtTime(e.t):'';var msg=esc(e.msg||'');return'<div class="dr-item dr-err"><span class="dr-idx">'+(i+1)+'</span><div class="dr-err-main"><span class="dr-etime">'+t+'</span><span class="dr-emsg">'+msg+'</span>'+(e.line?'<span class="dr-line">line '+e.line+'</span>':'')+'</div></div>'}).join(''):'<div class="dr-empty">&#10004; No errors</div>'

  var fetches=fetchCount?r.fetches.map(function(f,i){return'<div class="dr-item dr-fetch"><span class="dr-idx">'+(i+1)+'</span><div class="dr-fetch-main"><span class="dr-url">'+esc(f.url)+'</span><span class="dr-fstatus" style="color:'+(f.status>=400?'#ef4444':'#eab308')+'">'+f.status+'</span></div></div>'}).join(''):'<div class="dr-empty">&#10004; No failed fetches</div>'

  var layoutHtml=''
  if(r.layout){
    layoutHtml='<div class="dr-grid">'+Object.keys(r.layout).map(function(k){
      var v=r.layout[k];var ok=v.v?'ok':'bad'
      return '<div class="dr-gcell dr-gcell-'+ok+'" title="'+escAttr(k)+': '+v.w+'\u00d7'+v.h+(' + (v.v?"visible":"hidden")')+'><div class="dr-gname">'+esc(k)+'</div><div class="dr-gsz">'+v.w+'\u00d7'+v.h+'</div><div class="dr-gdot">&#9679;</div><div class="dr-gvis">'+(v.v?'visible':'hidden')+'</div></div>'
    }).join('')+'</div>'
  }

  var pipelineHtml=''
  if(r.extra&&r.extra.pipeline){
    var comps=r.extra.pipeline.components||[]
    pipelineHtml='<div class="dr-plist">'+comps.map(function(c){
      var col=c.status==='green'?'var(--green,#22c55e)':c.status==='red'?'var(--red,#ef4444)':'var(--yellow,#eab308)'
      var metrics=c.metrics?Object.keys(c.metrics).map(function(k){return esc(String(c.metrics[k]))}).join(' &middot; '):''
      return '<div class="dr-pitem"><span class="dr-pdot" style="background:'+col+'"></span><span class="dr-pname">'+esc(c.label)+'</span>'+(metrics?'<span class="dr-pmet">'+metrics+'</span>':'')+'</div>'
    }).join('')+'</div>'
  }

  var inspectedHtml=''
  if(inspectedCount){
    inspectedHtml=r.inspected.map(function(item,i){
      var path=item.parents&&item.parents.length?item.parents.slice().reverse().map(function(p){return p.tag+(p.id?'#'+p.id:'')}).join(' &gt; '):''
      return'<div class="dr-inspected"><div class="dr-itag">&lt;'+esc(item.tag)+(item.id?' id="'+escAttr(item.id)+'"':'')+(item.cls?' class="'+escAttr(typeof item.cls==='string'?item.cls:JSON.stringify(item.cls))+'"':'')+'&gt;</div><div class="dr-irect">'+item.rect.w+'\u00d7'+item.rect.h+' @ ('+item.rect.x+','+item.rect.y+')</div>'+(path?'<div class="dr-ipath">'+path+'</div>':'')+'</div>'
    }).join('')
  }

  el.innerHTML=summary+
    section('s-browser','Browser','&#128202;',null,
      '<div class="dr-row"><span class="dr-lbl">Viewport</span><span>'+esc(r.browser.vp)+'</span></div>'+
      '<div class="dr-row"><span class="dr-lbl">Theme</span><span>'+esc(r.browser.theme)+'</span></div>')+
    section('s-errors','Errors','&#9888;',errCount,errors)+
    section('s-fetches','Failed Fetches','&#128230;',fetchCount,fetches)+
    section('s-layout','Layout State','&#128207;',null,layoutHtml)+
    (pipelineHtml?section('s-pipeline','Pipeline','&#9881;',null,pipelineHtml):'')+
    (inspectedHtml?section('s-inspected','Inspected Elements','&#128270;',inspectedCount,inspectedHtml):'')
}
function diagToggle(el,ev){
  if(ev&&!ev.target.closest('.dr-shdr'))return
  var body=el.querySelector('.dr-body');if(!body)return
  body.style.display=body.style.display==='block'?'none':'block'
  el.querySelector('.dr-arrow').style.transform=body.style.display==='block'?'rotate(90deg)':''
}
function copyDiagReport(){
  if(!diagReportCache){toast('No report data','error');return}
  var txt=JSON.stringify(diagReportCache,null,2)
  navigator.clipboard.writeText(txt).then(function(){
    toast('Report copied!','success')
  }).catch(function(){
    var ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);
    toast('Report copied!','success')
  })
}
function doLogout(){
  authFetch('/api/logout',{method:'POST'}).catch(function(){})
  _token='';localStorage.removeItem('myd-token')
  document.cookie='myd-token=; path=/; max-age=0'
  window.location.href='/'
}

// Date range
function setDateRange(btn){
  document.querySelectorAll('.s-date-btn').forEach(function(b){b.classList.remove('active')})
  btn.classList.add('active');dateRange=btn.dataset.range
  if(curView==='chats')loadSessions()
}

// === SESSIONS ===
async function loadSessions(){
  try{
    var q=id('sSearch').value.trim(),model=id('sModelFilter').value,agent=id('sAgentFilter').value,project=id('sProjectFilter').value
    var p=[];
    if(q)p.push('q='+encodeURIComponent(q));
    if(model)p.push('model='+encodeURIComponent(model));
    if(agent)p.push('agent='+encodeURIComponent(agent));
    if(project)p.push('project='+encodeURIComponent(project));
    if(dateRange==='today'){var d=new Date();d.setHours(0,0,0,0);p.push('dateFrom='+d.getTime())}
    else if(dateRange==='7d'){var d=Date.now()-6048e5;p.push('dateFrom='+d)}
    else if(dateRange==='30d'){var d=Date.now()-2592e6;p.push('dateFrom='+d)}
    else if(dateRange==='bookmarked')p.push('bookmarked=true')
    var url='/api/sessions'+(p.length?'?'+p.join('&'):'')
    var list=await json(url)
    var oldIds=new Set(sessions.map(function(s){return s.id}));sessions=list
    renderSessions(sessions);id('sCount').textContent=sessions.length;id('chatsBadge').textContent=sessions.length
    try{
      var st=await json('/api/stats');var tCost=st.total_cost?parseFloat(st.total_cost).toFixed(4):'0';var tToks=st.total_tokens?Number(st.total_tokens).toLocaleString():'0'
      id('sFooterRight').textContent='$'+tCost+' | '+tToks+' t'
      if(Array.isArray(list))updateFilters(list)
    }catch(e){}
    if(list.length&&!oldIds.has(list[0].id)&&oldIds.size>0&&autoRefresh){toast('New: '+(list[0].title||'Untitled'),'success')}
  }catch(e){id('sCount').textContent='err'}
}
function updateFilters(sessions){
  var m={},a={},pj={};
  sessions.forEach(function(s){if(s.model)m[s.model]=true;if(s.agent)a[s.agent]=true;if(s.project_id)pj[s.project_name||s.project_id]=s.project_id})
  populateSelect(id('sModelFilter'),Object.keys(m).sort())
  populateSelect(id('sAgentFilter'),Object.keys(a).sort())
  var pjNames=Object.keys(pj).sort();var pjSel=id('sProjectFilter');var cur=pjSel.value
  pjSel.innerHTML='<option value="">All projects</option>'
  pjNames.forEach(function(n){pjSel.innerHTML+='<option value="'+esc(pj[n])+'">'+esc(n)+'</option>'})
  pjSel.value=cur
}
function populateSelect(sel,vals){var cur=sel.value;sel.innerHTML='<option value="">'+(sel===id('sModelFilter')?'All models':sel===id('sAgentFilter')?'All agents':'All projects')+'</option>';vals.forEach(function(v){sel.innerHTML+='<option value="'+esc(v)+'">'+esc(v)+'</option>'});sel.value=cur}
function renderSessions(list){
  if(!Array.isArray(list)){id('sGroups').innerHTML='<div class="empty-view"><p>Failed to load sessions</p></div>';return}
  list.sort(function(a,b){return Number(b.time_created)-Number(a.time_created)})
  var groups={};list.forEach(function(s){var g=getGroup(s.time_created);if(!groups[g])groups[g]=[];groups[g].push(s)})
  id('sGroups').innerHTML=['Today','Yesterday','This Week','This Month','Older'].map(function(og){
    if(!groups[og])return''
    return'<div class="s-group"><div class="s-group-label">'+og+'</div>'+groups[og].map(function(s){
      var act=currentSession&&currentSession.id===s.id?' active':'',ago=s.time_created?relTime(s.time_created):'',extra='',pj=s.project_name||''
      if(s.todo_count){extra+='<span>'+(s.todos_done||0)+'/'+s.todo_count+' tasks</span>'}
      if(s.message_count&&s.message_count>1){extra+='<span>'+s.message_count+' msgs</span>'}
      if(s.summary_files){extra+='<span>'+s.summary_files+' files</span>'}
      var bm=s.bookmarked==='true'||s.bookmarked===true?' on':''
      var preview=''
      if(s.message_preview){preview='<div class="sp">'+esc(s.message_preview)+(s.message_preview.length>=120?'...':'')+'</div>'}
      return'<div class="s-item'+act+'" data-id="'+s.id+'" onclick="selectSession(\''+s.id+'\')">'+
        '<button class="s-bm'+bm+'" onclick="event.stopPropagation();togBookmark(\''+s.id+'\',this)" title="Bookmark">&#9733;</button>'+
        '<div class="s-ib"><div class="st">'+esc(s.title||'Untitled')+'</div>'+
        '<div class="sm">'+(ago?'<span>'+ago+'</span>':'')+(pj?'<span>'+esc(pj)+'</span>':'')+(s.model?'<span>'+esc(s.model)+'</span>':'')+(s.cost&&parseFloat(s.cost)>0?'<span>'+fmtCost(s.cost)+'</span>':'')+extra+'</div></div>'+
        '<button class="sdel" onclick="event.stopPropagation();confirmDelete(\''+s.id+'\')" title="Delete this session">&#10005;</button></div>'
    }).join('')+'</div>'
  }).join('')
}
function filterSessions(){if(curView==='chats')loadSessions()}



// === SELECT SESSION ===
var PAGE_SIZE=100,_msgOffset=0,_totalParts=0,_hasMore=false
async function selectSession(id){
  if(currentSession&&currentSession.id===id&&id('msgs').children.length>1)return
  sid=id;currentSession={id:id};cMsgSearch()
  _msgOffset=0;_totalParts=0;_hasMore=false
  switchView('chats')
  renderSessions(sessions);cSidebar()
  id('msgs').innerHTML='<div class="loading"><div class="spin"></div><p style="font-size:12px;color:var(--text-muted);margin-top:12px">Loading session...</p></div>';id('scrollBottom').classList.remove('show');id('mActions').style.display='none';id('mTitle').textContent='Loading...'
  try{
    var r=await Promise.all([json('/api/session/'+id),json('/api/messages/'+id+'?limit='+PAGE_SIZE+'&offset=0')]);var session=r[0],page=r[1]
    currentSession=session||{id:id};sTitle=session?session.title||'Untitled':'Untitled'
    var titleHtml=esc(sTitle)
    if(session&&session.project_name)titleHtml+='<span class="prj-tag">'+esc(session.project_name)+'</span>'
    if(session&&(session.bookmarked==='true'||session.bookmarked===true))titleHtml+='<button class="bm-star" onclick="togBookmark(\''+id+'\',this)" title="Remove bookmark">&#9733;</button>'
    id('mTitle').innerHTML=titleHtml
    var info=id('mInfo');var p=[]
    if(session){if(session.created_at)p.push('<span>'+session.created_at+'</span>');if(session.model)p.push('<span>'+esc(prettyModel(session.model))+'</span>');if(session.agent)p.push('<span>'+esc(session.agent)+'</span>');if(session.cost&&parseFloat(session.cost)>0)p.push('<span>'+fmtCost(session.cost)+'</span>')}
    info.innerHTML=p.join('');id('mActions').style.display='flex';if(panelOpen)renderPanel()
    codeMap={};codeIdx=0;var el=id('msgs')
    var msgs=page.messages||page;_totalParts=page.total_parts||0;_hasMore=_totalParts>PAGE_SIZE
    if(!msgs||!msgs.length){el.innerHTML='<div class="empty"><div class="ei">&#128172;</div><p style="color:var(--text-dim)">No messages yet in this session.</p></div>';_lastMsgCount=0;liveDot(false);renderSessions(sessions);return}
    msgData=msgs;_lastMsgCount=_totalParts||msgs.length;liveDot(true);touchSync();_msgOffset=PAGE_SIZE
    renderMessages(el,msgs,true)
    renderSessions(sessions)
    loadSessionDetail(id)
  }catch(e){id('msgs').innerHTML='<div class="empty"><p>Error: '+esc(e.message)+'</p></div>'}
}
function renderMessages(el,msgs,scrollBottom){
  var html='';var lastDate=''
  var reversed=msgs.slice().reverse()
  reversed.forEach(function(m,i){
    var ds=m.msg_time?new Date(Number(m.msg_time)).toDateString():''
    var sep=(lastDate&&lastDate!==ds)?msgDateSep(m.msg_time):''
    if(ds)lastDate=ds
    html+=sep+renderMsg(m,i,'')
  })
  // "Load older" at bottom (older=below)
  var c=_totalParts||msgs.length
  if(_hasMore)html+='<div class="load-older" onclick="loadOlder()">&#9660; Older messages ('+(c-_msgOffset)+' more)</div>'
  el.innerHTML=html
  if(scrollBottom)el.scrollTop=0
}
async function loadOlder(){
  if(!sid||!_hasMore)return
  var el=id('msgs');var loadBtn=el.querySelector('.load-older');if(loadBtn)loadBtn.textContent='Loading...'
  try{
    var page=await json('/api/messages/'+sid+'?limit='+PAGE_SIZE+'&offset='+_msgOffset)
    var msgs=page.messages||[]
    if(!msgs.length){_hasMore=false;if(loadBtn)loadBtn.remove();return}
    msgData=msgs.concat(msgData||[])
    _msgOffset+=PAGE_SIZE;_hasMore=_totalParts>_msgOffset
    // In descending mode, older messages append at bottom
    var olderHtml=msgs.slice().reverse().map(function(m){
      return renderMsg(m,0,'')
    }).join('')
    var c=_totalParts||msgData.length
    var moreBtn=_hasMore?'<div class="load-older" onclick="loadOlder()">&#9660; Older messages ('+(c-_msgOffset)+' more)</div>':''
    // Append older messages before the load-older button
    var existing=el.innerHTML.replace(/<div class="load-older"[^>]*>.*?<\/div>/,'')
    el.innerHTML=existing+olderHtml+moreBtn
  }catch(e){toast('Failed to load','error')}
}
async function loadSessionDetail(id){
  try{
    var r=await Promise.all([
      json('/api/todos/'+id),
      json('/api/file-changes/'+id)
    ])
    window._sessionTodos=r[0];window._sessionFiles=r[1]
    if(panelOpen)renderPanelDetail()
  }catch(e){}
}

// === BOOKMARK ===
async function togBookmark(id,el){
  var currentlyOn=el.classList.contains('on')
  try{
    await authFetch('/api/session/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookmarked:!currentlyOn})})
    el.classList.toggle('on')
    if(currentSession&&currentSession.id===id){var e=id('mTitle').querySelector('.bm-star');if(e)e.textContent=!currentlyOn?'&#9733;':''}
    toast(!currentlyOn?'Bookmarked':'Unbookmarked','success')
    loadSessions()
  }catch(e){toast('Failed','error')}
}

// === MESSAGE SEARCH ===
function tMsgSearch(){var w=id('msgSearchWrap');w.classList.contains('show')?cMsgSearch():(currentSession?(w.classList.add('show'),id('msgSearch').focus(),filterMessages()):toast('Select a session first'))}
function cMsgSearch(){id('msgSearchWrap').classList.remove('show');id('msgSearch').value='';clearMsgHighlights()}
function clearMsgHighlights(){id('msgs').querySelectorAll('.mc mark').forEach(function(m){var p=m.parentNode;p.replaceChild(document.createTextNode(m.textContent),m);p.normalize()});id('msgs').querySelectorAll('.msg').forEach(function(m){m.style.display=''});id('msgSearchCount').textContent=''}
function filterMessages(){var q=id('msgSearch').value.trim().toLowerCase();if(!q){clearMsgHighlights();return}
  var msgs=id('msgs').querySelectorAll('.msg'),count=0;clearMsgHighlights()
  msgs.forEach(function(msg){var mc=msg.querySelector('.mc');if(!mc){msg.style.display='none';return}
    var txt=mc.textContent.toLowerCase();if(txt.indexOf(q)===-1){msg.style.display='none';return}
    count++;msg.style.display=''
    if(msg.classList.contains('tool')||msg.classList.contains('reasoning'))return
    getTextNodes(mc).forEach(function(n){var i=n.textContent.toLowerCase().indexOf(q);if(i===-1)return
      var p=n.parentNode,after=n.splitText(i),mid=after.splitText(q.length),mk=document.createElement('mark');mk.textContent=after.textContent;p.replaceChild(mk,after)})
  });id('msgSearchCount').textContent=count+'/'+msgs.length}
function getTextNodes(el){var nodes=[],w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT,null,false);while(w.nextNode())nodes.push(w.currentNode);return nodes}

var _lastMsgCount=0,_msgRefreshInt=null,_liveDot=null,_syncTime=null,_syncTick=null

function liveDot(on){
  var el=id('mTitle')
  if(!_liveDot){
    _liveDot=document.createElement('span');_liveDot.className='live-dot';_liveDot.title='Syncing in real-time'
    _syncTime=document.createElement('span');_syncTime.className='sync-time'
  }
  if(on){
    if(!el.contains(_liveDot))el.appendChild(_liveDot)
    if(!el.contains(_syncTime)){el.appendChild(_syncTime);startSyncTick()}
  }else{
    if(_liveDot.parentNode)_liveDot.parentNode.removeChild(_liveDot)
    if(_syncTime.parentNode)_syncTime.parentNode.removeChild(_syncTime)
    if(_syncTick){clearInterval(_syncTick);_syncTick=null}
  }
}
function startSyncTick(){
  if(_syncTick)clearInterval(_syncTick)
  _syncTick=setInterval(function(){
    if(!_syncTime||!_syncTime.parentNode){clearInterval(_syncTick);_syncTick=null;return}
    if(!_syncTime._lastUpdate){_syncTime.textContent='';return}
    var sec=Math.floor((Date.now()-_syncTime._lastUpdate)/1000)
    if(sec<3){_syncTime.textContent=''}else{_syncTime.textContent='updated '+sec+'s ago'}
  },1000)
}
function touchSync(){if(_syncTime){_syncTime._lastUpdate=Date.now();_syncTime.textContent='synced'}}

async function refreshCurrentMessages(){
  if(!sid||!currentSession)return
  try{
    var page=await json('/api/messages/'+sid+'?limit='+PAGE_SIZE+'&offset=0')
    if(!page)return
    var msgs=page.messages||page
    if(!msgs||!msgs.length)return
    var el=id('msgs')
    var latestParts=page.total_parts||0
    if(latestParts!==_lastMsgCount&&latestParts>0){
      _lastMsgCount=latestParts;_totalParts=latestParts;_hasMore=latestParts>PAGE_SIZE
      msgData=msgs
      codeMap={};codeIdx=0
      renderMessages(el,msgs,false)
      // In descending mode, scroll stays at top (newest)
      el.scrollTop=0
      loadSessionDetail(sid)
      liveDot(true);touchSync()
    }else{
      touchSync()
    }
    try{
      var s=await json('/api/session/'+sid)
      if(s){
        if(s.title!==sTitle){sTitle=s.title;id('mTitle').innerHTML=esc(s.title)}
        var p=[]
        if(s.created_at)p.push('<span>'+s.created_at+'</span>')
        if(s.model)p.push('<span>'+esc(prettyModel(s.model))+'</span>')
        if(s.agent)p.push('<span>'+esc(s.agent)+'</span>')
        if(s.cost&&parseFloat(s.cost)>0)p.push('<span>'+fmtCost(s.cost)+'</span>')
        id('mInfo').innerHTML=p.join('')
        if(panelOpen)renderPanel()
      }
    }catch(e){}
  }catch(e){}
}

function tExpandAll(){expandAll=!expandAll;id('expandToggle').classList.toggle('toggled',expandAll);id('msgs').querySelectorAll('.msg.tool .mc').forEach(function(mc){if(expandAll)mc.classList.remove('collapsed');else mc.classList.add('collapsed')})}
function tDense(){dense=!dense;document.body.classList.toggle('dense',dense);localStorage.setItem('myd-dense',dense?'1':'');id('denseToggle').classList.toggle('toggled',dense)}
function tAutoRefresh(){autoRefresh=!autoRefresh;id('refreshToggle').classList.toggle('toggled',autoRefresh);id('pRefreshBtn').textContent=autoRefresh?'On':'Off'
  if(autoRefresh){
    var v=parseInt(id('pRefreshInterval').value,10)||30;clearInterval(refreshInt);clearInterval(_msgRefreshInt)
    refreshInt=setInterval(function(){if(curView==='chats')loadSessions()},v*1000)
    _msgRefreshInt=setInterval(refreshCurrentMessages,3000)
    if(sid)liveDot(true)
    toast('Auto-refresh on','success')
  }else{
    clearInterval(refreshInt);clearInterval(_msgRefreshInt);liveDot(false)
    toast('Auto-refresh off')
  }}

function md(t){
  if(!t)return''
  t=esc(t)
  t=t.replace(/```(\w*)\n?([\s\S]*?)```/g,function(_,l,c){c=c.trim();var id=++codeIdx;codeMap[id]=c;var lang=l?'<span class="pl">'+esc(l)+'</span>':'';return'<pre>'+lang+'<button class="cpy" data-copy-id="'+id+'" title="Copy code block">Copy</button><code>'+esc(c)+'</code></pre>'})
  t=t.replace(/`([^`]+)`/g,'<code>$1</code>');t=t.replace(/^---$/gm,'<hr>')
  t=t.replace(/^#### (.+)$/gm,'<h4>$1</h4>');t=t.replace(/^### (.+)$/gm,'<h3>$1</h3>');t=t.replace(/^## (.+)$/gm,'<h2>$1</h2>');t=t.replace(/^# (.+)$/gm,'<h1>$1</h1>')
  t=t.replace(/^&gt; (.+)$/gm,'<blockquote>$1</blockquote>')
  t=t.replace(/^\|(.+)\|$/gm,function(_,c){var cells=c.split('|').map(function(x){return x.trim()}).filter(Boolean);if(cells.length&&cells[0].match(/^[-:]+$/))return'';return'<td>'+cells.join('</td><td>')+'</td>'})
  t=t.replace(/^[\*\-] (.+)$/gm,'<li>$1</li>');t=t.replace(/(<li>.*<\/li>\n?)+/g,'<ul>$&</ul>')
  t=t.replace(/^\d+\. (.+)$/gm,'<li>$1</li>');t=t.replace(/(<li>.*<\/li>\n?)+/g,'<ol>$&</ol>')
  t=t.replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>');t=t.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');t=t.replace(/\*(.+?)\*/g,'<em>$1</em>');t=t.replace(/~~(.+?)~~/g,'<del>$1</del>')
  t=t.replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');t=t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,'<img src="$2" alt="$1" loading="lazy">')
  return t
}

document.addEventListener('click',function(e){var btn=e.target.closest('.cpy');if(!btn)return;var id=btn.getAttribute('data-copy-id');if(id&&codeMap[id]){copyText(codeMap[id],btn);return}var code=btn.parentNode.querySelector('code');if(code)copyText(code.textContent,btn)})
function copyText(text,el){if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(function(){var o=el.textContent;el.textContent='Copied!';setTimeout(function(){el.textContent=o},1500);toast('Copied','success')}).catch(function(){fallbackCp(text,el)})}else{fallbackCp(text,el)}}
function fallbackCp(text,el){var ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.left='-9999px';ta.style.top='0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');var o=el.textContent;el.textContent='Copied!';setTimeout(function(){el.textContent=o},1500);toast('Copied','success')}catch(e){toast('Copy failed','error')}document.body.removeChild(ta)}
function cpMsg(btn){var msg=btn.closest('.msg'),mc=msg.querySelector('.mc');copyText(mc?mc.textContent.trim():'',btn)}

function confirmDelete(id){delTarget=id||(currentSession&&currentSession.id);if(!delTarget)return;var t=currentSession?currentSession.title||'this session':'this session'
  showModal('Delete session?','Delete <strong>'+esc(t)+'</strong>? This cannot be undone.',[{label:'Cancel',cls:'mcancel',action:cModal},{label:'Delete',cls:'mcon',action:doDelete}])}
function cModal(){id('modalOverlay').classList.remove('open');delTarget=null}
async function doDelete(){if(!delTarget)return;var target=delTarget;cModal()
  try{await authFetch('/api/session/'+target,{method:'DELETE'});toast('Deleted','success')
    if(currentSession&&currentSession.id===target){currentSession=null;sid='';msgData=[];id('mTitle').textContent='Select a session';id('mInfo').innerHTML='';id('mActions').style.display='none';id('msgs').innerHTML='<div class="empty"><div class="ei">&#10003;</div><p style="color:var(--text-dim)">Session deleted.</p></div>'}
    await loadSessions()}catch(e){toast('Delete failed','error')};delTarget=null}
function showModal(title,msg,buttons){id('modalTitle').textContent=title;id('modalMsg').innerHTML=msg;id('modalActs').innerHTML=buttons.map(function(b){return'<button class="'+b.cls+'" title="'+esc(b.label)+'" onclick="onModalAction(\''+esc(b.label)+'\')">'+esc(b.label)+'</button>'});id('modalOverlay').classList.add('open');window._modalActions=buttons}
function onModalAction(label){(window._modalActions||[]).forEach(function(b){if(b.label===label&&typeof b.action==='function')b.action()})}
function startRename(){if(!currentSession)return;var h2=id('mTitle'),cur=h2.textContent;var inp=document.createElement('input');inp.className='rename-input';inp.value=cur
  inp.onblur=function(){doRename(inp.value);h2.style.display=''};inp.onkeydown=function(e){if(e.key==='Enter'){doRename(inp.value);h2.style.display=''}else if(e.key==='Escape'){h2.style.display=''}}
  h2.style.display='none';h2.parentNode.insertBefore(inp,h2.nextSibling);inp.focus();inp.select()}
async function doRename(title){if(!title&&id('pRename'))title=id('pRename').value.trim();if(!title||!currentSession)return
  try{await authFetch('/api/session/'+currentSession.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:title})});currentSession.title=title;sTitle=title;id('mTitle').textContent=title;id('pRename').value='';toast('Renamed','success');loadSessions()}catch(e){toast('Rename failed','error')}}

function tPanel(){panelOpen=!panelOpen;id('panel').classList.toggle('open',panelOpen);if(panelOpen&&currentSession)renderPanel()}
async function renderPanel(){if(!currentSession)return
  try{var s=await json('/api/session/'+currentSession.id);if(!s)return
    var stats='<h4>Session Details</h4>';['Model','Agent','Project','Messages','Created','Total Cost'].forEach(function(l){
      var k=l.toLowerCase().replace(' ','_');var v=l==='Messages'?(msgData.length||'N/A'):l==='Total Cost'?'$'+(s.cost?parseFloat(s.cost).toFixed(6):'0'):l==='Project'?(s.project_name||'N/A'):s[k]||'N/A'
      stats+='<div class="p-stat"><span class="pl">'+l+'</span><span class="pv">'+esc(v)+'</span></div>'})
    id('pStats').innerHTML=stats
    var ti=Number(s.tokens_input||0),to=Number(s.tokens_output||0),tr=Number(s.tokens_reasoning||0),total=ti+to+tr||1
    var tok='<div class="p-stat"><span class="pl">Input</span><span class="pv">'+ti.toLocaleString()+'</span></div><div class="p-bar"><div class="pf in" style="width:'+(ti/total*100)+'%"></div></div>'
    tok+='<div class="p-stat"><span class="pl">Output</span><span class="pv">'+to.toLocaleString()+'</span></div><div class="p-bar"><div class="pf out" style="width:'+(to/total*100)+'%"></div></div>'
    if(tr>0){tok+='<div class="p-stat"><span class="pl">Reasoning</span><span class="pv">'+tr.toLocaleString()+'</span></div><div class="p-bar"><div class="pf reasoning" style="width:'+(tr/total*100)+'%"></div></div>'}
    tok+='<div class="p-stat" style="border:none;font-weight:600"><span class="pl">Total</span><span class="pv">'+(ti+to+tr).toLocaleString()+'</span></div>'
    id('pTokens').innerHTML=tok
    // Load health + tags in parallel
    Promise.all([json('/api/health/'+currentSession.id),json('/api/tags/'+currentSession.id)]).then(function(r){
      renderPanelHealth(r[0]);renderPanelTags(r[1])
    }).catch(function(){})
    renderPanelDetail()
  }catch(e){}}
function renderPanelDetail(){
  var todos=window._sessionTodos||[],files=window._sessionFiles||[],session=currentSession
  if(files.length){id('pFiles').style.display=''
    id('pFileList').innerHTML=files.map(function(f){return'<div class="p-file-item"><span class="pf-icon">&#128196;</span><span>'+esc(f.file)+'</span></div>'}).join('')
  }else{id('pFiles').style.display='none'}
  if(session&&session.id){loadPanelMemory(session.id)}else{id('pSessionMemory').style.display='none'}
  if(todos.length){id('pSessionTodos').style.display='';id('pTodoCount').textContent='('+todos.filter(function(t){return t.status!=='completed'}).length+' open)'
    id('pTodoList').innerHTML=todos.map(function(t){var cls=t.status==='completed'?'done':t.status==='in_progress'?'prog':'pend';return'<div class="p-todo-item"><span class="pt-status"><span class="dot '+cls+'"></span></span><span class="pt-text">'+esc(t.content)+'</span></div>'
    }).join('')}else{id('pSessionTodos').style.display='none'}
}

// === HEALTH SCORE GAUGE ===
function renderPanelHealth(h){
  if(!h||h.score===undefined||h.score===null){id('pHealthScore').style.display='none';return}
  id('pHealthScore').style.display=''
  var s=Math.max(0,Math.min(100,h.score)),col=s>70?'var(--accent)':s>40?'var(--warning)':'var(--danger)'
  var ring='<div class="health-ring" style="background:conic-gradient('+col+' '+(s*3.6)+'deg,rgba(255,255,255,0.06) 0deg)"><div class="health-ring-inner" style="color:'+col+'">'+s+'</div></div>'
  var det='<div class="health-details"><div class="hd-row"><span>Efficiency</span><span class="hd-val">'+h.efficiency+'%</span></div><div class="hd-row"><span>Tokens/msg</span><span class="hd-val">'+fmtNum(h.tokensPerMsg)+'</span></div><div class="hd-row"><span>Cost/msg</span><span class="hd-val">'+fmtCost(h.costPerMsg)+'</span></div><div class="hd-row"><span>Reasoning</span><span class="hd-val">'+h.reasoningRatio+'%</span></div></div>'
  id('pHealthContent').innerHTML=ring+det
}

// === EMPTY STATE WELCOME ===
function loadEmptyRecent(){
  try{
    json('/api/sessions?limit=5').then(function(list){
      if(!list||!list.length)return
      var el=id('emptyRecent');if(!el)return
      var html='<div style="text-align:left"><p style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Recent Sessions</p>'
      for(var i=0;i<Math.min(list.length,5);i++){
        var s=list[i],ago=s.time_created?relTime(s.time_created):''
        html+='<div onclick="selectSession(\''+s.id+'\')" style="padding:6px 10px;border-radius:var(--radius-xs);cursor:pointer;display:flex;align-items:center;gap:8px;transition:all .15s;font-size:12px" onmouseenter="this.style.background=\'var(--glass-bg)\'" onmouseleave="this.style.background=\'transparent\'">' +
          '<span style="color:var(--text-muted);font-size:10px;width:28px;flex-shrink:0">' + (i+1) + '.</span>' +
          '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(s.title||'Untitled') + '</span>' +
          '<span style="color:var(--text-muted);font-size:10px;flex-shrink:0">' + ago + '</span></div>'
      }
      el.innerHTML=html+'</div>'
    }).catch(function(){})
  }catch(e){}
}

// === TAGS ===
function renderPanelTags(tags){
  var el=id('pSessionTags'),list=id('pTagList'),inp=id('pTagInput')
  if(!tags||!Array.isArray(tags)||!tags.length){el.style.display='none';return}
  el.style.display='';list.innerHTML=tags.map(function(t){return'<span class="tag-chip">'+esc(t)+' <span class="tag-del" onclick="removeTag(\''+esc(t)+'\')" title="Remove tag">&times;</span></span>'}).join('')
  inp.focus()
}
async function addTag(){
  var inp=id('pTagInput'),t=inp.value.trim();if(!t||!currentSession)return
  try{
    var cur=await json('/api/tags/'+currentSession.id);cur.push(t)
    await authFetch('/api/tags/'+currentSession.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({tags:cur})})
    inp.value='';renderPanelTags(cur);toast('Tag added','success')
  }catch(e){toast('Failed','error')}
}
async function removeTag(t){
  if(!currentSession)return
  try{
    var cur=await json('/api/tags/'+currentSession.id);var idx=cur.indexOf(t);if(idx>-1)cur.splice(idx,1)
    await authFetch('/api/tags/'+currentSession.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({tags:cur})})
    renderPanelTags(cur);toast('Tag removed','success')
  }catch(e){toast('Failed','error')}
}

// === COMPARE SESSIONS ===
function openCompare(){
  if(sessions.length<2){toast('Need at least 2 sessions to compare','error');return}
  var opts=sessions.slice(0,50).map(function(s){return{id:s.id,title:s.title||'Untitled',time:s.time_created}})
  var html='<div id="compareSessionList">'+opts.map(function(s,i){
    var lbl=esc(s.title)+(s.time?' <span style="color:var(--text-muted);font-size:10px">'+relTime(s.time)+'</span>':'')
    return'<div class="compare-item" data-id="'+esc(s.id)+'" onclick="toggleCompareSel(this,\''+esc(s.id)+'\')">'+lbl+'</div>'
  }).join('')+'</div><p style="font-size:11px;color:var(--text-dim)">Select two sessions to compare</p>'
  window._compareA=null;window._compareB=null;window._compareOpts=opts
  showModal('Compare Sessions',html,[
    {label:'Cancel',cls:'mcancel',action:cModal},
    {label:'Compare',cls:'mpri',action:doCompare}
  ])
}
function toggleCompareSel(el,id){
  if(el.classList.contains('selected')){el.classList.remove('selected');if(window._compareA===id)window._compareA=null;if(window._compareB===id)window._compareB=null;return}
  if(!window._compareA){window._compareA=id;el.classList.add('selected')}
  else if(!window._compareB&&id!==window._compareA){window._compareB=id;el.classList.add('selected')}
  else{toast('Already selected 2 sessions','error')}
}
async function doCompare(){
  var a=window._compareA,b=window._compareB
  if(!a||!b){toast('Select exactly 2 sessions','error');return}
  cModal()
  try{
    var r=await json('/api/compare?a='+a+'&b='+b)
    if(!r||!r.a||!r.b){toast('Compare failed','error');return}
    var d=r.diff||{},s1=r.a.session,s2=r.b.session
    var da=esc(s1.title||'Session A'),db=esc(s2.title||'Session B')
    var ha=r.a.health?r.a.health.score:'?',hb=r.b.health?r.b.health.score:'?'
    var html='<div class="compare-diff"><div class="cd-header">'+da+'</div><div></div><div class="cd-header">'+db+'</div>'
    html+='<div class="cd-val">'+fmtCost(s1.cost)+'</div><div style="text-align:center;font-weight:600;font-size:10px;color:var(--text-muted)">COST</div><div class="cd-val">'+fmtCost(s2.cost)+'</div>'
    var cdiff=parseFloat(d.cost);if(cdiff){html+='<div></div><div style="text-align:center;font-size:10px" class="cd-val '+(cdiff>0?'pos':'neg')+'">'+(cdiff>0?'+':'')+fmtCost(cdiff)+'</div><div></div>'}
    html+='<div class="cd-val">'+r.a.msgCount+'</div><div style="text-align:center;font-weight:600;font-size:10px;color:var(--text-muted)">MSGS</div><div class="cd-val">'+r.b.msgCount+'</div>'
    var mdiff=d.messages;if(mdiff){html+='<div></div><div style="text-align:center;font-size:10px" class="cd-val '+(mdiff>0?'pos':'neg')+'">'+(mdiff>0?'+':'')+mdiff+'</div><div></div>'}
    html+='<div class="cd-val">'+ha+'</div><div style="text-align:center;font-weight:600;font-size:10px;color:var(--text-muted)">HEALTH</div><div class="cd-val">'+hb+'</div>'
    html+='<div class="cd-val">'+fmtNum(r.a.session.tokens_input+r.a.session.tokens_output)+'</div><div style="text-align:center;font-weight:600;font-size:10px;color:var(--text-muted)">TOKENS</div><div class="cd-val">'+fmtNum(r.b.session.tokens_input+r.b.session.tokens_output)+'</div>'
    showModal('Comparison Result',html,[{label:'Close',cls:'mpri',action:cModal}])
  }catch(e){toast('Compare error','error')}
}

// === SETTINGS ===
function openSettings(){
  var colors=['#10a37f','#7c3aed','#2563eb','#f59e0b','#ef4444','#ec4899','#06b6d4']
  var curColor=localStorage.getItem('myd-accent')||'#10a37f'
  var html='<div class="settings-row"><label>Accent Color</label><div style="display:flex;gap:4px">'+colors.map(function(c){
    return'<span class="color-opt'+(curColor===c?' active':'')+'" style="background:'+c+'" data-color="'+c+'" title="Accent color '+c+'" onclick="setAccentColor(\''+c+'\',this)"></span>'
  }).join('')+'</div></div>'
  html+='<div class="settings-row"><label for="sHomeLayout">Home Layout</label><select id="sHomeLayout" style="background:var(--glass-bg);border:1px solid var(--glass-border);color:var(--text);padding:4px 8px;border-radius:var(--radius-xs);font-size:12px;outline:none" title="Compact layout reduces spacing" onchange="localStorage.setItem(\'myd-layout\',this.value);toast(\'Layout saved\',\'success\')"><option value="default">Default</option><option value="compact">Compact</option></select></div>'
  showModal('Settings',html,[{label:'Close',cls:'mpri',action:cModal}])
}
function setAccentColor(color,el){
  document.documentElement.style.setProperty('--accent',color);document.documentElement.style.setProperty('--accent-hover',color+'cc')
  localStorage.setItem('myd-accent',color)
  document.querySelectorAll('.color-opt').forEach(function(c){c.classList.remove('active')});el.classList.add('active')
  fixSpotColor()
}
async function loadPanelMemory(sid){
  try{
    var mem=await json('/api/session-memory/'+sid)
    if(mem&&mem.length){id('pSessionMemory').style.display=''
      id('pMemoryList').innerHTML=mem.map(function(m){return'<div class="mem-item" style="margin:0;margin-bottom:4px;padding:6px 8px"><div class="mem-date">'+esc(m.date)+'</div><div class="mem-text" style="font-size:11px">'+esc(m.text.substring(0,200))+'</div></div>'
      }).join('')
    }else{id('pSessionMemory').style.display='none'}
  }catch(e){id('pSessionMemory').style.display='none'}
}
async function exportSession(f){if(!currentSession)return;try{window.open('/api/export/'+currentSession.id+'?format='+f,'_blank');toast('Exporting as '+f.toUpperCase(),'success')}catch(e){}}
async function exportAllData(){try{window.open('/api/export-all?format=json','_blank');toast('Exporting all data','success')}catch(e){}}

// Init
applyTheme(theme)
var savedAccent=localStorage.getItem('myd-accent')
if(savedAccent){document.documentElement.style.setProperty('--accent',savedAccent);document.documentElement.style.setProperty('--accent-hover',savedAccent+'cc');setTimeout(fixSpotColor,100)}
if(localStorage.getItem('myd-dense')){dense=true;document.body.classList.add('dense');id('denseToggle').classList.add('toggled')}
loadSessions()
loadEmptyRecent()
refreshInt=setInterval(function(){if(curView==='chats')loadSessions()},3e4)
_msgRefreshInt=setInterval(refreshCurrentMessages,3000)
if(window.innerWidth<=768)id('sidebarToggle').style.display='flex'

// ===== LIVE LIGHTING =====
var cursorSpot=id('cursorSpot'),mouseX=-9999,mouseY=-9999,spotX=-9999,spotY=-9999,spotInited=false
var tiltEls=new Set

// Fix spotlight color to match current theme
function fixSpotColor(){
  var c=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#10a37f'
  var r=parseInt(c.substring(1,3),16)||16,g=parseInt(c.substring(3,5),16)||163,b=parseInt(c.substring(5,7),16)||127
  cursorSpot.style.background='radial-gradient(circle,rgba('+r+','+g+','+b+',0.08) 0%,transparent 60%)'
}

function applyTilt(el){
  if(tiltEls.has(el))return;tiltEls.add(el)
  el.classList.add('tilt-glass')
  var hov=el.matches(':hover')
  el.addEventListener('mousemove',function(e){
    var r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2
    var dx=(e.clientX-cx)/(r.width/2),dy=(e.clientY-cy)/(r.height/2)
    var rotY=dx*8,rotX=-dy*8
    if(el.classList.contains('h-card')||el.classList.contains('hr-project')){
      el.style.transform='perspective(600px) rotateX('+rotX.toFixed(1)+'deg) rotateY('+rotY.toFixed(1)+'deg) translateZ(12px)'
    }else{
      el.style.transform='perspective(400px) rotateX('+(rotX*0.5).toFixed(1)+'deg) rotateY('+(rotY*0.5).toFixed(1)+'deg)'
    }
  })
  el.addEventListener('mouseleave',function(){
    el.style.transform=''
  })
}

// Smooth cursor spotlight with Orbital Parallax
var orbs=[],orbEls=document.querySelectorAll('.glass-orb')
orbEls.forEach(function(o){
  var orig=o.style.transform||''
  orbs.push({el:o,orig:orig,bx:0,by:0,ox:0,oy:0})
})

function tickSpot(){
  spotX+=(mouseX-spotX)*0.08;spotY+=(mouseY-spotY)*0.08
  cursorSpot.style.transform='translate('+(spotX-300).toFixed(1)+'px,'+(spotY-300).toFixed(1)+'px)'
  // Parallax: glass orbs drift subtly, preserving original transform
  orbs.forEach(function(o,i){
    var depth=0.015*(i+1)
    o.ox+=(mouseX*window.innerWidth*0.0001*depth-o.ox)*0.05
    o.oy+=(mouseY*window.innerHeight*0.0001*depth-o.oy)*0.05
    var tx=o.ox.toFixed(1),ty=o.oy.toFixed(1)
    o.el.style.transform=o.orig+' translate('+tx+'px,'+ty+'px)'
  })
  requestAnimationFrame(tickSpot)
}

document.addEventListener('mousemove',function(e){
  if(!spotInited){cursorSpot.style.opacity='1';spotInited=true}
  mouseX=e.clientX;mouseY=e.clientY
})

document.addEventListener('touchmove',function(e){
  var t=e.touches[0]
  if(!spotInited){cursorSpot.style.opacity='0.4';spotInited=true}
  mouseX=t.clientX;mouseY=t.clientY
},{passive:true})

fixSpotColor()
tickSpot()

// Wrap renderSessions to apply tilt after render
var _rs=renderSessions
renderSessions=function(list){
  _rs(list)
};

// === CHAT ===
// Upload redirect toast
;(function(){
  var m=location.search.match(/uploaded=([^&]+)/)
  if(m){var n=decodeURIComponent(m[1]);setTimeout(function(){toast('Uploaded: '+n,'success')},500)}
})()
function uploadScreenshot(inp){
  var f=inp.files[0];if(!f)return
  var fd=new FormData();fd.append('file',f)
  authFetch('/upload',{method:'POST',body:fd}).then(function(r){
    if(r.redirected)window.location.href=r.url
  }).catch(function(){toast('Upload failed','error')})
    .finally(function(){inp.value=''})
}
function imgLightbox(src){
  var ov=document.createElement('div');ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-backdrop-filter:blur(24px);backdrop-filter:blur(24px);animation:fadeIn .2s'
  var img=document.createElement('img');img.src=src;img.style.cssText='max-width:94%;max-height:94%;border-radius:10px;box-shadow:0 10px 80px rgba(0,0,0,0.5);object-fit:contain'
  ov.appendChild(img);ov.onclick=function(e){if(e.target===ov)document.body.removeChild(ov)};document.body.appendChild(ov)
}
var pipelineInt=null;
function pipelineEdgePath(x1,y1,x2,y2){
  if(Math.abs(y2-y1)<8)return 'M'+x1+' '+y1+' L'+x2+' '+y2
  var mx=(x1+x2)/2,my=(y1+y2)/2
  return 'M'+x1+' '+y1+' C'+mx+' '+y1+','+mx+' '+y2+','+x2+' '+y2
}
function pipelineNodeIcon(id){
  if(id==='opencode')return '&#9881;'
  if(id==='sqlite')return '&#128451;'
  if(id==='dashboard')return '&#128202;'
  if(id==='safari')return '&#127754;'
  if(id==='discord')return '&#128172;'
  if(id==='tailscale')return '&#128279;'
  if(id==='agentsmd')return '&#128221;'
  if(id==='gist')return '&#128230;'
  return '&#9632;'
}
function renderPipelineList(components,edges){
  var html='<div class="pipeline-list">'
  var order=['opencode','sqlite','dashboard','safari','discord','tailscale','agentsmd','gist']
  var compMap={};components.forEach(function(c){compMap[c.id]=c})
  order.forEach(function(id){
    var c=compMap[id];if(!c)return
    var col=c.status==='green'?'#22c55e':c.status==='red'?'#ef4444':'#eab308'
    var metricsHTML=''
    if(c.metrics){
      var keys=Object.keys(c.metrics)
      metricsHTML=keys.map(function(k){return '<span class="pl-m"><span class="pl-l">'+k+':</span> '+esc(c.metrics[k])+'</span>'}).join('')
    }
    html+='<div class="pl-node"><div class="pl-dot" style="background:'+col+'"></div><div class="pl-body"><div class="pl-title">'+pipelineNodeIcon(c.id)+' '+esc(c.label)+'</div><div class="pl-metrics">'+metricsHTML+'</div></div></div>'
    // Show outgoing edges as arrow
    edges.forEach(function(e){
      if(e.from===id&&compMap[e.to]){
        html+='<div class="pl-arrow">&#8595;</div>'
      }
    })
  })
  html+='</div>'
  return html
}
async function loadPipeline(){
  if(pipelineInt){clearInterval(pipelineInt);pipelineInt=null}
  var el=id('pipelineSvg');if(!el)return
  el.innerHTML='<div class="loading" style="padding:20px;color:var(--text-dim);text-align:center;min-height:60px;display:flex;align-items:center;justify-content:center">Loading pipeline...</div>'
  try{
    var d=await json('/api/pipeline')
    var components=d.components,edges=d.edges
    var isMobile=window.innerWidth<768
    // Layout
    var cw=140,ch=60,gap=70,sx=30,sy=30,row2y=220,row3y=350,svgW=920,svgH=410
    var nodeMap={}
    components.forEach(function(c){
      if(c.id==='opencode'){c.x=sx;c.y=sy}
      else if(c.id==='sqlite'){c.x=sx+cw+gap;c.y=sy}
      else if(c.id==='dashboard'){c.x=sx+2*(cw+gap);c.y=sy}
      else if(c.id==='safari'){c.x=sx+3*(cw+gap);c.y=sy}
      else if(c.id==='discord'){c.x=sx+cw+gap;c.y=row2y}
      else if(c.id==='tailscale'){c.x=sx+2*(cw+gap);c.y=row2y}
      else if(c.id==='agentsmd'){c.x=sx;c.y=row3y}
      else if(c.id==='gist'){c.x=sx+cw+gap;c.y=row3y}
      nodeMap[c.id]=c
    })
    // Overall status
    var anyRed=components.some(function(c){return c.status==='red'})
    var allGreen=components.every(function(c){return c.status==='green'})
    var pDot=id('pipelineDot');if(pDot){pDot.className='pulse-dot '+(allGreen?'green':anyRed?'red':'yellow')}
    if(isMobile){
      el.innerHTML=renderPipelineList(components,edges)
    }else{
      // Build SVG
      var svg='<svg viewBox="0 0 '+svgW+' '+svgH+'" class="pipeline-svg"><defs><marker id="arrGreen" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#22c55e"/></marker><marker id="arrRed" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#ef4444"/></marker><marker id="arrYellow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#eab308"/></marker></defs>'
      edges.forEach(function(e){
        var src=nodeMap[e.from],dst=nodeMap[e.to]
        if(!src||!dst)return
        var x1=src.x+cw,y1=src.y+ch/2,x2=dst.x,y2=dst.y+ch/2
        var pathD=pipelineEdgePath(x1,y1,x2,y2)
        var col=src.status==='green'?'#22c55e':src.status==='red'?'#ef4444':'#eab308'
        svg+='<path d="'+pathD+'" fill="none" stroke="'+col+'" stroke-width="2" class="pipeline-flow" marker-end="url(arrGreen)"/>'
      })
      components.forEach(function(c){
        var col=c.status==='green'?'#22c55e':c.status==='red'?'#ef4444':'#eab308'
        var metricsHTML=''
        if(c.metrics){
          var keys=Object.keys(c.metrics)
          metricsHTML=keys.map(function(k){return '<span class="pm-item"><span class="pm-label">'+k+'</span> <span class="pm-val">'+esc(c.metrics[k])+'</span></span>'}).join('')
        }
        svg+='<g class="pn-group"><rect x="'+c.x+'" y="'+c.y+'" width="'+cw+'" height="'+ch+'" rx="10" class="pn-rect" stroke="'+col+'" stroke-width="1.5"/>'
        svg+='<circle cx="'+(c.x+16)+'" cy="'+(c.y+18)+'" r="5" fill="'+col+'" class="pn-dot"/>'
        svg+='<text x="'+(c.x+28)+'" y="'+(c.y+23)+'" class="pn-title">'+c.label+'</text>'
        if(metricsHTML){
          svg+='<foreignObject x="'+(c.x+10)+'" y="'+(c.y+30)+'" width="'+(cw-20)+'" height="'+(ch-32)+'"><div xmlns="http://www.w3.org/1999/xhtml" class="pn-metrics">'+metricsHTML+'</div></foreignObject>'
        }
        svg+='</g>'
      })
      svg+='</svg>'
      el.innerHTML=svg
    }
    pipelineInt=setInterval(loadPipeline,5000)
  }catch(e){el.innerHTML='<div class="empty-view"><p>Failed to load pipeline</p></div>'}
}
async function loadLogs(){
  var el=id('logsList');if(!el)return
  try{
    var logs=await json('/api/login-log')
    if(!logs||!logs.length){el.innerHTML='<div class="empty-view"><p style="color:var(--text-dim);font-size:13px;padding:40px 20px">No login attempts recorded yet.</p></div>';return}
    el.innerHTML='<div style="font-size:12px;color:var(--text-dim);padding:8px 12px;display:flex;justify-content:space-between"><span>'+logs.length+' attempts</span><button onclick="loadLogs()" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:12px">&#8635; Refresh</button></div>'+
    logs.slice().reverse().map(function(l){
      var d=new Date(l.time),ts=d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})
      var ua=l.ua||'unknown'
      return '<div class="log-row" style="display:flex;gap:10px;align-items:center;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.04)"><div style="width:8px;height:8px;border-radius:50%;background:'+(l.success?'#22c55e':'#ef4444')+'"></div><div style="flex:1;min-width:0"><div style="display:flex;gap:8px;font-size:12px"><span style="color:var(--text)">'+ts+'</span><span style="color:var(--text-dim)">'+esc(l.ip)+'</span></div><div style="font-size:11px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(ua)+'</div></div><span style="font-size:11px;color:'+(l.success?'#22c55e':'#ef4444')+'">'+(l.success?'OK':'FAIL')+'</span></div>'
    }).join('')
  }catch(e){el.innerHTML='<div class="empty-view"><p style="color:var(--text-dim);padding:40px 20px">Failed to load logs</p></div>'}
}
async function loadUploads(){
  var el=id('uploadsGrid');if(!el)return
  try{
    var files=await json('/api/uploads')
    if(!files||!files.length){el.innerHTML='<div class="empty" style="grid-column:1/-1;padding:60px 20px"><p style="color:var(--text-dim);font-size:13px">No screenshots yet. Tap &#128247; in the sidebar to upload from your phone.</p></div>';return}
    el.innerHTML=files.map(function(f){return '<div class="upload-item" onclick="imgLightbox(\''+f.url+'\')"><img src="'+f.url+'" loading="lazy"><div class="upload-name">'+esc(f.name)+'</div></div>'}).join('')
  }catch(e){el.innerHTML='<div class="empty" style="grid-column:1/-1"><p>Failed to load</p></div>'}
}
// === RESEARCH ===
var researchData=[],researchView='timeline'

function fmtDate(d){var m=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];return m[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear()}

async function loadResearch(){
  var el=id('researchContent');if(!el)return
  el.innerHTML='<div class="loading" style="padding:20px;text-align:center;color:var(--text-dim);font-size:13px">Loading research...</div>'
  try{
    researchData=await json('/api/knowledge')
    renderResearch()
  }catch(e){el.innerHTML='<div class="empty-view"><p style="color:var(--text-dim);padding:30px">No research data yet. Click Sync to extract knowledge from sessions.</p></div>'}
}

function renderResearch(){
  var el=id('researchContent');if(!el)return
  var q=(id('researchSearch').value||'').toLowerCase()
  var tagF=id('researchTagFilter').value||''
  var projF=id('researchProjectFilter').value||''
  var filtered=researchData.filter(function(e){
    if(q&&!(e.title||'').toLowerCase().includes(q)&&!(e.summary||'').toLowerCase().includes(q)&&!(e.notes||'').toLowerCase().includes(q)&&!e.tags.some(function(t){return t.toLowerCase().includes(q)}))return false
    if(tagF&&!e.tags.includes(tagF))return false
    if(projF&&e.project!==projF)return false
    return true
  })
  if(researchView==='list'){
    renderResearchList(el,filtered)
  }else{
    renderResearchTimeline(el,filtered)
  }
  // Update filter dropdowns
  populateResearchFilters()
  id('researchBadge').textContent=researchData.length||''
}

function renderResearchList(el,entries){
  if(!entries.length){el.innerHTML='<div class="empty-view"><p style="color:var(--text-dim);padding:30px;text-align:center;font-size:13px">No research entries match your filter.</p></div>';return}
  el.innerHTML='<div class="r-list">'+entries.map(function(e){
    var tags=(e.tags||[]).map(function(t){return '<span class="r-card-tag">'+esc(t)+'</span>'}).join('')
    var time=e.timeCreated?relTime(e.timeCreated):''
    return '<div class="r-card" onclick="openResearch(\''+esc(e.id)+'\')"><div class="r-card-title">'+esc(e.title||'Untitled')+'</div><div class="r-card-meta"><span>'+(e.project||'')+'</span><span>&middot;</span><span>'+esc(e.model||'')+'</span><span>&middot;</span><span>'+time+'</span><span>&middot;</span><span>'+(e.messageCount||0)+' msgs</span>'+(e.cost?'<span>&middot;</span><span>'+fmtCost(e.cost)+'</span>':'')+'</div><div class="r-card-summary">'+esc((e.summary||'').substring(0,300))+'</div>'+(tags?'<div class="r-card-tags">'+tags+'</div>':'')+'</div>'
  }).join('')+'</div>'
}

function renderResearchTimeline(el,entries){
  if(!entries.length){el.innerHTML='<div class="empty-view"><p style="color:var(--text-dim);padding:30px;text-align:center;font-size:13px">No research entries in this period.</p></div>';return}
  // Group by date
  var groups={}
  entries.forEach(function(e){
    if(!e.timeCreated)return
    var d=new Date(Number(e.timeCreated))
    var key=d.toISOString().split('T')[0]
    if(!groups[key])groups[key]=[]
    groups[key].push(e)
  })
  var dates=Object.keys(groups).sort().reverse()
  var html='<div class="r-timeline">'
  // Mini calendar heatmap (last 90 days)
  var now=new Date()
  var dayCells=''
  for(var i=89;i>=0;i--){
    var d=new Date(now.getTime()-i*86400000)
    var key=d.toISOString().split('T')[0]
    var cnt=groups[key]?groups[key].length:0
    var tip=groups[key]?groups[key].map(function(e){return esc(e.title||'')}).join(', '):''
    var h=cnt?Math.min(4+cnt*8,40):4
    dayCells+='<div class="r-tl-day" onclick="'+(cnt?'viewResearchDate(\''+key+'\')':'')+'"><div class="r-tl-rect'+(cnt?'':' r-tl-empty')+'" style="height:'+h+'px" title="'+key+': '+cnt+' entries"></div><div class="r-tl-day-label">'+(i%14===0?d.getDate():'')+'</div></div>'
  }
  html+='<div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">Activity (last 90 days)</div><div class="r-tl-bar">'+dayCells+'</div>'
  // Daily list
  dates.slice(0,30).forEach(function(key){
    var items=groups[key]
    var d=new Date(key)
    var dayLabel=fmtDate(d)
    html+='<div class="r-tl-week"><div class="r-tl-week-label">'+dayLabel+'</div><div class="r-tl-week-days">'+
      items.map(function(e){
        var tags=(e.tags||[]).map(function(t){return '<span style="font-size:8px;color:var(--accent);background:rgba(16,163,127,0.1);border-radius:99px;padding:0 5px;margin-left:4px">'+esc(t)+'</span>'}).join('')
        return '<div class="r-tl-day-item" onclick="openResearch(\''+esc(e.id)+'\')">&#9679; '+esc(e.title||'Untitled')+tags+'</div>'
      }).join('')+
    '</div></div>'
  })
  html+='</div>'
  el.innerHTML=html
}

function viewResearchDate(key){
  id('researchSearch').value=key
  filterResearch()
}

function populateResearchFilters(){
  var tagSet={},projSet={}
  researchData.forEach(function(e){
    (e.tags||[]).forEach(function(t){tagSet[t]=true})
    if(e.project)projSet[e.project]=true
  })
  var tagEl=id('researchTagFilter'),projEl=id('researchProjectFilter')
  if(tagEl){
    var cur=tagEl.value
    tagEl.innerHTML='<option value="">All tags</option>'+Object.keys(tagSet).sort().map(function(t){return '<option value="'+esc(t)+'"'+(cur===t?' selected':'')+'>'+esc(t)+'</option>'}).join('')
  }
  if(projEl){
    var curP=projEl.value
    projEl.innerHTML='<option value="">All projects</option>'+Object.keys(projSet).sort().map(function(p){return '<option value="'+esc(p)+'"'+(curP===p?' selected':'')+'>'+esc(p)+'</option>'}).join('')
  }
}

function filterResearch(){renderResearch()}

function tResearchView(btn){
  researchView=btn.dataset.view
  document.querySelectorAll('.research-filter-bar .s-date-btn').forEach(function(b){b.classList.toggle('active',b.dataset.view===researchView)})
  renderResearch()
}

async function refreshResearch(){
  var el=id('researchContent');if(!el)return
  el.innerHTML='<div class="loading" style="padding:20px;text-align:center;color:var(--text-dim);font-size:13px">Syncing research from sessions...</div>'
  try{
    var r=await authFetch('/api/knowledge/refresh',{method:'POST'}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
    toast('Extracted '+r.count+' new research entr'+(r.count===1?'y':'ies'),'success')
    loadResearch()
  }catch(e){toast('Sync failed: '+e.message,'error')}
}

function openResearch(id){
  var entry=researchData.find(function(e){return e.id===id})
  if(!entry){toast('Entry not found','error');return}
  var overlay=document.createElement('div')
  overlay.className='r-detail-overlay'
  overlay.onclick=function(e){if(e.target===overlay){overlay.remove()}}
  var tags=(entry.tags||[]).map(function(t){return '<span class="r-detail-tag">'+esc(t)+'</span>'}).join('')
  var filesInfo=entry.filesChanged?entry.filesChanged+' file'+(entry.filesChanged===1?'':'s')+' changed':''
  var timeCreated=entry.timeCreated?fmtDate(new Date(Number(entry.timeCreated))):''
  overlay.innerHTML='<div class="r-detail" style="position:relative"><button class="r-detail-close" onclick="this.closest(\'.r-detail-overlay\').remove()">&times;</button>'+
    '<div class="r-detail-hdr">'+esc(entry.title||'Untitled')+'</div>'+
    '<div class="r-detail-meta">'+
      (entry.project?'<span><span class="r-detail-label">Project:</span> '+esc(entry.project)+'</span>':'')+
      (entry.model?'<span><span class="r-detail-label">Model:</span> '+esc(entry.model)+'</span>':'')+
      (timeCreated?'<span><span class="r-detail-label">Date:</span> '+timeCreated+'</span>':'')+
      (entry.messageCount?'<span><span class="r-detail-label">Messages:</span> '+entry.messageCount+'</span>':'')+
      (filesInfo?'<span><span class="r-detail-label">Files:</span> '+filesInfo+'</span>':'')+
      (entry.cost?'<span><span class="r-detail-label">Cost:</span> '+fmtCost(entry.cost)+'</span>':'')+
      (entry.agent?'<span><span class="r-detail-label">Agent:</span> '+esc(entry.agent)+'</span>':'')+
    '</div>'+
    (tags?'<div class="r-detail-tags">'+tags+'</div>':'')+
    '<div class="r-detail-summary">'+(entry.summary?esc(entry.summary):'No summary available')+'</div>'+
    '<div class="r-detail-notes"><label for="rNoteEdit" style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:4px">Personal Notes</label><textarea id="rNoteEdit" onchange="saveResearchNote(\''+esc(entry.id)+'\',this.value)" placeholder="Add your personal notes, insights, or references for future knowledge retrieval...">'+esc(entry.notes||'')+'</textarea></div>'+
    '<div class="r-detail-actions">'+
      '<button onclick="this.closest(\'.r-detail-overlay\').remove()">Close</button>'+
      (entry.sessionId?'<button onclick="window.open(\'/\',\'_blank\');this.closest(\'.r-detail-overlay\').remove()">Open Session</button>':'')+
    '</div></div>'
  document.body.appendChild(overlay)
}

async function saveResearchNote(id,notes){
  try{
    await authFetch('/api/knowledge/'+id,{method:'PATCH',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'notes='+encodeURIComponent(notes)})
  }catch(e){toast('Failed to save note','error')}
}

// Update switchView to handle research
var _origSwitch=switchView
switchView=function(view){
  if(view==='research'){
    id('sSearch').placeholder='Search research...'
    id('chatsFilterArea').style.display='none'
    id('msgsWrap').classList.add('hidden')
    id('msgSearchWrap').style.display='none'
    if(id('mActions'))id('mActions').style.display='none'
    id('mTitle').textContent='Research Knowledge Base'
    if(id('pipelineMain'))id('pipelineMain').classList.remove('show')
    if(id('diagMain'))id('diagMain').classList.remove('show')
    document.querySelectorAll('.s-nav-btn').forEach(function(b){b.classList.toggle('active',b.dataset.view===view)})
    document.querySelectorAll('.s-view').forEach(function(v){v.classList.toggle('active',v.id==='viewResearch')})
    curView=view
    loadResearch()
    return
  }
  _origSwitch(view)
};

document.addEventListener('keydown',function(e){
  if(e.ctrlKey&&e.key==='k'){e.preventDefault();id('sSearch').focus()}
  if(e.ctrlKey&&e.key==='f'){e.preventDefault();tMsgSearch()}
  if(e.key==='Escape'){cSidebar();cModal();cMsgSearch();if(panelOpen)tPanel()}
  if(e.key==='?'&&!e.ctrlKey&&!e.metaKey&&!e.target.closest('input,textarea,select')){e.preventDefault()
    showModal('Keyboard Shortcuts','<div class="kb-help"><table><tr><td><span class="kbd">Ctrl+K</span></td><td class="kb-desc">Search sessions</td></tr><tr><td><span class="kbd">Ctrl+F</span></td><td class="kb-desc">Search in messages</td></tr><tr><td><span class="kbd">Esc</span></td><td class="kb-desc">Close panels</td></tr><tr><td><span class="kbd">?</span></td><td class="kb-desc">Show this help</td></tr></table></div>',[{label:'Close',cls:'mpri',action:cModal}])}
})

// Auth check on load — redirects to /login if not authenticated
(function(){
  json('/api/stats').catch(function(){showLogin()})
})()
