(() => {
  'use strict';

  const VERSION = '0.5.0-beta.34';
  const FLAG = '__answerMeControlPanelV34';
  const UI_ID = 'answer_me_compact_ui_v23';
  const STYLE_ID = 'answer_me_control_panel_v34_style';
  const TTL = 6 * 60 * 60 * 1000;
  const CONCURRENCY = 3;
  if (window[FLAG]) return;
  window[FLAG] = true;

  let scanPromise = null;
  let applying = false;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const ctx = () => window.SillyTavern?.getContext?.() ?? null;

  function settings() {
    const c = ctx();
    if (!c) return null;
    c.extensionSettings.answerMe ??= {};
    const s = c.extensionSettings.answerMe;
    if (!['stream', 'fake'].includes(s.transportMode)) s.transportMode = 'stream';
    if (typeof s.selectedModelFamily !== 'string') s.selectedModelFamily = '';
    if (typeof s.selectedModelGroup !== 'string') s.selectedModelGroup = '';
    if (!s.modelCatalog || typeof s.modelCatalog !== 'object' || Array.isArray(s.modelCatalog)) s.modelCatalog = {};
    if (!Array.isArray(s.siteDisabledIds)) s.siteDisabledIds = [];
    if (!s.exactModelOverrides || typeof s.exactModelOverrides !== 'object' || Array.isArray(s.exactModelOverrides)) s.exactModelOverrides = {};
    if (typeof s.compactSitesOpen !== 'boolean') s.compactSitesOpen = false;
    if (typeof s.compactAdvancedOpen !== 'boolean') s.compactAdvancedOpen = false;
    return s;
  }

  function save() { try { ctx()?.saveSettingsDebounced?.(); } catch {} }
  function profiles() {
    const list = ctx()?.extensionSettings?.connectionManager?.profiles;
    return Array.isArray(list) ? list : [];
  }
  function profile(id) { return profiles().find(p => String(p?.id) === String(id)); }
  function currentId() { return String(ctx()?.extensionSettings?.connectionManager?.selectedProfile ?? ''); }
  function usable(p) {
    const service = ctx()?.ConnectionManagerRequestService;
    if (!service || !p?.id) return false;
    try { return typeof service.isProfileSupported === 'function' ? service.isProfileSupported(p) : true; }
    catch { return false; }
  }

  const FAMILY_DEFS = [
    ['gemini','Gemini'], ['claude','Claude'], ['gpt','GPT'], ['glm','GLM'], ['grok','Grok'],
    ['deepseek','DeepSeek'], ['qwen','Qwen'], ['kimi','Kimi'], ['mistral','Mistral'], ['llama','Llama'], ['gemma','Gemma'],
  ];
  function norm(v) {
    return String(v || '').normalize?.('NFKC')?.toLowerCase()?.replace(/[／]/g,'/')?.replace(/[＿]/g,'_')?.replace(/[－—–]/g,'-') ?? String(v || '').toLowerCase();
  }
  function familyInfo(model) {
    const raw = norm(model);
    let hit = null;
    for (const [needle,name] of FAMILY_DEFS) {
      const index = raw.indexOf(needle);
      if (index >= 0 && (!hit || index < hit.index)) hit = { needle, name, index };
    }
    return hit;
  }
  function tail(model, family) {
    const raw = norm(model);
    const i = family ? raw.indexOf(family.needle) : -1;
    return i >= 0 ? raw.slice(i) : raw;
  }
  function versionOf(text) {
    const m = String(text || '').match(/(?:^|[^0-9])(\d{1,2})[._-](\d{1,2})(?=[^0-9]|$)/);
    if (m) return `${Number(m[1])}.${Number(m[2])}`;
    const single = String(text || '').match(/(?:^|[^0-9])(\d)(?=[^0-9]|$)/);
    return single ? String(Number(single[1])) : '';
  }
  function variantOf(text) {
    const s = String(text || '');
    return ['non-reasoning','reasoning','multi-agent','flash-lite','flash-image','flash','pro','opus','sonnet','haiku','turbo','mini','lite','thinking','chat-fast','chat'].find(x => s.includes(x)) || '';
  }
  function autoTransport(model) {
    return /(?:假流式|假流|伪流式|伪流|非流式|整包|fake[\s._-]*stream|non[\s._-]*stream|whole[\s._-]*(?:response|stream))/.test(norm(model)) ? 'fake' : 'stream';
  }
  function canonicalKeyword(model) {
    const f = familyInfo(model);
    if (!f) return '';
    const t = tail(model,f).replace(/[\/_]+/g,'-').replace(/\s+/g,'-').replace(/-+/g,'-');
    const v = versionOf(t);
    if (!v) return '';
    const variant = variantOf(t);
    return `${f.needle}-${v}${variant ? `-${variant}` : ''}`;
  }
  function classify(profileId, model) {
    const f = familyInfo(model);
    const t = tail(model,f);
    const version = versionOf(t);
    const keyword = canonicalKeyword(model);
    const transport = autoTransport(model);
    return { raw:String(model||''), family:f?.name||'', familyNeedle:f?.needle||'', version, keyword, transport, ignored:!f||!version||!keyword };
  }

  function catalog(p) {
    const cached = settings()?.modelCatalog?.[p?.id];
    const list = Array.isArray(cached?.models) ? [...cached.models] : [];
    if (p?.model) list.push(String(p.model));
    return [...new Set(list.map(String).map(x=>x.trim()).filter(Boolean))];
  }
  function normalizeModels(json, fallback='') {
    let list = [];
    if (Array.isArray(json)) list = json;
    else if (Array.isArray(json?.data)) list = json.data;
    else if (Array.isArray(json?.models)) list = json.models;
    else if (Array.isArray(json?.data?.data)) list = json.data.data;
    const ids = list.map(x => typeof x === 'string' ? x : (x?.id ?? x?.name ?? x?.model ?? '')).map(String).map(x=>x.trim()).filter(Boolean);
    if (fallback) ids.push(String(fallback));
    return [...new Set(ids)];
  }
  async function fetchModels(p) {
    const c = ctx();
    const map = c?.CONNECT_API_MAP?.[p?.api];
    if (!c || !map || map.selected !== 'openai' || !map.source) return { models:p?.model?[String(p.model)]:[], scannedAt:Date.now(), fallback:true, error:'此连接类型暂不支持自动扫模型' };
    const body = {
      chat_completion_source: map.source,
      custom_url: p['api-url'], secret_id: p['secret-id'], vertexai_region: p['api-url'],
      zai_endpoint: p['api-url'], siliconflow_endpoint: p['api-url'], minimax_endpoint: p['api-url'],
    };
    try {
      const response = await fetch('/api/backends/chat-completions/status', { method:'POST', headers:c.getRequestHeaders(), cache:'no-cache', body:JSON.stringify(body) });
      const json = await response.json().catch(()=>({}));
      if (!response.ok || json?.error === true) throw new Error(`模型列表请求失败 ${response.status||''}`.trim());
      const models = normalizeModels(json,p.model);
      if (!models.length) throw new Error('站点没有返回模型列表');
      return { models, scannedAt:Date.now(), fallback:false, error:'' };
    } catch (e) {
      return { models:p?.model?[String(p.model)]:[], scannedAt:Date.now(), fallback:true, error:String(e?.message||e||'扫描失败') };
    }
  }
  async function mapLimited(items, limit, worker) {
    const out = new Array(items.length); let cursor = 0;
    async function runner() { while (true) { const i = cursor++; if (i >= items.length) return; out[i] = await worker(items[i],i); } }
    await Promise.all(Array.from({length:Math.min(limit,items.length)}, runner));
    return out;
  }
  async function scan(force=false) {
    if (scanPromise) return scanPromise;
    scanPromise = (async()=>{
      const s = settings(); if (!s) return [];
      const list = profiles().filter(usable);
      const targets = list.filter(p => force || !s.modelCatalog?.[p.id]?.models?.length || Date.now()-Number(s.modelCatalog[p.id]?.scannedAt||0) > TTL);
      render();
      const values = await mapLimited(targets,CONCURRENCY,fetchModels);
      values.forEach((v,i)=>{ s.modelCatalog[targets[i].id] = v; });
      save();
      return list;
    })().finally(()=>{ scanPromise=null; render(); });
    return scanPromise;
  }

  function records(mode=settings()?.transportMode||'stream', family='') {
    const out=[];
    for (const p of profiles().filter(usable)) {
      for (const model of catalog(p)) {
        const info=classify(p.id,model);
        if (info.ignored || info.transport!==mode || (family && info.family!==family)) continue;
        out.push({profile:p,model,...info});
      }
    }
    return out;
  }
  function families(mode=settings()?.transportMode||'stream') {
    const map=new Map();
    for (const r of records(mode)) { if(!map.has(r.family))map.set(r.family,new Set()); map.get(r.family).add(String(r.profile.id)); }
    return [...map].map(([name,ids])=>({name,count:ids.size})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
  }
  function activeFamily() {
    const s=settings(); const available=families();
    if (s?.selectedModelFamily && available.some(x=>x.name===s.selectedModelFamily)) return s.selectedModelFamily;
    const p=profile(currentId()); const f=p?.model?classify(p.id,p.model).family:'';
    return available.some(x=>x.name===f)?f:(available[0]?.name||'');
  }
  function matchScore(model, wanted) {
    const raw=norm(model).replace(/[\/_]+/g,'-').replace(/\s+/g,'-').replace(/-+/g,'-');
    const key=canonicalKeyword(model);
    if(!wanted)return 0; if(key===wanted)return 100; if(raw.includes(wanted))return 95;
    if(key&&(key.includes(wanted)||wanted.includes(key)))return 80; return 0;
  }
  function groups() {
    const s=settings(); const mode=s?.transportMode||'stream'; const family=activeFamily();
    if(!family)return[];
    const byVersion=new Map();
    for(const r of records(mode,family)){if(!byVersion.has(r.version))byVersion.set(r.version,[]);byVersion.get(r.version).push(r)}
    const out=[];
    for(const [version,recs] of byVersion){
      const coverage=new Map();
      for(const r of recs){if(!coverage.has(r.keyword))coverage.set(r.keyword,new Set());coverage.get(r.keyword).add(String(r.profile.id))}
      const current=profile(currentId()); const ci=current?.model?classify(current.id,current.model):null;
      const keyword=(ci?.family===family&&ci?.version===version&&ci?.transport===mode?ci.keyword:'') || [...coverage].sort((a,b)=>b[1].size-a[1].size||a[0].length-b[0].length)[0]?.[0] || '';
      const matches=new Map();
      const per=new Map();
      for(const r of recs){const id=String(r.profile.id);if(!per.has(id))per.set(id,[]);per.get(id).push(r)}
      for(const [id,list] of per){
        const scored=list.map(r=>({r,score:matchScore(r.model,keyword)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||String(a.r.model).length-String(b.r.model).length);
        if(scored.length){const top=scored[0].score;matches.set(id,scored.filter(x=>x.score===top).map(x=>x.r.model))}
      }
      if(matches.size) out.push({key:`${family}:${version}`,label:version,display:version,version,family,keyword,matches,profileCount:matches.size,transportMode:mode});
    }
    return out.sort((a,b)=>(Number.parseFloat(b.version)||0)-(Number.parseFloat(a.version)||0)||b.profileCount-a.profileCount);
  }
  function selected() {
    const list=groups(),s=settings();
    return list.find(g=>g.key===s?.selectedModelGroup) || list.find(g=>g.version===classify(currentId(),profile(currentId())?.model).version) || list[0] || null;
  }
  function exactKey(id,g){return `${encodeURIComponent(String(id))}::${g.family}::${g.version}::${g.transportMode}`}
  function disabledSet(){return new Set((settings()?.siteDisabledIds||[]).map(String))}
  function eligibleIds(){return selected()?.matches?.keys?[...selected().matches.keys()].map(String):[]}
  function selectedIds(){const d=disabledSet();return eligibleIds().filter(id=>!d.has(id))}

  async function switchCurrentIfNeeded(ids) {
    if(!ids.length||ids.includes(currentId()))return;
    const target=profile(ids[0]); if(!target)return;
    const select=document.querySelector('#connection_profiles');
    if(select){select.value=target.id;select.dispatchEvent(new Event('change',{bubbles:true}));await sleep(450)}
    else {ctx().extensionSettings.connectionManager.selectedProfile=target.id;save()}
  }
  function chooseModel(p,g) {
    const candidates=g?.matches?.get?.(String(p.id))||[];
    if(!candidates.length)return'';
    const exact=settings()?.exactModelOverrides?.[exactKey(p.id,g)];
    if(exact&&candidates.includes(exact))return exact;
    if(candidates.includes(p.model))return p.model;
    return candidates.map(model=>({model,score:matchScore(model,g.keyword)})).sort((a,b)=>b.score-a.score||String(a.model).length-String(b.model).length)[0]?.model||candidates[0];
  }
  function syncNativeStream() {
    const want=settings()?.transportMode==='stream';
    const input=document.querySelector('#stream_toggle');
    if(input&&input.type==='checkbox'&&input.checked!==want){input.checked=want;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))}
  }
  async function apply(group=selected(), {switchCurrent=true}={}) {
    if(applying||!group)return false; applying=true;
    try{
      const s=settings(); const d=disabledSet(); let ids=[...group.matches.keys()].map(String).filter(id=>!d.has(id));
      if(!ids.length&&group.matches.size){const first=String(group.matches.keys().next().value);d.delete(first);s.siteDisabledIds=[...d];ids=[first]}
      const assignments=[];
      for(const id of ids){const p=profile(id);if(!p)continue;const model=chooseModel(p,group);if(model)p.model=model;assignments.push({profile:p.name||id,model,keyword:group.keyword,transportMode:s.transportMode})}
      s.selectedModelFamily=group.family;s.selectedModelGroup=group.key;s.profileIds=ids;s.lastModelAssignments=assignments;s.lastModelAssignmentsTransport=s.transportMode;
      save();syncNativeStream();if(switchCurrent)await switchCurrentIfNeeded(ids);window.AnswerMe?.refresh?.();render();return true;
    }finally{applying=false}
  }
  async function selectGroup(key){const g=groups().find(x=>x.key===key);if(!g)return{ok:false,reason:'没有这个模型档'};await apply(g);return{ok:true}}
  async function setFamily(name){const s=settings();s.selectedModelFamily=name;s.selectedModelGroup='';save();const g=groups()[0];if(g)await apply(g);render();return!!g}
  async function setTransport(mode){if(!['stream','fake'].includes(mode))return false;const s=settings();s.transportMode=mode;s.selectedModelGroup='';save();syncNativeStream();const fam=families(mode);if(!fam.some(x=>x.name===s.selectedModelFamily))s.selectedModelFamily=fam[0]?.name||'';const g=groups()[0];if(g)await apply(g);else{s.profileIds=[];save();render()}return true}
  async function toggleSite(id){id=String(id);const s=settings(),eligible=eligibleIds();if(!eligible.includes(id))return;const d=disabledSet();const on=!d.has(id);if(on&&selectedIds().length<=1){window.toastr?.warning?.('至少留一家参赛。','💢 Answer Me');return}on?d.add(id):d.delete(id);s.siteDisabledIds=[...d];save();await apply(selected(),{switchCurrent:true});render()}
  async function selectAll(){const s=settings(),eligible=new Set(eligibleIds());s.siteDisabledIds=(s.siteDisabledIds||[]).filter(id=>!eligible.has(String(id)));save();await apply(selected());render()}
  async function onlyCurrent(){const s=settings(),eligible=eligibleIds();if(!eligible.length)return;const keep=eligible.includes(currentId())?currentId():eligible[0];const d=disabledSet();for(const id of eligible){if(id===keep)d.delete(id);else d.add(id)}s.siteDisabledIds=[...d];save();await apply(selected());render()}
  async function setExact(id,model){const g=selected(),s=settings(),p=profile(id);if(!g||!p)return;const k=exactKey(id,g);if(model)s.exactModelOverrides[k]=model;else delete s.exactModelOverrides[k];save();await apply(g,{switchCurrent:false});render()}

  function styles(){
    if(document.getElementById(STYLE_ID))return;
    const el=document.createElement('style');el.id=STYLE_ID;el.textContent=`
      #${UI_ID}{margin:10px 0 12px;padding:11px;border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.12));border-radius:14px;background:linear-gradient(145deg,rgba(127,127,127,.075),rgba(127,127,127,.035));box-shadow:0 5px 18px rgba(0,0,0,.04)}
      #${UI_ID} .top{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-bottom:9px}#${UI_ID} .main{font-weight:800}#${UI_ID} .badge{font-size:.75em;opacity:.68;padding:2px 7px;border-radius:999px;background:rgba(127,127,127,.1)}
      #${UI_ID} .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}#${UI_ID} .field{display:grid;gap:4px}#${UI_ID} .field>span{font-size:.72em;opacity:.64;font-weight:700}#${UI_ID} select{width:100%;height:34px;padding:4px 28px 4px 9px;border-radius:9px;border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.14));background:rgba(127,127,127,.06);color:inherit}
      #${UI_ID} .modes{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}#${UI_ID} button{color:inherit;cursor:pointer}#${UI_ID} .modes button,#${UI_ID} .mini,#${UI_ID} .site{border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.14));background:rgba(127,127,127,.055);border-radius:9px;padding:7px 8px}#${UI_ID} .on{font-weight:800;background:rgba(127,127,127,.19)}
      #${UI_ID} .section{margin-top:9px;padding-top:9px;border-top:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.09))}#${UI_ID} .head{display:flex;justify-content:space-between;gap:8px;cursor:pointer}#${UI_ID} .title{font-size:.85em;font-weight:750}#${UI_ID} .meta{font-size:.76em;opacity:.62}#${UI_ID} .sites{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:8px}#${UI_ID} .site{text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#${UI_ID} .site.off{opacity:.42}#${UI_ID} .links,#${UI_ID} .advanced{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}#${UI_ID} .link{border:0;background:transparent;padding:0;font-size:.78em;opacity:.7}#${UI_ID} .note{font-size:.75em;opacity:.58;margin-top:7px;word-break:break-word}
      #${UI_ID} .exact{display:grid;grid-template-columns:minmax(80px,.7fr) minmax(0,1.3fr);gap:6px;align-items:center;margin-top:6px}#${UI_ID} .exact span{font-size:.76em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      @media(max-width:700px){#${UI_ID}{padding:10px}#${UI_ID} .exact{grid-template-columns:1fr}}
    `;document.head.appendChild(el);
  }
  function option(value,text){const o=document.createElement('option');o.value=value;o.textContent=text;return o}
  function mount(){
    const root=document.querySelector('#answer_me_settings');if(!root)return null;styles();
    let box=root.querySelector('#'+UI_ID);if(!box){box=document.createElement('div');box.id=UI_ID;const note=root.querySelector('.answer-me-note');note?.insertAdjacentElement('afterend',box)}
    return box;
  }
  function render(){
    const box=mount(),s=settings();if(!box||!s)return;
    const g=selected(),fam=activeFamily(),fl=families(),gl=groups(),eligible=eligibleIds(),picked=new Set(selectedIds());
    box.replaceChildren();
    const top=document.createElement('div');top.className='top';top.innerHTML=`<span class="main">${g?`${g.family} ${g.version}`:(fam||'未选模型')}</span><span class="badge">${s.transportMode==='stream'?'🟢 真流':'📦 假流'}</span><span class="badge">${picked.size}/${eligible.length} 家</span>`;box.appendChild(top);
    const grid=document.createElement('div');grid.className='grid';
    const familyLabel=document.createElement('label');familyLabel.className='field';familyLabel.innerHTML='<span>模型系列</span>';const familySel=document.createElement('select');fl.forEach(x=>familySel.appendChild(option(x.name,`${x.name} · ${x.count}`)));familySel.value=fam;familySel.onchange=()=>void setFamily(familySel.value);familyLabel.appendChild(familySel);
    const verLabel=document.createElement('label');verLabel.className='field';verLabel.innerHTML='<span>版本</span>';const verSel=document.createElement('select');gl.forEach(x=>verSel.appendChild(option(x.key,`${x.version} · ${x.profileCount}家`)));verSel.value=g?.key||'';verSel.onchange=()=>void selectGroup(verSel.value);verLabel.appendChild(verSel);grid.append(familyLabel,verLabel);box.appendChild(grid);
    const modes=document.createElement('div');modes.className='modes';for(const [value,text] of [['stream','🟢 真流式'],['fake','📦 假流式']]){const b=document.createElement('button');b.type='button';b.textContent=text;b.classList.toggle('on',s.transportMode===value);b.onclick=()=>void setTransport(value);modes.appendChild(b)}box.appendChild(modes);
    const sitesSec=document.createElement('div');sitesSec.className='section';const sitesHead=document.createElement('div');sitesHead.className='head';sitesHead.innerHTML=`<span class="title">${s.compactSitesOpen?'▾':'▸'} 参赛站</span><span class="meta">${picked.size}/${eligible.length} 家</span>`;sitesHead.onclick=()=>{s.compactSitesOpen=!s.compactSitesOpen;save();render()};sitesSec.appendChild(sitesHead);
    if(s.compactSitesOpen){const sites=document.createElement('div');sites.className='sites';for(const id of eligible){const p=profile(id);if(!p)continue;const b=document.createElement('button');b.type='button';b.className=`site ${picked.has(id)?'on':'off'}`;b.textContent=`${picked.has(id)?'✓':'○'} ${p.name||'未命名站'}`;b.onclick=()=>void toggleSite(id);sites.appendChild(b)}sitesSec.appendChild(sites);const links=document.createElement('div');links.className='links';for(const [text,fn] of [['全选可用站',selectAll],['只留当前站',onlyCurrent]]){const b=document.createElement('button');b.type='button';b.className='link';b.textContent=text;b.onclick=()=>void fn();links.appendChild(b)}sitesSec.appendChild(links)}box.appendChild(sitesSec);
    const adv=document.createElement('div');adv.className='section';const advHead=document.createElement('div');advHead.className='head';const scanned=profiles().filter(p=>s.modelCatalog?.[p.id]?.fallback===false).length;advHead.innerHTML=`<span class="title">${s.compactAdvancedOpen?'▾':'▸'} 高级设置</span><span class="meta">${scanned}/${profiles().length} 家已扫描</span>`;advHead.onclick=()=>{s.compactAdvancedOpen=!s.compactAdvancedOpen;save();render()};adv.appendChild(advHead);
    if(s.compactAdvancedOpen){const body=document.createElement('div');body.className='advBody';const actions=document.createElement('div');actions.className='advanced';const scanBtn=document.createElement('button');scanBtn.type='button';scanBtn.className='mini';scanBtn.textContent=scanPromise?'↻ 正在扫描…':'↻ 重扫模型';scanBtn.disabled=!!scanPromise;scanBtn.onclick=async()=>{await scan(true);const sg=selected();if(sg)await apply(sg,{switchCurrent:false});render()};actions.appendChild(scanBtn);body.appendChild(actions);
      if(g){for(const id of picked){const p=profile(id),models=g.matches.get(id)||[];if(!p||!models.length)continue;const row=document.createElement('label');row.className='exact';const name=document.createElement('span');name.textContent=p.name||id;const sel=document.createElement('select');sel.appendChild(option('','自动匹配'));for(const m of models)sel.appendChild(option(m,m));const saved=s.exactModelOverrides?.[exactKey(id,g)]||'';sel.value=models.includes(saved)?saved:'';sel.onchange=()=>void setExact(id,sel.value);row.append(name,sel);body.appendChild(row)}}
      const note=document.createElement('div');note.className='note';note.textContent=g?.keyword?`当前关键模型名：${g.keyword} · 这里只在操作时更新，不再后台反复扫描/重建 UI。`:'暂无模型档';body.appendChild(note);adv.appendChild(body)}box.appendChild(adv);
    window.AnswerMeDiagnostics?.mount?.();
  }

  window.AnswerMeModelRouter={version:VERSION,groups,classify,canonicalKeyword,autoTransport,scan,get selected(){return selected()},get transportMode(){return settings()?.transportMode||'stream'},get family(){return activeFamily()},select:selectGroup,setTransport,setFamily,setKeyword(){return false}};
  window.AnswerMeSiteSelector={version:VERSION,get eligibleIds(){return eligibleIds()},get selectedIds(){return selectedIds()},get disabledIds(){return[...disabledSet()]},toggle:toggleSite,selectAll,onlyCurrent,apply:async()=>await apply(selected())};
  window.AnswerMeControlPanel={version:VERSION,render,scan,apply};

  async function boot(){
    for(let i=0;i<120;i++){if(ctx()&&document.querySelector('#answer_me_settings'))break;await sleep(100)}
    syncNativeStream();
    await scan(false);
    const g=selected();if(g)await apply(g,{switchCurrent:false});
    render();
    const source=ctx()?.eventSource,events=ctx()?.eventTypes||ctx()?.event_types;
    if(source&&events?.CONNECTION_PROFILE_LOADED)source.on(events.CONNECTION_PROFILE_LOADED,()=>setTimeout(render,0));
    console.log(`[💢 Answer Me] control panel ${VERSION} ready · event-driven, no observer, no polling`);
  }
  boot().catch(e=>console.error('[💢 Answer Me] control panel v34 failed',e));
})();
