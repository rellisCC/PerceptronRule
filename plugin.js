/* Perceptron Trainer CODAP Plugin
   Uses CODAP Data Interactive Plugin API via iframe-phone.
   Docs: https://github.com/concord-consortium/codap/wiki/CODAP-Data-Interactive-Plugin-API
*/
(() => {
  const $ = (s)=>document.querySelector(s);
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const sign=(z)=> z>=0 ? 1 : -1;

  // Fixed world coords for the small SVG graph
  const world={xmin:-4,xmax:4,ymin:-3,ymax:3}, svgSize={w:600,h:400};
  const xToPx=(x)=>((x-world.xmin)/(world.xmax-world.xmin))*svgSize.w;
  const yToPx=(y)=>(1-(y-world.ymin)/(world.ymax-world.ymin))*svgSize.h;

  let phone=null;

  function request(cmd){
    return new Promise((resolve,reject)=>{
      if(!phone) return reject(new Error("Not connected"));
      phone.call(cmd,(res)=>{
        if(!res) return reject(new Error("No response"));
        if(res.success===false) return reject(res);
        resolve(res);
      });
    });
  }

  async function connect(){
    phone = new iframePhone.IframePhoneRpcEndpoint(
      window,
      (msg)=>window.parent.postMessage(msg,"*"),
      ()=>{}
    );
    // Set interactive frame metadata
    try{
      await request({action:"update",resource:"interactiveFrame",values:{name:"Perceptron Trainer",title:"Perceptron Trainer"}});
    }catch(e){ /* non-fatal */ }
  }

  const state={
    dataContextName:null,
    collectionName:null,
    cases:[],
    index:0,
    epoch:0,
    w1:0.4,w2:-0.4,c:2,learnRate:0.1,
    phase:"TRAIN_SINGLE" // or EVAL
  };

  const viz=$("#viz");

  const fmt=(n)=> (typeof n==="number" && isFinite(n)) ? (Math.round(n*1000)/1000).toString() : "—";

  // ---- CODAP dataset helpers ----
  async function dataContextList(){
    const res = await request({action:"get",resource:"dataContextList"});
    return res.values||[];
  }

  async function attachByName(name){
    const dc = await request({action:"get",resource:`dataContext[${name}]`});
    const col = (dc.values?.collections||[])[0];
    if(!col) throw new Error("No collections in dataset");
    const attrNames = new Set((col.attrs||[]).map(a=>a.name));
    for(const req of ["x","y","Sentiment"]){
      if(!attrNames.has(req)) throw new Error(`Missing required attribute: ${req}`);
    }
    state.dataContextName=name;
    state.collectionName=col.name;
  }

  async function loadAllCases(){
    const dc=state.dataContextName, col=state.collectionName;
    if(!dc||!col) return;
    const res = await request({action:"get",resource:`dataContext[${dc}].collection[${col}].allCases`});
    const raw = (res.values && (res.values.cases||res.values)) || [];
    state.cases = raw.map(ca=>({
      id: ca.id,
      values: {
        x:+(ca.values?.x ?? ca.case?.x ?? ca.x),
        y:+(ca.values?.y ?? ca.case?.y ?? ca.y),
        Sentiment:+(ca.values?.Sentiment ?? ca.case?.Sentiment ?? ca.Sentiment)
      }
    }));
    state.index=0; state.epoch=0;
  }

  async function ensureSample(){
    const dc=window.SAMPLE_DATASET.dataContextName;
    const col=window.SAMPLE_DATASET.collectionName;

    await request({
      action:"create",
      resource:"dataContext",
      values:{
        name:dc,
        title:window.SAMPLE_DATASET.title,
        collections:[{
          name:col,
          title:"Training Cases",
          labels:{singleCase:"case",pluralCase:"cases"},
          attrs:window.SAMPLE_DATASET.attrs
        }]
      }
    });

    // Best-effort delete all cases; selector can vary by CODAP build.
    const deleteSelectors=[
      `dataContext[${dc}].collection[${col}].allCases`,
      `dataContext[${dc}].collection[${col}].cases`
    ];
    for(const r of deleteSelectors){
      try{ await request({action:"delete",resource:r}); break; }catch(e){}
    }

    await request({
      action:"create",
      resource:`dataContext[${dc}].collection[${col}].case`,
      values: window.SAMPLE_DATASET.cases
    });

    state.dataContextName=dc; state.collectionName=col;
    await loadAllCases();
  }

  // ---- perceptron ----
  const score=(pt)=> state.w1*pt.x + state.w2*pt.y + state.c;
  const pred=(pt)=> sign(score(pt));
  const deltas=(pt,s)=>({dw1:state.learnRate*s*pt.x, dw2:state.learnRate*s*pt.y, dc:state.learnRate*s});
  const currentCase=()=> state.cases.length ? state.cases[state.index % state.cases.length] : null;

  // ---- viz ----
  function clearViz(){ while(viz.firstChild) viz.removeChild(viz.firstChild); }

  function drawAxes(){
    for(let xi=Math.ceil(world.xmin); xi<=Math.floor(world.xmax); xi++){
      const l=document.createElementNS("http://www.w3.org/2000/svg","line");
      l.setAttribute("x1",xToPx(xi)); l.setAttribute("x2",xToPx(xi));
      l.setAttribute("y1",0); l.setAttribute("y2",svgSize.h);
      l.setAttribute("stroke","#f0f0f0"); viz.appendChild(l);
    }
    for(let yi=Math.ceil(world.ymin); yi<=Math.floor(world.ymax); yi++){
      const l=document.createElementNS("http://www.w3.org/2000/svg","line");
      l.setAttribute("x1",0); l.setAttribute("x2",svgSize.w);
      l.setAttribute("y1",yToPx(yi)); l.setAttribute("y2",yToPx(yi));
      l.setAttribute("stroke","#f0f0f0"); viz.appendChild(l);
    }
  }

  function boundarySegment(w1,w2,c){
    const pts=[];
    const add=(x,y)=>{
      if(isFinite(x)&&isFinite(y) && x>=world.xmin-1e-6 && x<=world.xmax+1e-6 && y>=world.ymin-1e-6 && y<=world.ymax+1e-6)
        pts.push({x,y});
    };
    if(Math.abs(w2)>1e-9){ add(world.xmin,(-c-w1*world.xmin)/w2); add(world.xmax,(-c-w1*world.xmax)/w2); }
    if(Math.abs(w1)>1e-9){ add((-c-w2*world.ymin)/w1,world.ymin); add((-c-w2*world.ymax)/w1,world.ymax); }
    const uniq=[];
    for(const p of pts) if(!uniq.some(q=>Math.abs(q.x-p.x)<1e-6 && Math.abs(q.y-p.y)<1e-6)) uniq.push(p);
    return uniq.slice(0,2);
  }

  function drawBoundary(w1,w2,c,opts={}){
    const seg=boundarySegment(w1,w2,c); if(seg.length<2) return;
    const [p1,p2]=seg;
    const l=document.createElementNS("http://www.w3.org/2000/svg","line");
    l.setAttribute("x1",xToPx(p1.x)); l.setAttribute("y1",yToPx(p1.y));
    l.setAttribute("x2",xToPx(p2.x)); l.setAttribute("y2",yToPx(p2.y));
    l.setAttribute("stroke",opts.stroke||"#111");
    l.setAttribute("stroke-width",opts.width||2);
    if(opts.dash) l.setAttribute("stroke-dasharray",opts.dash);
    if(opts.opacity!=null) l.setAttribute("opacity",opts.opacity);
    viz.appendChild(l);
  }

  function drawShade(w1,w2,c){
    const rect=[{x:world.xmin,y:world.ymin},{x:world.xmax,y:world.ymin},{x:world.xmax,y:world.ymax},{x:world.xmin,y:world.ymax}];
    const inside=(p)=>(w1*p.x+w2*p.y+c)>=0;
    const intersect=(A,B)=>{
      const fA=w1*A.x+w2*A.y+c, fB=w1*B.x+w2*B.y+c;
      const t=fA/(fA-fB);
      return {x:A.x+t*(B.x-A.x), y:A.y+t*(B.y-A.y)};
    };
    let out=[];
    for(let i=0;i<rect.length;i++){
      const A=rect[i], B=rect[(i+1)%rect.length];
      const Ain=inside(A), Bin=inside(B);
      if(Ain && Bin) out.push(B);
      else if(Ain && !Bin) out.push(intersect(A,B));
      else if(!Ain && Bin){ out.push(intersect(A,B)); out.push(B); }
    }
    if(out.length<3) return;
    const poly=document.createElementNS("http://www.w3.org/2000/svg","polygon");
    poly.setAttribute("points", out.map(p=>`${xToPx(p.x)},${yToPx(p.y)}`).join(" "));
    poly.setAttribute("fill","rgba(255,165,0,0.18)");
    viz.appendChild(poly);
  }

  function drawPoint(pt,sent,r=8){
    const c=document.createElementNS("http://www.w3.org/2000/svg","circle");
    c.setAttribute("cx",xToPx(pt.x)); c.setAttribute("cy",yToPx(pt.y)); c.setAttribute("r",r);
    c.setAttribute("fill", sent===1 ? "orange" : "purple");
    c.setAttribute("stroke","#111"); c.setAttribute("stroke-width","1");
    viz.appendChild(c);
  }

  function render(showAll=false, ghost=null){
    clearViz();
    drawAxes();
    // Shade for current/animated boundary
    drawShade(state.w1,state.w2,state.c);
    if(ghost) drawBoundary(ghost.w1,ghost.w2,ghost.c,{stroke:"#555",dash:"6 6",opacity:0.6});
    drawBoundary(state.w1,state.w2,state.c);

    if(showAll){
      for(const ca of state.cases) drawPoint({x:ca.values.x,y:ca.values.y}, ca.values.Sentiment, 6);
    } else {
      const ca=currentCase();
      if(ca) drawPoint({x:ca.values.x,y:ca.values.y}, ca.values.Sentiment, 8);
    }
  }

  function updateModelUI(){
    $("#w1Val").textContent=fmt(state.w1);
    $("#w2Val").textContent=fmt(state.w2);
    $("#cVal").textContent=fmt(state.c);
    $("#lrVal").textContent=fmt(state.learnRate);
    $("#w1").value=state.w1; $("#w2").value=state.w2; $("#c").value=state.c; $("#lr").value=state.learnRate;
  }

  function updatePanel(){
    const ca=currentCase();
    if(!ca){
      $("#ptInfo").textContent="—"; $("#indexInfo").textContent="—"; $("#epochInfo").textContent=fmt(state.epoch);
      $("#scoreInfo").textContent="—"; $("#predInfo").textContent="—"; $("#sentInfo").textContent="—";
      $("#mistakeInfo").textContent="—"; $("#deltaInfo").textContent="";
      return;
    }
    const pt={x:ca.values.x,y:ca.values.y};
    const s=ca.values.Sentiment;
    const z=score(pt);
    const p=sign(z);
    const ok=p===s;
    $("#ptInfo").textContent=`(${fmt(pt.x)}, ${fmt(pt.y)})`;
    $("#indexInfo").textContent=`${(state.index%state.cases.length)+1}/${state.cases.length}`;
    $("#epochInfo").textContent=fmt(state.epoch);
    $("#scoreInfo").textContent=fmt(z);
    $("#predInfo").textContent=p===1?"+1 (positive)":"-1 (negative)";
    $("#sentInfo").textContent=s===1?"+1 (positive)":"-1 (negative)";
    $("#mistakeInfo").textContent=ok?"No":"Yes";
    $("#deltaInfo").textContent= ok ? "" : (()=>{const d=deltas(pt,s); return `Δw1=${fmt(d.dw1)}  Δw2=${fmt(d.dw2)}  Δc=${fmt(d.dc)}`;})();
  }

  function alertCheck(msg){
    $("#alertMsg").textContent=msg;
    $("#alertDlg").showModal();
  }

  function nextCase(){
    if(!state.cases.length) return;
    const prev=state.index%state.cases.length;
    state.index=(state.index+1)%state.cases.length;
    if(prev===state.cases.length-1 && (state.index%state.cases.length)===0) state.epoch+=1;
    updatePanel(); render(false);
  }

  async function animateTo(newW, ghost){
    const old={w1:state.w1,w2:state.w2,c:state.c};
    const start=performance.now(), dur=600;
    return new Promise((resolve)=>{
      function tick(now){
        const t=clamp((now-start)/dur,0,1);
        const u = t<0.5 ? 2*t*t : 1- Math.pow(-2*t+2,2)/2;
        state.w1=old.w1+(newW.w1-old.w1)*u;
        state.w2=old.w2+(newW.w2-old.w2)*u;
        state.c =old.c +(newW.c -old.c )*u;
        updateModelUI(); updatePanel();
        render(false, ghost);
        if(t<1) requestAnimationFrame(tick);
        else resolve();
      }
      requestAnimationFrame(tick);
    });
  }

  function evaluate(){
    let correct=0, mse=0;
    for(const ca of state.cases){
      const x=ca.values.x, y=ca.values.y, s=ca.values.Sentiment;
      const z=state.w1*x+state.w2*y+state.c;
      if(sign(z)===s) correct++;
      const e=s-z; mse += e*e;
    }
    const n=state.cases.length;
    return {n, acc: correct/n, mse: mse/n};
  }

  // ---- UI wiring ----
  function wire(){
    const bind=(id,key)=>{
      $(id).addEventListener("input",(e)=>{
        state[key]=parseFloat(e.target.value);
        updateModelUI(); updatePanel(); render(state.phase==="EVAL");
      });
    };
    bind("#w1","w1"); bind("#w2","w2"); bind("#c","c"); bind("#lr","learnRate");

    $("#resetModelBtn").addEventListener("click",()=>{
      state.w1=0.4; state.w2=-0.4; state.c=2; state.learnRate=0.1;
      updateModelUI(); updatePanel(); render(state.phase==="EVAL");
    });

    $("#alertOk").addEventListener("click",()=>$("#alertDlg").close());

    $("#btnCorrect").addEventListener("click",()=>{
      const ca=currentCase(); if(!ca) return;
      const pt={x:ca.values.x,y:ca.values.y}; const s=ca.values.Sentiment;
      if(sign(score(pt))!==s) return alertCheck("Check again! Does the current rule properly predict this point?");
      nextCase();
    });

    $("#btnFail").addEventListener("click", async ()=>{
      const ca=currentCase(); if(!ca) return;
      const pt={x:ca.values.x,y:ca.values.y}; const s=ca.values.Sentiment;
      if(sign(score(pt))===s) return alertCheck("Check again! This point is already predicted correctly.");
      const d=deltas(pt,s);
      const ghost={w1:state.w1,w2:state.w2,c:state.c};
      const newW={w1:state.w1+d.dw1,w2:state.w2+d.dw2,c:state.c+d.dc};
      $("#btnNextAfterImprove").disabled=true;
      await animateTo(newW, ghost);
      $("#btnNextAfterImprove").disabled=false;
    });

    $("#btnNextAfterImprove").addEventListener("click",()=>{
      $("#btnNextAfterImprove").disabled=true;
      nextCase();
    });

    $("#evaluateBtn").addEventListener("click",()=>{
      if(!state.cases.length) return;
      state.phase="EVAL";
      render(true);
      const stats=evaluate();
      $("#evalSummary").textContent =
        `Cases: ${stats.n}\nAccuracy: ${(stats.acc*100).toFixed(1)}%\nMSE: ${stats.mse.toFixed(3)}\n\nModel: w1=${fmt(state.w1)}  w2=${fmt(state.w2)}  c=${fmt(state.c)}`;
      $("#evalDlg").showModal();
    });

    $("#evalClose").addEventListener("click",()=>{
      $("#evalDlg").close();
      state.phase="TRAIN_SINGLE";
      render(false);
      updatePanel();
    });

    $("#refreshBtn").addEventListener("click", refreshList);
    $("#loadSampleBtn").addEventListener("click", async ()=>{
      $("#dataStatus").textContent="Loading sample dataset…";
      try{
        await ensureSample();
        $("#dataStatus").textContent=`Loaded sample dataset (${state.cases.length} cases).`;
        updatePanel(); render(false);
      }catch(e){
        console.error(e);
        $("#dataStatus").textContent="Failed to load sample dataset (see console).";
      }
    });

    $("#datasetSelect").addEventListener("change", async (e)=>{
      const val=e.target.value;
      if(val==="__sample__"){
        $("#dataStatus").textContent="Sample dataset selected. Click 'Load/Reset Sample Dataset' to create it.";
        return;
      }
      $("#dataStatus").textContent=`Attaching to dataset: ${val}…`;
      try{
        await attachByName(val);
        await loadAllCases();
        $("#dataStatus").textContent=`Attached to ${val} (${state.cases.length} cases).`;
        updatePanel(); render(false);
      }catch(err){
        console.error(err);
        $("#dataStatus").textContent=`Could not attach: ${err.message||"error"}`;
      }
    });
  }

  async function refreshList(){
    $("#dataStatus").textContent="Refreshing dataset list…";
    try{
      const list=await dataContextList();
      const sel=$("#datasetSelect");
      sel.innerHTML="";
      const o=document.createElement("option");
      o.value="__sample__"; o.textContent="Sample Dataset";
      sel.appendChild(o);
      for(const dc of list){
        const opt=document.createElement("option");
        opt.value=dc.name;
        opt.textContent=dc.title ? `${dc.title} (${dc.name})` : dc.name;
        sel.appendChild(opt);
      }
      $("#dataStatus").textContent="Choose a dataset.";
    }catch(e){
      console.error(e);
      $("#dataStatus").textContent="Could not load dataContextList (see console).";
    }
  }

  async function boot(){
    updateModelUI();
    wire();
    try{
      await connect();
      $("#dataStatus").textContent="Connected to CODAP.";
      await refreshList();
      $("#modelStatus").textContent="Ready.";
      render(false);
      updatePanel();
    }catch(e){
      console.error(e);
      $("#dataStatus").textContent="Open this page as a CODAP plugin (iframe) to connect.";
      $("#modelStatus").textContent="Not connected.";
      render(false);
    }
  }

  window.addEventListener("load", boot);
})();
