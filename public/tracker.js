/**
 * Nexxinfra Tag Manager - Tracker v1.7.0
 * Changes:
 * - Dynamic forms: collect ALL fields on Lead (text/textarea/select/checkbox/radio)
 * - FieldFilled also on 'change' (checkbox/radio/select)
 * - FormSchema snapshot on start (configurable)
 * - Aliases via data-tracker-alias
 * - More robust value serialization (arrays, booleans), masking + allowlist preserved
 */
(function (window, document) {
  'use strict';

  // ============================================
  // CONFIG
  // ============================================

  var config = window.TrackerConfig || {};

  if (!config.webhookUrl) { console.error('[Tracker] webhookUrl não configurado!'); return; }
  if (!config.companyId) { console.error('[Tracker] companyId não configurado!'); return; }

  var debug = config.debug || false;

  var collectFieldValues = config.collectFieldValues !== false; // default: true
  var maskSensitiveFields = config.maskSensitiveFields !== false; // default: true
  var maxFieldValueLength = Number(config.maxFieldValueLength || 200);
  var includeAllFieldsOnLead = config.includeAllFieldsOnLead !== false; // default: true

  // NOVO
  var includeCheckboxRadioOnLead = config.includeCheckboxRadioOnLead !== false; // default: true
  var includeFileNamesOnLead = !!config.includeFileNamesOnLead; // default: false
  var includeDisabledOrHidden = !!config.includeDisabledOrHidden; // default: false
  var emitFormSchemaOnStart = config.emitFormSchemaOnStart !== false; // default: true

  var defaultSensitivePatterns = [
    'password','senha','token','secret',
    'credit','card','cc','cvv','cvc',
    'security','ssn',
    'cpf','cnpj','rg'
  ];
  var sensitiveNamePatterns = Array.isArray(config.sensitiveNamePatterns) && config.sensitiveNamePatterns.length
    ? config.sensitiveNamePatterns : defaultSensitivePatterns;

  var fieldValueAllowlist = Array.isArray(config.fieldValueAllowlist) ? config.fieldValueAllowlist : [];

  function log(){ if (debug) console.log('[Tracker]', [].slice.call(arguments).join(' ')); }
  function warn(){ if (debug) console.warn('[Tracker]', [].slice.call(arguments).join(' ')); }

  // ============================================
  // CAPABILITIES
  // ============================================

  var cookiesEnabled = false;
  try {
    document.cookie = '_test=1';
    cookiesEnabled = document.cookie.indexOf('_test=1') !== -1;
    document.cookie = '_test=1; expires=Thu, 01 Jan 1970 00:00:01 GMT';
  } catch (e) { warn('Cookies bloqueados:', e.message); }

  var storageEnabled = false;
  try { localStorage.setItem('_test','1'); localStorage.removeItem('_test'); storageEnabled = true; }
  catch (e) { warn('LocalStorage bloqueado:', e.message); }

  // ============================================
  // STORAGE HELPERS
  // ============================================

  function getCookie(name){
    if (!cookiesEnabled) return null;
    try {
      var value = '; ' + document.cookie;
      var parts = value.split('; ' + name + '=');
      if (parts.length === 2) return parts.pop().split(';').shift();
      return null;
    } catch(e){ warn('Erro ao ler cookie:', name, e.message); return null; }
  }
  function setCookie(name, value, days){
    if (!cookiesEnabled) return false;
    try {
      var d = new Date(); d.setTime(d.getTime() + (days*24*60*60*1000));
      document.cookie = name + '=' + value + ';expires=' + d.toUTCString() + ';path=/';
      return true;
    } catch(e){ warn('Erro ao setar cookie:', name, e.message); return false; }
  }
  function getStorage(key){
    if (!storageEnabled) return null;
    try { return localStorage.getItem(key); }
    catch(e){ warn('Erro ao ler localStorage:', key, e.message); return null; }
  }
  function setStorage(key, value){
    if (!storageEnabled) return false;
    try { localStorage.setItem(key, value); return true; }
    catch(e){ warn('Erro ao setar localStorage:', key, e.message); return false; }
  }
  function getSessionStorage(key){
    try { return sessionStorage.getItem(key); }
    catch(e){ warn('Erro ao ler sessionStorage:', key, e.message); return null; }
  }
  function setSessionStorage(key, value){
    try { sessionStorage.setItem(key, value); return true; }
    catch(e){ warn('Erro ao setar sessionStorage:', key, e.message); return false; }
  }

  // ============================================
  // UTILS
  // ============================================

  function getUrlParam(param){ try { return new URLSearchParams(window.location.search).get(param); } catch(e){ return null; } }
  function generateId(prefix){ return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9); }

  function getLabelForField(field){
    var fieldId = field.id;
    if (fieldId) {
      var label = document.querySelector('label[for="' + fieldId + '"]');
      if (label) return label.textContent.trim();
    }
    var parent = field.parentElement;
    if (parent) {
      var lbl = parent.querySelector('label');
      if (lbl) return lbl.textContent.trim();
    }
    return field.placeholder || field.name || 'unknown';
  }

  function isHidden(el){
    var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    return (style && (style.display === 'none' || style.visibility === 'hidden')) || el.type === 'hidden';
  }

  function getFieldKey(el){
    // alias tem prioridade
    var alias = el.getAttribute('data-tracker-alias');
    if (alias) return String(alias);
    return el.name || el.id || ('field_' + (el.type || 'text'));
  }

  // ============================================
  // SENSITIVE / VALUE RULES
  // ============================================

  function isInAllowlist(field){
    var n = (field.name || '').toLowerCase();
    var i = (field.id || '').toLowerCase();
    return fieldValueAllowlist.some(function (k) {
      var key = (k || '').toLowerCase();
      return key && (n === key || i === key);
    });
  }
  function isSensitiveByName(nameOrId){
    var x = (nameOrId || '').toLowerCase();
    return sensitiveNamePatterns.some(function (pat){ return x.includes(String(pat).toLowerCase()); });
  }
  function isFieldSensitive(field){
    var type = (field.type || '').toLowerCase();
    if (type === 'password') return true;
    if (field.hasAttribute('data-tracker-mask')) return true;
    return isSensitiveByName(field.name) || isSensitiveByName(field.id);
  }
  function shouldCollectValue(field){
    if (!collectFieldValues) return false;
    if (field.getAttribute('data-tracker-no-value') === 'true') return false;

    var tag = (field.tagName || '').toLowerCase();
    var t = (field.type || '').toLowerCase();

    // arquivo: só se explicitamente permitido
    if (t === 'file') return !!includeFileNamesOnLead;

    // checkbox/radio: permitido via flag
    if ((t === 'checkbox' || t === 'radio') && !includeCheckboxRadioOnLead) return false;

    // demais tipos comuns + textarea/select
    var okType = (
      t === 'text' || t === 'email' || t === 'tel' || t === 'number' ||
      t === 'search' || t === 'url' || t === 'password' || // password será bloqueado por maskSensitiveFields (salvo allowlist)
      t === 'checkbox' || t === 'radio' || t === 'file' ||
      t === 'date' || t === 'datetime-local' || t === 'time' ||
      t === 'month' || t === 'week' || t === 'color'
    );
    var okTag = (tag === 'textarea' || tag === 'select');

    if (!(okType || okTag)) return false;

    if (maskSensitiveFields && isFieldSensitive(field) && !isInAllowlist(field)) return false;

    return true;
  }

  function sanitizeValue(str){
    try {
      var s = (Array.isArray(str) ? str.join(', ') : String(str || ''));
      s = s.replace(/\s+/g, ' ').trim();
      if (s.length > maxFieldValueLength) s = s.slice(0, maxFieldValueLength);
      return s;
    } catch(e){ return ''; }
  }

  function getFieldPrimitiveValue(el){
    var tag = (el.tagName || '').toLowerCase();
    var t = (el.type || '').toLowerCase();

    if (t === 'checkbox') {
      // grupo de checkboxes com o mesmo name => lista
      if (el.name) {
        var group = Array.from(el.form ? el.form.querySelectorAll('input[type="checkbox"][name="'+el.name+'"]') : []);
        if (group.length > 1) {
          var selected = group.filter(function(i){ return i.checked; }).map(function(i){ return i.value || 'on'; });
          return selected;
        }
      }
      return el.checked ? (el.value || true) : '';
    }

    if (t === 'radio') {
      if (el.name) {
        var chosen = (el.form ? el.form.querySelector('input[type="radio"][name="'+el.name+'"]:checked') : null);
        return chosen ? (chosen.value || 'on') : '';
      }
      return el.checked ? (el.value || 'on') : '';
    }

    if (t === 'file') {
      if (!includeFileNamesOnLead) return '';
      var f = el.files && el.files[0];
      return f ? f.name : '';
    }

    if (tag === 'select') {
      if (el.multiple) {
        return Array.from(el.selectedOptions || []).map(function (o){ return o.value; });
      }
      return el.value || '';
    }

    // padrão inputs/textarea
    return el.value || '';
  }

  function getSafeFieldValue(el){
    if (!shouldCollectValue(el)) return undefined;
    var raw = getFieldPrimitiveValue(el);
    if (Array.isArray(raw)) {
      var arr = raw.map(function (v){ return sanitizeValue(v); }).filter(Boolean);
      if (!arr.length) return undefined;
      return arr.join(', ');
    }
    var val = sanitizeValue(raw);
    if (!val) return undefined;
    return val;
  }

  // ============================================
  // TRACKING IDS
  // ============================================

  function getVisitorId(){
    var id = getCookie('_visitor_id') || getStorage('_visitor_id');
    if (id) return id;
    id = generateId('vis');
    if (!setCookie('_visitor_id', id, 365)) setStorage('_visitor_id', id);
    return id;
  }
  function getSessionId(){
    var id = getSessionStorage('_session_id');
    if (!id){ id = generateId('sess'); setSessionStorage('_session_id', id); }
    return id;
  }
  function getFBP(){
    var fbp = getCookie('_fbp') || getStorage('_fbp');
    if (!fbp){ fbp = 'fb.1.' + Date.now() + '.' + Math.random().toString(36).substr(2, 9); if (!setCookie('_fbp', fbp, 90)) setStorage('_fbp', fbp); }
    return fbp;
  }
  function getFBC(){
    var fbc = getCookie('_fbc') || getStorage('_fbc');
    var fbclid = getUrlParam('fbclid');
    if (fbclid && !fbc){ fbc = 'fb.1.' + Date.now() + '.' + fbclid; if (!setCookie('_fbc', fbc, 90)) setStorage('_fbc', fbc); }
    return fbc;
  }
  function captureUTMs(){
    var utm = {
      utm_source: getUrlParam('utm_source'),
      utm_medium: getUrlParam('utm_medium'),
      utm_campaign: getUrlParam('utm_campaign'),
      utm_content: getUrlParam('utm_content'),
      utm_term: getUrlParam('utm_term')
    };
    if (utm.utm_source || utm.utm_campaign) setSessionStorage('_utms', JSON.stringify(utm));
    var saved = getSessionStorage('_utms');
    return saved ? JSON.parse(saved) : utm;
  }

  // ============================================
  // SEND EVENT
  // ============================================

  function trackEvent(eventName, eventData){
    eventData = eventData || {};
    var utms = captureUTMs();

    var payload = {
      company_id: config.companyId,
      event_name: eventName,
      event_data: {
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
        screen_resolution: screen.width + 'x' + screen.height,
        language: navigator.language,

        timestamp: new Date().toISOString()
      }
    };

    for (var k in eventData) if (Object.prototype.hasOwnProperty.call(eventData, k)) payload.event_data[k] = eventData[k];

    log('Enviando evento:', eventName);
    fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    })
    .then(function (r){
      if (!r.ok) { warn('Erro ao enviar evento:', r.status, r.statusText); throw new Error('HTTP ' + r.status); }
      return r.json().catch(function(){ return { success:true }; });
    })
    .then(function (data){ log('Resposta do servidor:', data); })
    .catch(function (err){ warn('Erro ao enviar evento:', err.message); });
  }

  // ============================================
  // PAGEVIEW
  // ============================================

  function sendPageView(){ trackEvent('PageView', { load_time: performance.now ? Math.round(performance.now()) : 0 }); }
  if (config.autoPageView !== false){
    if (document.readyState === 'complete') sendPageView();
    else window.addEventListener('load', sendPageView);
  }

  // ============================================
  // FORMS
  // ============================================

  if (config.autoFormTracking !== false) {
    var formsStarted = new WeakMap();
    var formFields = new WeakMap();     // por form: { key -> meta }
    var formsSubmitted = new WeakSet();
    var fieldTimers = new WeakMap();    // debounce por elemento

    function isEligibleElement(el){
      if (!el) return false;
      var tag = (el.tagName || '').toLowerCase();
      var type = (el.type || '').toLowerCase();
      if (tag === 'input') {
        // considerar praticamente todos, exceto botões puros
        if (type === 'button' || type === 'submit' || type === 'reset') return false;
        if (!includeDisabledOrHidden && (el.disabled || isHidden(el))) return false;
        return true;
      }
      if (tag === 'textarea' || tag === 'select') {
        if (!includeDisabledOrHidden && (el.disabled || isHidden(el))) return false;
        return true;
      }
      return false;
    }

    function emitFormSchema(form){
      if (!emitFormSchemaOnStart) return;
      var schema = [];
      Array.from(form.elements || []).forEach(function (el){
        if (!isEligibleElement(el)) return;
        var key = getFieldKey(el);
        schema.push({
          key: key,
          name: el.name || null,
          id: el.id || null,
          type: el.type || (el.tagName || '').toLowerCase(),
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

    // start
    document.addEventListener('focus', function (e){
      var target = e.target;
      if (!isEligibleElement(target)) return;
      var form = target.closest('form');
      if (form && !form.getAttribute('data-tracker-ignore')) {
        if (!formsStarted.get(form)) {
          formsStarted.set(form, true);
          trackEvent('FormStarted', {
            form_id: form.id || 'unknown',
            form_action: form.action || window.location.href,
            first_field: getFieldKey(target)
          });
          log('Formulário iniciado:', form.id || 'unknown');
          formFields.set(form, {});
          emitFormSchema(form);
        }
      }
    }, true);

    // input (debounced) para textos
    document.addEventListener('input', function (e){
      var target = e.target;
      if (!isEligibleElement(target)) return;
      var t = (target.type || '').toLowerCase();
      if (t === 'checkbox' || t === 'radio' || t === 'file' || (target.tagName || '').toLowerCase() === 'select') {
        // esses disparam pelo 'change'
        return;
      }
      var form = target.closest('form');
      if (!(form && !form.getAttribute('data-tracker-ignore'))) return;

      var fields = formFields.get(form) || {};
      var key = getFieldKey(target);

      // debounce
      var prev = fieldTimers.get(target);
      if (prev) clearTimeout(prev);

      var timer = setTimeout(function(){
        var hasText = !!((target.value || '').trim());
        if (hasText && !fields[key]) {
          fields[key] = { type: target.type, filled: true, tracked: true, timestamp: new Date().toISOString() };
          formFields.set(form, fields);

          var val = getSafeFieldValue(target);
          var payload = {
            form_id: form.id || 'unknown',
            field_name: key,
            field_type: target.type,
            field_label: getLabelForField(target)
          };
          if (typeof val !== 'undefined') payload.field_value = val;

          trackEvent('FieldFilled', payload);
          log('Campo preenchido (input):', key, typeof val !== 'undefined' ? '(valor enviado)' : '(valor NÃO enviado)');
        }
      }, 800); // 800ms: um pouco mais ágil

      fieldTimers.set(target, timer);
    }, true);

    // change (checkbox/radio/select/file/dates)
    document.addEventListener('change', function (e){
      var target = e.target;
      if (!isEligibleElement(target)) return;
      var form = target.closest('form');
      if (!(form && !form.getAttribute('data-tracker-ignore'))) return;

      var fields = formFields.get(form) || {};
      var key = getFieldKey(target);

      // limpar debounce pendente se houver
      var tmr = fieldTimers.get(target);
      if (tmr) { clearTimeout(tmr); fieldTimers.delete(target); }

      var raw = getFieldPrimitiveValue(target);
      var hasVal = (Array.isArray(raw) ? raw.length > 0 : !!String(raw).trim());

      if (hasVal && !fields[key]) {
        fields[key] = { type: target.type, filled: true, tracked: true, timestamp: new Date().toISOString() };
        formFields.set(form, fields);

        var val = getSafeFieldValue(target);
        var payload = {
          form_id: form.id || 'unknown',
          field_name: key,
          field_type: target.type,
          field_label: getLabelForField(target)
        };
        if (typeof val !== 'undefined') payload.field_value = val;

        trackEvent('FieldFilled', payload);
        log('Campo preenchido (change):', key, typeof val !== 'undefined' ? '(valor enviado)' : '(valor NÃO enviado)');
      }
    }, true);

    // finalize pending + collect lead
    function finalizeFormFields(form){
      var fields = formFields.get(form) || {};
      var els = Array.from(form.elements || []);
      els.forEach(function (el){
        if (!isEligibleElement(el)) return;

        // clear debounce
        var t = fieldTimers.get(el);
        if (t) { clearTimeout(t); fieldTimers.delete(el); }

        var key = getFieldKey(el);
        var raw = getFieldPrimitiveValue(el);
        var hasVal = (Array.isArray(raw) ? raw.length > 0 : !!String(raw).trim());

        if (hasVal && !fields[key]) {
          fields[key] = { type: el.type, filled: true, tracked: true, timestamp: new Date().toISOString() };

          var val = getSafeFieldValue(el);
          var payload = {
            form_id: form.id || 'unknown',
            field_name: key,
            field_type: el.type,
            field_label: getLabelForField(el)
          };
          if (typeof val !== 'undefined') payload.field_value = val;

          trackEvent('FieldFilled', payload);
          log('Campo preenchido (finalize submit):', key, typeof val !== 'undefined' ? '(valor enviado)' : '(valor NÃO enviado)');
        }
      });
      formFields.set(form, fields);
    }

    function collectLeadData(form){
      var lead = {};
      var els = Array.from(form.elements || []);
      els.forEach(function (el){
        if (!isEligibleElement(el)) return;

        // se for hidden/disabled e não queremos, pula
        if (!includeDisabledOrHidden && (el.disabled || isHidden(el))) return;

        var key = getFieldKey(el);
        if (!key) return;

        var val = getSafeFieldValue(el);
        if (typeof val !== 'undefined' && val !== '') {
          lead[key] = val;
        }
      });
      return lead;
    }

    // submit
    document.addEventListener('submit', function (e){
      var form = e.target;
      if (form.getAttribute('data-tracker-ignore')) return;

      // flush
      finalizeFormFields(form);
      formsSubmitted.add(form);

      var leadData = includeAllFieldsOnLead ? collectLeadData(form) : (function(){
        var out = {};
        ['name','nome','email','phone','telefone','message','mensagem','empresa','company'].forEach(function (n){
          var el = form.querySelector('[name="'+n+'"],#'+n);
          if (el) {
            var v = getSafeFieldValue(el);
            if (typeof v !== 'undefined' && v !== '') out[n] = v;
          }
        });
        return out;
      })();

      trackEvent('Lead', {
        form_data: leadData,
        form_id: form.id || 'unknown',
        form_action: form.action || window.location.href
      });
    }, true);

    // abandono
    window.addEventListener('beforeunload', function (){
      document.querySelectorAll('form').forEach(function (form){
        if (form.getAttribute('data-tracker-ignore')) return;
        if (formsSubmitted.has(form)) return;

        var fields = formFields.get(form);
        if (fields && Object.keys(fields).length > 0) {
          var filledFields = Object.keys(fields);
          var fieldCount = filledFields.length;
          var totalFields = form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]), textarea, select').length;
          var completionRate = totalFields > 0 ? Math.round((fieldCount/totalFields)*100) : 0;

          trackEvent('FormAbandoned', {
            form_id: form.id || 'unknown',
            form_action: form.action || window.location.href,
            filled_fields: filledFields,
            field_count: fieldCount,
            total_fields: totalFields,
            completion_rate: completionRate
          });

          log('Formulário abandonado:', form.id || 'unknown', 'Preenchimento:', completionRate + '%');
        }
      });
    });
  }

  // ============================================
  // SCROLL
  // ============================================

  if (config.autoScrollTracking !== false) {
    var scrollDepths = { '50': false, '75': false, '90': false };
    var scrollTimer = null;

    function calculateScrollDepth(){
      var wh = window.innerHeight;
      var dh = Math.max(
        document.body.scrollHeight, document.body.offsetHeight,
        document.documentElement.clientHeight, document.documentElement.scrollHeight,
        document.documentElement.offsetHeight
      );
      var st = window.pageYOffset || document.documentElement.scrollTop;
      var sd = dh - wh;
      if (sd <= 0) return 0;
      return Math.min(Math.round((st / sd) * 100), 100);
    }

    function handleScroll(){
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(function (){
        var depth = calculateScrollDepth();
        if (depth >= 50 && !scrollDepths['50']) { scrollDepths['50'] = true; trackEvent('Scroll', { depth: 50, scroll_percentage: depth }); }
        if (depth >= 75 && !scrollDepths['75']) { scrollDepths['75'] = true; trackEvent('Scroll', { depth: 75, scroll_percentage: depth }); }
        if (depth >= 90 && !scrollDepths['90']) { scrollDepths['90'] = true; trackEvent('Scroll', { depth: 90, scroll_percentage: depth }); }
      }, 150);
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
  }

  // ============================================
  // PUBLIC API
  // ============================================

  window.tracker = {
    track: trackEvent,
    getVisitorId: getVisitorId,
    getSessionId: getSessionId,
    version: '1.7.0',
    config: { cookiesEnabled: cookiesEnabled, storageEnabled: storageEnabled }
  };

  log('Tracker inicializado v1.7.0');
  log('Company:', config.companyId);
  log('Webhook:', config.webhookUrl);

})(window, document);
