/**
 * 大麦抢票脚本 sniper.js  v3.0
 * ─────────────────────────────────────────────────
 * 新增：刷新自恢复机制
 *   刷新前把自身 src 写入 sessionStorage
 *   同时在 <head> 注入一个内联恢复脚本
 *   页面加载完成后自动重新加载主脚本
 * ─────────────────────────────────────────────────
 * 方案 A：伪造 UA → 刷新 → 检测是否解除拦截
 * 方案 C：Cookie 注入 → 刷新 → 检测是否解除拦截
 * ─────────────────────────────────────────────────
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════
     0. 防重复注入
  ══════════════════════════════════════════════════ */
  if (window.__DMS__) {
    var _p = document.getElementById('__dms_panel__');
    if (_p) _p.style.display = _p.style.display === 'none' ? '' : 'none';
    return;
  }
  window.__DMS__ = true;

  /* ══════════════════════════════════════════════════
     1. 记录自身 src（刷新恢复用）
  ══════════════════════════════════════════════════ */
  var SELF_SRC = '';
  try {
    var scripts = document.querySelectorAll('script');
    for (var _i = scripts.length - 1; _i >= 0; _i--) {
      if (scripts[_i].src && scripts[_i].src.indexOf('sniper.js') > -1) {
        SELF_SRC = scripts[_i].src;
        break;
      }
    }
  } catch(e) {}

  var SS = {
    SRC:   '__dms_src__',    // 脚本自身 src
    PLANA: '__dms_planA__',  // 方案A刷新标记
    PLANC: '__dms_planC__',  // 方案C刷新标记
  };

  // 把自身 src 存入 sessionStorage，刷新后恢复脚本用
  if (SELF_SRC) {
    try { sessionStorage.setItem(SS.SRC, SELF_SRC); } catch(e) {}
  }

  /* ══════════════════════════════════════════════════
     2. 刷新前注入自恢复脚本
        页面重载后，恢复脚本在 DOMContentLoaded 时
        自动重新加载主脚本，实现"无感续跑"
  ══════════════════════════════════════════════════ */
  function injectRecoveryScript() {
    // 避免重复注入
    if (document.getElementById('__dms_recovery__')) return;

    var src = SELF_SRC || '';
    try { src = sessionStorage.getItem(SS.SRC) || src; } catch(e) {}
    if (!src) return;

    // 内联脚本：页面加载后重新拉取主脚本
    var inlineCode = [
      '(function(){',
        'var src=sessionStorage.getItem("' + SS.SRC + '");',
        'if(!src)return;',
        // 生成新的带时间戳 src（保留原有参数，只更新 t=）
        'try{',
          'var u=new URL(src);',
          'u.searchParams.set("t",Date.now());',
          'src=u.toString();',
        '}catch(e){}',
        'var s=document.createElement("script");',
        's.src=src;',
        'document.head.appendChild(s);',
      '})();',
    ].join('');

    var el = document.createElement('script');
    el.id = '__dms_recovery__';
    el.textContent = inlineCode;
    // 插入到 <head> 最前面，确保尽早执行
    var head = document.head || document.documentElement;
    head.insertBefore(el, head.firstChild);
  }

  /* ══════════════════════════════════════════════════
     3. 统一刷新入口（每次刷新前都调用）
  ══════════════════════════════════════════════════ */
  function reloadWithRecovery(flagKey, delayMs) {
    injectRecoveryScript();
    try { sessionStorage.setItem(flagKey, '1'); } catch(e) {}
    setTimeout(function() { location.reload(); }, delayMs || 800);
  }

  /* ══════════════════════════════════════════════════
     4. 读取配置（URL 参数优先，localStorage 兜底）
  ══════════════════════════════════════════════════ */
  function getParam(key) {
    try {
      if (SELF_SRC) return new URL(SELF_SRC).searchParams.get(key) || '';
    } catch(e) {}
    return '';
  }

  var lsCfg = {};
  try { lsCfg = JSON.parse(localStorage.getItem('ts_snipe_config') || '{}'); } catch(e) {}

  var lsCookie = '';
  try { lsCookie = localStorage.getItem('dms_cookie') || ''; } catch(e) {}

  var CONFIG = {
    saleTime:      getParam('sale')  || lsCfg.saleTime  || null,
    planName:      decodeURIComponent(getParam('plan')  || lsCfg.planName  || ''),
    planPrice:     parseFloat(getParam('price') || lsCfg.planPrice) || 0,
    audienceNames: (function() {
                     var n = getParam('names') || (lsCfg.audienceNames || []).join(',');
                     return n ? decodeURIComponent(n).split(',')
                       .map(function(s){ return s.trim(); }).filter(Boolean) : [];
                   })(),
    preloadSec:    parseInt(getParam('pre') || lsCfg.preloadSeconds) || 30,
    cookie:        lsCookie,
    maxRetry:      100,
  };

  /* ══════════════════════════════════════════════════
     5. 渠道拦截检测
  ══════════════════════════════════════════════════ */
  var BLOCK_KW = ['该渠道不支持购票','请到大麦APP购买','请在大麦APP中打开','渠道不支持'];
  function isBlocked() {
    var text = document.body ? (document.body.innerText || '') : '';
    for (var i = 0; i < BLOCK_KW.length; i++) {
      if (text.indexOf(BLOCK_KW[i]) > -1) return true;
    }
    return false;
  }

  /* ══════════════════════════════════════════════════
     6. 方案 A：伪造 UA + 刷新
  ══════════════════════════════════════════════════ */
  var DAMAI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) '
    + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 '
    + 'Damai/10.4.0 DmBridge/1.2.3 AliApp(DM/10.4.0) WindVane/8.6.0';

  function planA_run() {
    log('方案A：覆盖 UA 为大麦App…', 'warn');
    try {
      Object.defineProperty(navigator, 'userAgent', {
        get: function() { return DAMAI_UA; },
        configurable: true
      });
      log('UA 覆盖完成', 'info');
    } catch(e) {
      log('UA 覆盖受限: ' + e.message, 'warn');
    }
    setST('方案A：刷新页面中…');
    log('注入恢复脚本，即将刷新…', 'info');
    reloadWithRecovery(SS.PLANA, 800);
  }

  function checkPlanA() {
    var flag = false;
    try { flag = sessionStorage.getItem(SS.PLANA) === '1'; } catch(e) {}
    if (!flag) return false;
    try { sessionStorage.removeItem(SS.PLANA); } catch(e) {}

    log('【方案A刷新后】检测页面状态…', 'info');
    if (isBlocked()) {
      log('方案A 失败：服务端有其他校验', 'err');
      setST('方案A 失败，切换方案C…');
      setTimeout(showPlanC, 400);
    } else {
      log('✓ 方案A 成功！渠道限制已绕过', 'ok');
      setST('渠道已绕过 ✓');
      setTimeout(normalStart, 400);
    }
    return true;
  }

  /* ══════════════════════════════════════════════════
     7. 方案 C：Cookie 注入 + 刷新
  ══════════════════════════════════════════════════ */
  function showPlanC() {
    // 隐藏倒计时相关元素
    ['dms-cd','dms-pw','dms-info','dms-log','dms-acts'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    setST('');

    var body = document.getElementById('dms-body');
    if (!body) return;

    var guide = document.createElement('div');
    guide.id  = 'dms-planc-block';
    guide.innerHTML = [
      '<div style="font-size:12px;font-weight:700;color:#f97316;margin-bottom:10px">',
        '⚠ 方案A失败，请使用方案C（Cookie注入）',
      '</div>',
      '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);',
           'border-radius:10px;padding:10px;margin-bottom:10px;',
           'font-size:11px;line-height:2;color:#aaaacc">',
        '<b style="color:#e0e0f8">获取 Cookie（Stream抓包）</b><br>',
        '① 开启 Stream 抓包<br>',
        '② 打开大麦App → 进入该演出购票页<br>',
        '③ Stream 找到 <span style="background:#1c1c2a;padding:1px 5px;border-radius:3px;',
             'font-family:Courier New">damai.cn</span> 请求<br>',
        '④ Request → Headers → 复制 <b style="color:#4f8eff">Cookie</b> 完整值',
      '</div>',
      '<div style="font-size:11px;color:#8888aa;margin-bottom:5px">粘贴 Cookie 值：</div>',
      '<textarea id="dms-cookie-input"',
        ' placeholder="sid=xxx; _m_h5_tk=xxx; ..."',
        ' style="width:100%;height:72px;background:#1c1c2a;',
                'border:1px solid rgba(255,255,255,.12);border-radius:8px;',
                'color:#e8e8f8;font-size:10px;padding:7px;',
                'font-family:\'Courier New\',monospace;resize:none;outline:none;',
                'line-height:1.6;box-sizing:border-box">',
        CONFIG.cookie,
      '</textarea>',
      '<div style="display:flex;gap:7px;margin-top:8px">',
        '<button id="dms-c-inject"',
          ' style="flex:1;padding:10px;border-radius:9px;border:none;',
                  'background:linear-gradient(135deg,#4f8eff,#a855f7);',
                  'color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">',
          '注入 Cookie 并刷新',
        '</button>',
        '<button id="dms-c-skip"',
          ' style="padding:10px 12px;border-radius:9px;',
                  'border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);',
                  'color:#888;font-size:12px;cursor:pointer;font-family:inherit">',
          '跳过',
        '</button>',
      '</div>',
      '<div id="dms-c-feedback"',
        ' style="margin-top:8px;font-size:10px;color:#4f8eff;',
                'font-family:\'Courier New\',monospace;line-height:1.8;min-height:16px">',
      '</div>',
    ].join('');

    body.appendChild(guide);

    document.getElementById('dms-c-inject').onclick = planC_inject;
    document.getElementById('dms-c-skip').onclick = function() {
      guide.remove();
      ['dms-cd','dms-info','dms-log','dms-acts'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = '';
      });
      normalStart();
    };
  }

  function planC_inject() {
    var input = document.getElementById('dms-cookie-input');
    var fb    = document.getElementById('dms-c-feedback');
    var val   = input ? input.value.trim() : '';

    if (!val) { if (fb) fb.textContent = '⚠ 请先粘贴 Cookie 值'; return; }

    if (fb) fb.textContent = '写入 Cookie 中，请稍候…';

    // 持久化到 localStorage，刷新后 CONFIG 能再次读到
    try { localStorage.setItem('dms_cookie', val); } catch(e) {}
    CONFIG.cookie = val;

    // 逐条写入 document.cookie
    var pairs = val.split(';');
    var count = 0;
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i].trim();
      if (!pair) continue;
      try { document.cookie = pair + '; path=/; max-age=86400'; count++; } catch(e) {}
    }

    if (fb) fb.textContent = '✓ 写入 ' + count + ' 条，注入恢复脚本并刷新…';
    log('方案C：写入 ' + count + ' 条 Cookie，准备刷新', 'warn');

    // 刷新前注入恢复脚本，确保刷新后脚本自动重新加载
    reloadWithRecovery(SS.PLANC, 900);
  }

  function checkPlanC() {
    var flag = false;
    try { flag = sessionStorage.getItem(SS.PLANC) === '1'; } catch(e) {}
    if (!flag) return false;
    try { sessionStorage.removeItem(SS.PLANC); } catch(e) {}

    log('【方案C刷新后】检测页面状态…', 'info');
    if (isBlocked()) {
      log('方案C 仍被拦截，Cookie 可能过期或不完整', 'err');
      setST('方案C 失败，请重新抓取 Cookie');
      setTimeout(showPlanC, 400);
    } else {
      log('✓ 方案C 成功！Cookie 注入有效', 'ok');
      setST('Cookie 注入成功 ✓');
      setTimeout(normalStart, 400);
    }
    return true;
  }

  /* ══════════════════════════════════════════════════
     8. 面板构建
  ══════════════════════════════════════════════════ */
  var PANEL_ID = '__dms_panel__';

  function buildPanel() {
    var old = document.getElementById(PANEL_ID);
    if (old) old.remove();

    var st = document.createElement('style');
    st.textContent = [
      '#'+PANEL_ID+'{position:fixed;top:16px;right:16px;width:282px;',
        'background:#0d0d18;border:1.5px solid rgba(79,142,255,.4);',
        'border-radius:18px;box-shadow:0 8px 40px rgba(0,0,0,.85);',
        'font-family:-apple-system,sans-serif;font-size:13px;',
        'color:#e8e8f8;z-index:2147483647;overflow:hidden;user-select:none}',
      '#dms-bar{display:flex;align-items:center;justify-content:space-between;',
        'padding:11px 14px 9px;background:linear-gradient(135deg,#0d1829,#130d29);',
        'border-bottom:1px solid rgba(255,255,255,.06);cursor:move}',
      '#dms-bar span{font-size:13px;font-weight:800}',
      '#dms-x{background:rgba(255,255,255,.08);border:none;color:#888;',
        'width:22px;height:22px;border-radius:50%;cursor:pointer;font-size:13px;padding:0}',
      '#dms-body{padding:14px;max-height:75vh;overflow-y:auto}',
      '#dms-cd{font-family:"Courier New",monospace;font-size:40px;font-weight:800;',
        'text-align:center;letter-spacing:-.02em;line-height:1.1;margin-bottom:8px;',
        'background:linear-gradient(135deg,#fff 30%,#4f8eff);',
        '-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}',
      '#dms-cd.pre{background:linear-gradient(135deg,#fff 30%,#f97316);',
        '-webkit-background-clip:text;background-clip:text}',
      '#dms-cd.done{background:linear-gradient(135deg,#fff 30%,#22c55e);',
        '-webkit-background-clip:text;background-clip:text}',
      '#dms-st{text-align:center;font-size:12px;color:#8888aa;margin-bottom:10px;min-height:18px}',
      '#dms-pw{height:3px;background:rgba(255,255,255,.07);border-radius:99px;',
        'overflow:hidden;margin-bottom:12px;display:none}',
      '#dms-pb{height:100%;width:0;border-radius:99px;',
        'background:linear-gradient(90deg,#4f8eff,#f97316);transition:width .1s linear}',
      '#dms-info{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);',
        'border-radius:10px;padding:9px 10px;margin-bottom:10px;',
        'font-size:11px;line-height:2;color:#aaaacc}',
      '#dms-info b{color:#e0e0f8}',
      '#dms-log{max-height:120px;overflow-y:auto;font-size:11px;color:#555577;',
        'line-height:1.8;font-family:"Courier New",monospace;margin-bottom:10px}',
      '.ok{color:#22c55e}.warn{color:#f97316}.err{color:#ef4444}.info{color:#4f8eff}',
      '#dms-acts{display:flex;gap:8px}',
      '#dms-acts button{flex:1;padding:8px;border-radius:8px;',
        'border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);',
        'color:#e0e0f8;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}',
    ].join('');
    document.head.appendChild(st);

    var div = document.createElement('div');
    div.id = PANEL_ID;
    div.innerHTML =
      '<div id="dms-bar"><span>🎫 大麦抢票 v3</span><button id="dms-x">✕</button></div>' +
      '<div id="dms-body">' +
        '<div id="dms-cd">--:--</div>' +
        '<div id="dms-st">初始化中…</div>' +
        '<div id="dms-pw"><div id="dms-pb"></div></div>' +
        '<div id="dms-info"></div>' +
        '<div id="dms-log"></div>' +
        '<div id="dms-acts">' +
          '<button id="dms-stop">■ 停止</button>' +
          '<button id="dms-retry" style="display:none">↺ 重试</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(div);

    drag(div, document.getElementById('dms-bar'));
    document.getElementById('dms-x').onclick     = function(){ if(confirm('停止脚本？')) destroy(); };
    document.getElementById('dms-stop').onclick  = function(){ if(confirm('停止抢票？')) destroy(); };
    document.getElementById('dms-retry').onclick = function(){ retryCount=0; log('手动重试','info'); runBuy(); };
  }

  function drag(el, handle) {
    var ox=0,oy=0,on=false;
    function dn(cx,cy){ on=true; ox=cx-el.getBoundingClientRect().left; oy=cy-el.getBoundingClientRect().top; }
    function mv(cx,cy){ if(!on)return; el.style.right='auto'; el.style.left=(cx-ox)+'px'; el.style.top=(cy-oy)+'px'; }
    handle.addEventListener('mousedown',function(e){dn(e.clientX,e.clientY);e.preventDefault();});
    document.addEventListener('mousemove',function(e){mv(e.clientX,e.clientY);});
    document.addEventListener('mouseup',function(){on=false;});
    handle.addEventListener('touchstart',function(e){var t=e.touches[0];dn(t.clientX,t.clientY);},{passive:true});
    document.addEventListener('touchmove',function(e){var t=e.touches[0];mv(t.clientX,t.clientY);},{passive:true});
    document.addEventListener('touchend',function(){on=false;},{passive:true});
  }

  /* ══════════════════════════════════════════════════
     9. UI 工具
  ══════════════════════════════════════════════════ */
  function $id(id){ return document.getElementById(id); }
  function setCD(t,cls){ var e=$id('dms-cd'); if(e){e.textContent=t;e.className=cls||'';} }
  function setST(t){ var e=$id('dms-st'); if(e) e.textContent=t; }
  function setProg(p){ var w=$id('dms-pw'),b=$id('dms-pb'); if(!w||!b)return; w.style.display='block'; b.style.width=Math.min(100,p)+'%'; }
  function log(msg,type){
    var el=$id('dms-log'); if(!el)return;
    var d=document.createElement('div'); d.className=type||'info';
    d.textContent='['+new Date().toLocaleTimeString('zh-CN',{hour12:false})+'] '+msg;
    el.appendChild(d); el.scrollTop=el.scrollHeight;
  }
  function showInfo(){
    var el=$id('dms-info'); if(!el)return;
    el.innerHTML=
      '<b>开票</b> '+(CONFIG.saleTime?new Date(CONFIG.saleTime).toLocaleString('zh-CN'):'未配置')+'<br>'+
      '<b>档位</b> '+(CONFIG.planName||'未配置（选第一个可用）')+'<br>'+
      '<b>观演人</b> '+(CONFIG.audienceNames.length?CONFIG.audienceNames.join('、'):'未配置')+'<br>'+
      '<b>渠道</b> '+(isBlocked()
        ? '<span class="err">⚠ 被拦截</span>'
        : '<span class="ok">✓ 正常</span>');
  }

  /* ══════════════════════════════════════════════════
     10. 主启动
  ══════════════════════════════════════════════════ */
  var masterTimer=null, refreshTimer=null, retryCount=0, fired=false;
  var saleTime = CONFIG.saleTime ? new Date(CONFIG.saleTime) : null;

  function start() {
    buildPanel();
    showInfo();

    // 优先级：方案C刷新后 → 方案A刷新后 → 首次加载
    if (checkPlanC()) return;
    if (checkPlanA()) return;

    // 首次加载检测
    if (isBlocked()) {
      log('检测到渠道拦截，启动方案A…', 'warn');
      setST('检测到渠道限制…');
      setTimeout(planA_run, 600);
      return;
    }

    log('页面正常 ✓', 'ok');
    normalStart();
  }

  function normalStart() {
    showInfo();
    if (!saleTime || isNaN(saleTime)) {
      var v = prompt('未读取到开票时间\n请输入（格式：2025-06-01 20:00:00）：');
      if (!v) { destroy(); return; }
      saleTime = new Date(v.replace(' ','T'));
      if (isNaN(saleTime)) { alert('格式有误，请重试'); destroy(); return; }
    }
    log('启动倒计时，等待开票…','info');
    setST('倒计时中');
    masterTimer = setInterval(tick, 100);
  }

  /* ══════════════════════════════════════════════════
     11. 倒计时 & 购票
  ══════════════════════════════════════════════════ */
  function tick(){
    if(fired)return;
    var left=(saleTime-Date.now())/1000;
    if(left<=0){clearInterval(masterTimer);clearInterval(refreshTimer);fire();return;}
    var h=Math.floor(left/3600),m=Math.floor((left%3600)/60),
        s=Math.floor(left%60),ds=Math.floor((left%1)*10);
    setCD(h>0?pad(h)+':'+pad(m)+':'+pad(s):pad(m)+':'+pad(s)+'.'+ds,
          left<=CONFIG.preloadSec?'pre':'');
    if(left<=CONFIG.preloadSec&&!refreshTimer){
      setST('🔥 预热中，每 200ms 检查');
      log('进入预热，距开票 '+left.toFixed(1)+'s','warn');
      refreshTimer=setInterval(function(){if((saleTime-Date.now())/1000<=0)fire();},200);
    }
    if(left<=CONFIG.preloadSec)setProg((1-left/CONFIG.preloadSec)*100);
  }

  function fire(){
    if(fired)return; fired=true;
    clearInterval(masterTimer);clearInterval(refreshTimer);
    setCD('00:00.0','done');setProg(100);
    setST('🚀 开票！执行购票序列…');
    log('开票时间到！','ok');
    runBuy();
  }

  var SEL={
    priceArea: ['.perform-sku-item','.ticket-item','[class*="skuItem"]',
                '[class*="sku-item"]','[class*="ticket-item"]','[class*="priceItem"]'].join(','),
    buyBtn:    ['[class*="buyBtn"]','[class*="buy-btn"]',
                '[class*="orderBtn"]','[class*="order-btn"]'].join(','),
    audWrap:   ['[class*="viewerBox"]','[class*="viewer-box"]','[class*="audienceBox"]',
                '[class*="contactBox"]','[class*="buyerBox"]'].join(','),
    audItem:   ['[class*="viewerItem"]','[class*="viewer-item"]','[class*="audienceItem"]',
                '[class*="contactItem"]','[class*="buyerItem"]'].join(','),
    confirmBtn:['[class*="confirmBtn"]','[class*="confirm-btn"]',
                '[class*="sureBtn"]','[class*="okBtn"]'].join(','),
  };

  function runBuy(){
    setST('Step 1/3 · 选票价…');
    stepPlan()
      .then(function(ok){
        if(!ok) throw new Error('未找到可选票价');
        setST('Step 2/3 · 点购买…');
        return sleep(150).then(stepBuy);
      })
      .then(function(ok){
        if(!ok) throw new Error('未找到购买按钮');
        setST('Step 3/3 · 选观演人…');
        return sleep(700).then(stepAudience);
      })
      .then(function(){
        setST('✅ 序列完成，等待跳转…');
        log('购票序列完毕','ok');
        var r=$id('dms-retry');if(r)r.style.display='block';
      })
      .catch(function(err){
        log('❌ '+err.message,'err');
        setST('失败: '+err.message);
        retryCount++;
        if(retryCount<CONFIG.maxRetry){
          log('重试 '+retryCount+'/'+CONFIG.maxRetry,'warn');
          return sleep(300).then(runBuy);
        }
        setST('❌ 已达重试上限，请手动操作');
        var r=$id('dms-retry');if(r)r.style.display='block';
      });
  }

  function stepPlan(){
    return waitFor(SEL.priceArea,3000).then(function(){
      var items=document.querySelectorAll(SEL.priceArea);
      log('找到 '+items.length+' 个档位','info');
      if(!items.length)return false;
      var target=null;
      if(CONFIG.planName){
        for(var i=0;i<items.length;i++){
          if(items[i].textContent.indexOf(CONFIG.planName)>-1&&!isDis(items[i])){target=items[i];break;}
        }
      }
      if(!target&&CONFIG.planPrice){
        var ps=String(CONFIG.planPrice);
        for(var i=0;i<items.length;i++){
          if(items[i].textContent.indexOf(ps)>-1&&!isDis(items[i])){target=items[i];break;}
        }
      }
      if(!target){
        for(var i=0;i<items.length;i++){if(!isDis(items[i])){target=items[i];break;}}
      }
      if(!target){log('所有档位不可选','err');return false;}
      click(target);
      log('✓ 选中: '+target.textContent.trim().slice(0,25),'ok');
      return true;
    });
  }

  function stepBuy(){
    var W=['立即购买','立即预订','立即抢购','马上抢','购买','预订'];
    var btn=findByText('button,a,[role="button"]',W);
    return(btn?Promise.resolve(btn):waitFor(SEL.buyBtn,2000))
      .then(function(b){
        if(!b){log('未找到购买按钮','err');return false;}
        log('✓ 点击: '+b.textContent.trim(),'ok');
        click(b);return true;
      });
  }

  function stepAudience(){
    if(!CONFIG.audienceNames.length){log('未配置观演人，跳过','warn');return Promise.resolve();}
    return waitFor(SEL.audWrap,3000).then(function(wrap){
      if(!wrap){log('观演人弹窗未出现','warn');return;}
      var items=wrap.querySelectorAll(SEL.audItem);
      log('弹窗中 '+items.length+' 个观演人','info');
      var hit=0;
      for(var i=0;i<items.length;i++){
        var name=items[i].textContent.trim();
        for(var j=0;j<CONFIG.audienceNames.length;j++){
          if(name.indexOf(CONFIG.audienceNames[j])>-1){click(items[i]);hit++;log('✓ 选: '+name,'ok');break;}
        }
      }
      if(!hit&&items.length){click(items[0]);log('兜底：选第一个','warn');}
      return sleep(200).then(function(){
        var cb=wrap.querySelector(SEL.confirmBtn)||findByText('button',['确认','确定','完成','好的']);
        if(cb){click(cb);log('✓ 确认观演人','ok');}
        else{log('未找到确认按钮','warn');}
      });
    });
  }

  /* ══════════════════════════════════════════════════
     12. 工具函数
  ══════════════════════════════════════════════════ */
  function waitFor(sel,ms){
    return new Promise(function(res){
      var t=Date.now(),iv=setInterval(function(){
        var el=document.querySelector(sel);
        if(el){clearInterval(iv);res(el);return;}
        if(Date.now()-t>ms){clearInterval(iv);res(null);}
      },80);
    });
  }
  function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function click(el){
    if(!el)return;
    ['mouseover','mousedown','mouseup','click'].forEach(function(ev){
      el.dispatchEvent(new MouseEvent(ev,{bubbles:true,cancelable:true,view:window}));
    });
    if(typeof el.click==='function')el.click();
  }
  function findByText(sel,words){
    var els=document.querySelectorAll(sel);
    for(var i=0;i<els.length;i++){
      var t=els[i].textContent.trim();
      for(var j=0;j<words.length;j++){
        if(t.indexOf(words[j])>-1&&!els[i].disabled&&!isDis(els[i]))return els[i];
      }
    }
    return null;
  }
  function isDis(el){
    return el.disabled||
           el.className.indexOf('disable')>-1||
           el.className.indexOf('soldOut')>-1||
           el.textContent.indexOf('售罄')>-1||
           el.textContent.indexOf('已售完')>-1;
  }
  function pad(n){return('0'+n).slice(-2);}
  function destroy(){
    clearInterval(masterTimer);clearInterval(refreshTimer);
    var p=document.getElementById(PANEL_ID);if(p)p.remove();
    window.__DMS__=false;
    try { sessionStorage.removeItem(SS.SRC); } catch(e) {}
  }

  /* 启动 */
  start();

})();
