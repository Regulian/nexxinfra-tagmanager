/**
 * Tagboy Tracker v1.8.2
 * 
 * Corrigido: Payload agora envia formato correto para Edge Functions
 * - companyId (não company_id)
 * - event: { type, ...data } (não event_name/event_data)
 */
(function (window, document) {
  'use strict';

  // ===========================
  // CONFIG
  // ===========================
  var config = window.TrackerConfig || {};
  if (!config.webhookUrl) { console.error('[Tracker] webhookUrl não configurado!'); return; }
  if (!config.companyId) { console.error('[Tracker] companyId não configurado!'); return; }

  var debug = !!config.debug;
  function log(){ if (debug) console.log('[Tracker]', [].slice.call(arguments).join(' ')); }
  function warn(){ if (debug) console.warn('[Tracker]', [].slice.call(arguments).join(' ')); }

  // Coleta de valores
  var collectFieldValues = config.collectFieldValues !== false;
  var maskSensitiveFields = config.maskSensitiveFields !== false;
  var maxFieldValueLength = Number(config.maxFieldValueLength || 200);

  // LEAD dinâmico
  var includeAllFieldsOnLead = config.includeAllFieldsOnLead !== false;
  var includeCheckboxRadioOnLead = config.includeCheckboxRadioOnLead !== false;
  var includeFileNamesOnLead = !!config.includeFileNamesOnLead;
  var includeDisabledOrHidden = !!config.includeDisabledOrHidden;
  var includeUncheckedAsFalse = !!config.includeUncheckedAsFalse;
  var includeTrackedValuesOnLead = config.includeTrackedValuesOnLead !== false;

  // Eventos auxiliares
  var emitFormSchemaOnStart = config.emitFormSchemaOnStart !== false;
  var emitFormDebugSummary = config.emitFormDebugSummary !== false;

  // FieldFilled
  var forceFieldValueOnFieldFilled = config.forceFieldValueOnFieldFilled !== false;
  var fieldFilledMaskSensitive = (typeof config.fieldFilledMaskSensitive === 'boolean')
    ? config.fieldFilledMaskSensitive : maskSensitiveFields;
  var fieldFilledMaskReplacement = config.fieldFilledMaskReplacement || '[masked]';

  // Padrões sensíveis
  var defaultSensitivePatterns = [
    'password','senha','token','secret',
    'credit','card','cc','cvv','cvc',
    'security','ssn','cpf','cnpj','rg'
  ];
  var sensitiveNamePatterns = Array.isArray(config.sensitiveNamePatterns) && config.sensitiveNamePatterns.length
    ? config.sensitiveNamePatterns : defaultSensitivePatterns;

  var fieldValueAllowlist = Array.isArray(config.fieldValueAllowlist) ? config.fieldValueAllowlist : [];

  // ===========================
  // CAPABILITIES
  // ===========================
  var cookiesEnabled = false;
  try { document.cookie = '_test=1'; cookiesEnabled = document.cookie.indexOf('_test=1') !== -1; document.cookie = '_test=1; expires=Thu, 01 Jan 1970 00:00:01 GMT'; } catch(e){ warn('Cookies bloqueados:', e.message); }
  var storageEnabled = false;
  try { localStorage.setItem('_test','1'); localStorage.removeItem('_test'); storageEnabled = true; } catch(e){ warn('LocalStorage bloqueado:', e.message); }

  // ===========================
  // STORAGE HELPERS
  // ===========================
  function getCookie(name){ if (!cookiesEnabled) return null; try{ var v='; '+document.cookie; var p=v.split('; '+name+'='); if(p.length===2) return p.pop().split(';').shift(); }catch(e){} return null; }
  function setCookie(name,value,days){ if(!cookiesEnabled) return false; try{ var d=new Date(); d.setTime(d.getTime()+days*864e5); document.cookie=name+'='+value+';expires='+d.toUTCString()+';path=/'; return true; }catch(e){ return false; } }
  function getStorage(k){ if(!storageEnabled) return null; try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function setStorage(k,v){ if(!storageEnabled) return false; try{ localStorage.setItem(k,v); return true; }catch(e){ return false; } }
  function getSessionStorage(k){ try{ return sessionStorage.getItem(k); }catch(e){ return null; } }
  function setSessionStorage(k,v){ try{ sessionStorage.setItem(k,v); return true; }catch(e){ return false; } }

  // ===========================
  // UTILS
  // ===========================
  function getUrlParam(p){ try{ return new URLSearchParams(window.location.search).get(p); }catch(e){ return null; } }
  function generateId(prefix){ return prefix+'_'+Date.now()+'_'+Math.random().toString(36).substr(2,9); }
  function isHidden(el){ var s=window.getComputedStyle?getComputedStyle(el):null; return (s && (s.display==='none' || s.visibility==='hidden')) || el.type==='hidden'; }
  function getLabelForField(field){
    if (field.id) { var l=document.querySelector('label[for="'+field.id+'"]'); if(l) return l.textContent.trim(); }
    var p=field.parentElement; if (p){ var lbl=p.querySelector('label'); if (lbl) return lbl.textContent.trim(); }
    return field.placeholder || field.name || 'unknown';
  }
  function getFieldKey(el){
    var alias = el.getAttribute('data-tracker-alias');
    if (alias) return String(alias);
    return el.name || el.id || ('field_'+(el.type || 'text'));
  }
  function getAssociatedElements(form){
    var arr = Array.from(form.elements || []);
    if (form.id) {
      var outside = document.querySelectorAll('[form="'+form.id+'"]');
      if (outside && outside.length) {
        Array.prototype.forEach.call(outside, function(el){
          if (arr.indexOf(el) === -1) arr.push(el);
        });
      }
    }
    return arr;
  }

  // ===========================
  // SENSITIVE / VALUE RULES
  // ===========================
  function isInAllowlist(field){
    var n=(field.name||'').toLowerCase(), i=(field.id||'').toLowerCase();
    return fieldValueAllowlist.some(function(k){ k=(k||'').toLowerCase(); return k && (n===k || i===k); });
  }
  function isSensitiveByName(x){ x=(x||'').toLowerCase(); return sensitiveNamePatterns.some(function(p){ return x.includes(String(p).toLowerCase()); }); }
  function isFieldSensitive(field){
    var t=(field.type||'').toLowerCase();
    if (t==='password') return true;
    if (field.hasAttribute('data-tracker-mask')) return true;
    return isSensitiveByName(field.name) || isSensitiveByName(field.id);
  }

  function shouldCollectValue(field){
    if (!collectFieldValues) return false;
    if (field.getAttribute('data-tracker-no-value')==='true') return false;
    if (!includeDisabledOrHidden && (field.disabled || isHidden(field))) return false;

    var tag=(field.tagName||'').toLowerCase();
    var t=(field.type||'').toLowerCase();

    if (t==='file') return !!includeFileNamesOnLead;
    if ((t==='checkbox' || t==='radio') && !includeCheckboxRadioOnLead) return false;

    var okType = (
      t==='text'||t==='email'||t==='tel'||t==='number'||t==='search'||t==='url'||t==='password'||
      t==='checkbox'||t==='radio'||t==='file'||t==='date'||t==='datetime-local'||t==='time'||t==='month'||t==='week'||t==='color'
    );
    var okTag = (tag==='textarea'||tag==='select');
    if (!(okType||okTag)) return false;

    if (maskSensitiveFields && isFieldSensitive(field) && !isInAllowlist(field)) return false;
    return true;
  }

  function sanitizeValue(v){
    try{
      var s = Array.isArray(v) ? v.join(', ') : String(v||'');
      s = s.replace(/\s+/g,' ').trim();
      if (s.length>maxFieldValueLength) s=s.slice(0,maxFieldValueLength);
      return s;
    }catch(e){ return ''; }
  }

  function getFieldPrimitiveValue(el){
    var tag=(el.tagName||'').toLowerCase();
    var t=(el.type||'').toLowerCase();

    if (t==='checkbox') {
      if (el.name) {
        var group = Array.from((el.form||document).querySelectorAll('input[type="checkbox"][name="'+el.name+'"]'));
        if (group.length>1) {
          var sel = group.filter(function(i){ return i.checked; }).map(function(i){ return i.value || 'on'; });
          if (sel.length) return sel;
          return includeUncheckedAsFalse ? 'false' : '';
        }
      }
      return el.checked ? (el.value || 'on') : (includeUncheckedAsFalse ? 'false' : '');
    }

    if (t==='radio') {
      if (el.name) {
        var chosen = (el.form||document).querySelector('input[type="radio"][name="'+el.name+'"]:checked');
        return chosen ? (chosen.value || 'on') : (includeUncheckedAsFalse ? 'false' : '');
      }
      return el.checked ? (el.value || 'on') : (includeUncheckedAsFalse ? 'false' : '');
    }

    if (t==='file') {
      if (!includeFileNamesOnLead) return '';
      var f = el.files && el.files[0];
      return f ? f.name : '';
    }

    if (tag==='select') {
      if (el.multiple) return Array.from(el.selectedOptions||[]).map(function(o){ return o.value; });
      return el.value || '';
    }

    return el.value || '';
  }

  function getFieldValueForFieldFilled(el){
    var raw = getFieldPrimitiveValue(el);
    var out;
    if (Array.isArray(raw)) {
      out = raw.map(function(v){ return sanitizeValue(v); }).filter(Boolean).join(', ');
      if (!out && includeUncheckedAsFalse && ((el.type||'').toLowerCase()==='checkbox' || (el.type||'').toLowerCase()==='radio')) out = 'false';
    } else {
      out = sanitizeValue(raw);
      if (!out && includeUncheckedAsFalse && ((el.type||'').toLowerCase()==='checkbox' || (el.type||'').toLowerCase()==='radio')) out = 'false';
    }

    if (fieldFilledMaskSensitive && isFieldSensitive(el) && !isInAllowlist(el)) {
      return fieldFilledMaskReplacement;
    }
    return out;
  }

  // ===========================
  // IDs & UTM (com fallback em memória)
  // ===========================
  var memoryVisitorId = null;
  var memorySessionId = null;
  
  function getVisitorId(){ 
    var v=getCookie('_visitor_id')||getStorage('_visitor_id')||memoryVisitorId; 
    if(v) return v; 
    v=generateId('vis'); 
    if(!setCookie('_visitor_id',v,365)) setStorage('_visitor_id',v);
    memoryVisitorId = v;
    return v; 
  }
  
  function getSessionId(){ 
    var s=getSessionStorage('_session_id')||memorySessionId; 
    if(!s){ 
      s=generateId('sess'); 
      setSessionStorage('_session_id',s);
      memorySessionId = s;
    } 
    return s; 
  }
  function getFBP(){ var f=getCookie('_fbp')||getStorage('_fbp'); if(!f){ f='fb.1.'+Date.now()+'.'+Math.random().toString(36).substr(2,9); if(!setCookie('_fbp',f,90)) setStorage('_fbp',f);} return f; }
  function getFBC(){ var f=getCookie('_fbc')||getStorage('_fbc'); var fbclid=getUrlParam('fbclid'); if(fbclid && !f){ f='fb.1.'+Date.now()+'.'+fbclid; if(!setCookie('_fbc',f,90)) setStorage('_fbc',f);} return f; }
  function captureUTMs(){ var u={utm_source:getUrlParam('utm_source'),utm_medium:getUrlParam('utm_medium'),utm_campaign:getUrlParam('utm_campaign'),utm_content:getUrlParam('utm_content'),utm_term:getUrlParam('utm_term')}; if(u.utm_source||u.utm_campaign) setSessionStorage('_utms',JSON.stringify(u)); var s=getSessionStorage('_utms'); return s?JSON.parse(s):u; }

  // ===========================
  // SEND EVENT - FORMATO CORRETO
  // ===========================
  function trackEvent(eventName, eventData){
    eventData = eventData || {};
    var utms = captureUTMs();
    
    // Construir event com todos os dados
    var event = {
      type: eventName,
      page_url: window.location.href,
      page_title: document.title,
      referrer: document.referrer,
      visitor_id: getVisitorId(),
      session_id: getSessionId(),
      fbp: getFBP(),
      fbc: getFBC(),
      gclid: getUrlParam('gclid'),
      utm_source: utms.utm_source,
      utm_medium: utms.utm_medium,
      utm_campaign: utms.utm_campaign,
      utm_content: utms.utm_content,
      utm_term: utms.utm_term,
      user_agent: navigator.userAgent,
      screen_resolution: screen.width+'x'+screen.height,
      language: navigator.language,
      timestamp: new Date().toISOString()
    };
    
    // Adicionar dados customizados do evento
    for (var k in eventData) {
      if (Object.prototype.hasOwnProperty.call(eventData, k)) {
        event[k] = eventData[k];
      }
    }

    // Payload no formato correto para Edge Functions
    var payload = {
      companyId: config.companyId,
      event: event,
      dedupeKey: generateId('evt')
    };

    fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    }).then(function(r){
      if (!r.ok) {
        warn('Erro ao enviar evento:', r.status, r.statusText);
        throw new Error('HTTP '+r.status);
      }
      return r.json().catch(function(){ return {success:true}; });
    }).then(function(d){
      log('✅ Evento enviado:', eventName, d);
    }).catch(function(err){
      warn('❌ Falha ao enviar:', err.message);
    });
  }

  // ===========================
  // PAGEVIEW
  // ===========================
  function sendPageView(){ trackEvent('PageView',{load_time: performance.now ? Math.round(performance.now()) : 0}); }
  if (config.autoPageView !== false) {
    if (document.readyState==='complete') sendPageView();
    else window.addEventListener('load', sendPageView);
  }

  // ===========================
  // FORMS
  // ===========================
  if (config.autoFormTracking !== false) {
    var formsStarted = new WeakMap();
    var formFields = new WeakMap();
    var formsSubmitted = new WeakSet();
    var fieldTimers = new WeakMap();

    function isEligibleElement(el){
      if (!el) return false;
      var tag=(el.tagName||'').toLowerCase();
      var t=(el.type||'').toLowerCase();
      if (tag==='input') {
        if (t==='button'||t==='submit'||t==='reset') return false;
        if (!includeDisabledOrHidden && (el.disabled || isHidden(el))) return false;
        return true;
      }
      if (tag==='textarea'||tag==='select') {
        if (!includeDisabledOrHidden && (el.disabled || isHidden(el))) return false;
        return true;
      }
      return false;
    }

    function ensureFormStarted(form, el){
      if (!form || form.getAttribute('data-tracker-ignore')) return;
      if (!formsStarted.get(form)) {
        formsStarted.set(form, true);
        trackEvent('FormStarted', {
          form_id: form.id || 'unknown',
          form_action: form.action || window.location.href,
          first_field: getFieldKey(el)
        });
        formFields.set(form, {});
        emitFormSchema(form);
      }
    }

    function rememberFieldValue(form, key, val){
      if (typeof val === 'undefined') return;
      var map = formFields.get(form) || {};
      var meta = map[key] || { type: null, filled: true, tracked: true, timestamp: new Date().toISOString() };
      meta.last_value = val;
      meta.timestamp = new Date().toISOString();
      map[key] = meta;
      formFields.set(form, map);
    }

    function emitFormSchema(form){
      if (!emitFormSchemaOnStart) return;
      var schema=[];
      getAssociatedElements(form).forEach(function(el){
        if (!isEligibleElement(el)) return;
        schema.push({
          key: getFieldKey(el),
          name: el.name || null,
          id: el.id || null,
          type: el.type || (el.tagName||'').toLowerCase(),
          label: getLabelForField(el) || null,
          sensitive: !!isFieldSensitive(el)
        });
      });
      trackEvent('FormSchema', {
        form_id: form.id || 'unknown',
        form_action: form.action || window.location.href,
        fields: schema
      });
    }

    function emitFieldFilled(form, el, reason){
      if (!(form && !form.getAttribute('data-tracker-ignore'))) return;

      var fields=formFields.get(form)||{};
      var key=getFieldKey(el);

      var tmr=fieldTimers.get(el); if(tmr){ clearTimeout(tmr); fieldTimers.delete(el); }

      var raw=getFieldPrimitiveValue(el);
      var hasVal = Array.isArray(raw) ? raw.length>0 : !!String(raw).trim();
      if (!hasVal && includeUncheckedAsFalse && ((el.type||'').toLowerCase()==='checkbox' || (el.type||'').toLowerCase()==='radio')) {
        hasVal = true;
      }

      var valueForEvent = forceFieldValueOnFieldFilled ? getFieldValueForFieldFilled(el) : undefined;

      if (typeof valueForEvent !== 'undefined') rememberFieldValue(form, key, valueForEvent);

      if (hasVal && !(fields[key] && fields[key].emitted)) {
        fields[key]=fields[key]||{type:el.type, filled:true, tracked:true};
        fields[key].timestamp = new Date().toISOString();
        var payload={
          form_id: form.id || 'unknown',
          field_name: key,
          field_type: el.type,
          field_label: getLabelForField(el),
          field_reason: reason || 'unknown'
        };
        if (typeof valueForEvent !== 'undefined') payload.field_value = valueForEvent;
        trackEvent('FieldFilled', payload);
        fields[key].emitted = true;
        formFields.set(form, fields);
      }
    }

    document.addEventListener('focus', function(e){
      var target=e.target; if(!isEligibleElement(target)) return;
      var form=target.closest('form') || (target.form || null);
      ensureFormStarted(form, target);
    }, true);

    document.addEventListener('input', function(e){
      var target=e.target; if(!isEligibleElement(target)) return;
      var tag=(target.tagName||'').toLowerCase();
      var t=(target.type||'').toLowerCase();

      var form=target.closest('form') || (target.form || null);
      if (!(form && !form.getAttribute('data-tracker-ignore'))) return;

      ensureFormStarted(form, target);

      if (t==='checkbox'||t==='radio'||t==='file'||tag==='select') return;

      var prev=fieldTimers.get(target); if(prev) clearTimeout(prev);
      var timer=setTimeout(function(){
        emitFieldFilled(form, target, 'debounce');
      }, 600);
      fieldTimers.set(target, timer);
    }, true);

    document.addEventListener('change', function(e){
      var target=e.target; if(!isEligibleElement(target)) return;
      var form=target.closest('form') || (target.form || null);
      if (!(form && !form.getAttribute('data-tracker-ignore'))) return;

      ensureFormStarted(form, target);
      emitFieldFilled(form, target, 'change');
    }, true);

    document.addEventListener('blur', function(e){
      var target=e.target; if(!isEligibleElement(target)) return;
      var form=target.closest('form') || (target.form || null);
      if (!(form && !form.getAttribute('data-tracker-ignore'))) return;

      ensureFormStarted(form, target);
      emitFieldFilled(form, target, 'blur');
    }, true);

    function finalizeFormFields(form){
      getAssociatedElements(form).forEach(function(el){
        if (!isEligibleElement(el)) return;
        emitFieldFilled(form, el, 'finalize');
      });
    }

    function getSafeFieldValue(el){
      if (!shouldCollectValue(el)) return undefined;
      var raw = getFieldPrimitiveValue(el);
      if (Array.isArray(raw)) {
        var arr = raw.map(function(v){ return sanitizeValue(v); }).filter(Boolean);
        if (!arr.length) return includeUncheckedAsFalse ? 'false' : undefined;
        return arr.join(', ');
      }
      var val = sanitizeValue(raw);
      if (val==='' || val==null) {
        var t=(el.type||'').toLowerCase();
        if (includeUncheckedAsFalse && (t==='checkbox' || t==='radio')) return 'false';
        return undefined;
      }
      return val;
    }

    function collectLeadData(form){
      var out = {};
      getAssociatedElements(form).forEach(function(el){
        if (!isEligibleElement(el)) return;
        if (!includeDisabledOrHidden && (el.disabled || isHidden(el))) return;

        var key=getFieldKey(el);
        if (!key) return;

        var val=getSafeFieldValue(el);
        if (typeof val!=='undefined' && val!=='') out[key]=val;
        else if (includeUncheckedAsFalse && ((el.type||'').toLowerCase()==='checkbox' || (el.type||'').toLowerCase()==='radio')) {
          out[key]='false';
        }
      });

      if (includeTrackedValuesOnLead) {
        var map = formFields.get(form) || {};
        for (var k in map) {
          if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
          if (typeof out[k] === 'undefined' || out[k] === '') {
            var v = map[k].last_value;
            if (typeof v !== 'undefined' && v !== '') out[k] = v;
          }
        }
      }
      return out;
    }

    document.addEventListener('submit', function(e){
      var form=e.target;
      if (form.getAttribute('data-tracker-ignore')) return;

      ensureFormStarted(form, form);
      finalizeFormFields(form);
      formsSubmitted.add(form);

      var leadData = includeAllFieldsOnLead ? collectLeadData(form) : {};

      if (debug && emitFormDebugSummary) {
        try {
          var seen = [];
          getAssociatedElements(form).forEach(function(el){
            if (!isEligibleElement(el)) return;
            if (!includeDisabledOrHidden && (el.disabled || isHidden(el))) return;
            var k=getFieldKey(el); if (k) seen.push(k);
          });
          var mapDbg = formFields.get(form) || {};
          Object.keys(mapDbg).forEach(function(k){ if (seen.indexOf(k)===-1) seen.push(k); });

          var sent = Object.keys(leadData || {});
          var missing = seen.filter(function(k){ return sent.indexOf(k)===-1; });

          trackEvent('FormDebugSummary', {
            form_id: form.id || 'unknown',
            form_action: form.action || window.location.href,
            seen_keys: seen,
            sent_keys: sent,
            missing_keys: missing,
            flags: {
              includeAllFieldsOnLead: includeAllFieldsOnLead,
              includeCheckboxRadioOnLead: includeCheckboxRadioOnLead,
              includeFileNamesOnLead: includeFileNamesOnLead,
              includeDisabledOrHidden: includeDisabledOrHidden,
              includeUncheckedAsFalse: includeUncheckedAsFalse,
              maskSensitiveFields: maskSensitiveFields,
              includeTrackedValuesOnLead: includeTrackedValuesOnLead,
              forceFieldValueOnFieldFilled: forceFieldValueOnFieldFilled,
              fieldFilledMaskSensitive: fieldFilledMaskSensitive
            },
            version: '1.8.1'
          });
        } catch(err){ warn('FormDebugSummary error:', err.message); }
      }

      trackEvent('Lead', {
        form_data: leadData,
        form_id: form.id || 'unknown',
        form_action: form.action || window.location.href
      });
    }, true);

    window.addEventListener('beforeunload', function(){
      document.querySelectorAll('form').forEach(function(form){
        if (form.getAttribute('data-tracker-ignore')) return;
        if (formsSubmitted.has(form)) return;
        var fieldsMap=formFields.get(form);
        if (fieldsMap && Object.keys(fieldsMap).length>0) {
          finalizeFormFields(form);

          var filledFields=Object.keys(fieldsMap);
          var total=form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]), textarea, select').length;
          var completion= total>0 ? Math.round((filledFields.length/total)*100) : 0;
          trackEvent('FormAbandoned', {
            form_id: form.id || 'unknown',
            form_action: form.action || window.location.href,
            filled_fields: filledFields,
            field_count: filledFields.length,
            total_fields: total,
            completion_rate: completion
          });
        }
      });
    });

    document.addEventListener('visibilitychange', function(){
      if (document.hidden) {
        document.querySelectorAll('form').forEach(function(form){
          try { finalizeFormFields(form); } catch(_e){}
        });
      }
    });
  }

  // ===========================
  // SCROLL
  // ===========================
  if (config.autoScrollTracking !== false) {
    var marks={'50':false,'75':false,'90':false}, timer=null;
    function depth(){
      var wh=window.innerHeight;
      var dh=Math.max(document.body.scrollHeight,document.body.offsetHeight,document.documentElement.clientHeight,document.documentElement.scrollHeight,document.documentElement.offsetHeight);
      var st=window.pageYOffset||document.documentElement.scrollTop;
      var sd=dh-wh;
      if (sd<=0) return 0;
      return Math.min(Math.round((st/sd)*100),100);
    }
    function onScroll(){
      clearTimeout(timer);
      timer=setTimeout(function(){
        var d=depth();
        if(d>=50 && !marks['50']){marks['50']=true; trackEvent('Scroll',{depth:50,scroll_percentage:d});}
        if(d>=75 && !marks['75']){marks['75']=true; trackEvent('Scroll',{depth:75,scroll_percentage:d});}
        if(d>=90 && !marks['90']){marks['90']=true; trackEvent('Scroll',{depth:90,scroll_percentage:d});}
      },150);
    }
    window.addEventListener('scroll', onScroll, {passive:true});
  }

  // ===========================
  // PUBLIC API
  // ===========================
  window.tracker = {
    track: trackEvent,
    getVisitorId: getVisitorId,
    getSessionId: getSessionId,
    version: '1.8.2',
    config: { cookiesEnabled: cookiesEnabled, storageEnabled: storageEnabled }
  };

  log('✅ Tracker inicializado v1.8.2');
  log('Company:', config.companyId);
  log('Webhook:', config.webhookUrl);

})(window, document);
