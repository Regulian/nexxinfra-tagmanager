/**
 * Nexxinfra Tag Manager - Tracker v1.5.0
 * Additions:
 * - Field value capture for FieldFilled (with sanitization + masking)
 * - Config & data-attributes to control collection behavior
 */
(function (window, document) {
  'use strict';

  // ============================================
  // CONFIGURAÇÃO
  // ============================================

  var config = window.TrackerConfig || {};

  if (!config.webhookUrl) {
    console.error('[Tracker] webhookUrl não configurado!');
    return;
  }
  if (!config.companyId) {
    console.error('[Tracker] companyId não configurado!');
    return;
  }

  var debug = config.debug || false;

  // NOVO: opções de coleta de valores
  var collectFieldValues = config.collectFieldValues !== false; // default: true
  var maskSensitiveFields = config.maskSensitiveFields !== false; // default: true
  var maxFieldValueLength = Number(config.maxFieldValueLength || 200);

  // padrões sensíveis (nome/id/type) — podem ser sobrescritos
  var defaultSensitivePatterns = [
    'password', 'senha', 'token', 'secret',
    'credit', 'card', 'cc', 'cvv', 'cvc',
    'security', 'ssn',
    'cpf', 'cnpj', 'rg'
  ];
  var sensitiveNamePatterns = Array.isArray(config.sensitiveNamePatterns) && config.sensitiveNamePatterns.length
    ? config.sensitiveNamePatterns
    : defaultSensitivePatterns;

  // allowlist de campos cujo valor você SEMPRE quer coletar (mesmo se soar sensível)
  var fieldValueAllowlist = Array.isArray(config.fieldValueAllowlist) ? config.fieldValueAllowlist : [];

  function log() { if (debug) console.log('[Tracker]', [].slice.call(arguments).join(' ')); }
  function warn() { if (debug) console.warn('[Tracker]', [].slice.call(arguments).join(' ')); }

  // ============================================
  // DETECÇÃO DE RECURSOS
  // ============================================

  var cookiesEnabled = false;
  try {
    document.cookie = '_test=1';
    cookiesEnabled = document.cookie.indexOf('_test=1') !== -1;
    document.cookie = '_test=1; expires=Thu, 01 Jan 1970 00:00:01 GMT';
  } catch (e) { warn('Cookies bloqueados:', e.message); }

  var storageEnabled = false;
  try {
    localStorage.setItem('_test', '1');
    localStorage.removeItem('_test');
    storageEnabled = true;
  } catch (e) { warn('LocalStorage bloqueado:', e.message); }

  log('Cookies:', cookiesEnabled ? 'Habilitados' : 'Bloqueados');
  log('LocalStorage:', storageEnabled ? 'Habilitado' : 'Bloqueado');

  // ============================================
  // FUNÇÕES DE STORAGE
  // ============================================

  function getCookie(name) {
    if (!cookiesEnabled) return null;
    try {
      var value = '; ' + document.cookie;
      var parts = value.split('; ' + name + '=');
      if (parts.length === 2) return parts.pop().split(';').shift();
      return null;
    } catch (e) { warn('Erro ao ler cookie:', name, e.message); return null; }
  }

  function setCookie(name, value, days) {
    if (!cookiesEnabled) return false;
    try {
      var date = new Date();
      date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
      document.cookie = name + '=' + value + ';expires=' + date.toUTCString() + ';path=/';
      return true;
    } catch (e) { warn('Erro ao setar cookie:', name, e.message); return false; }
  }

  function getStorage(key) {
    if (!storageEnabled) return null;
    try { return localStorage.getItem(key); }
    catch (e) { warn('Erro ao ler localStorage:', key, e.message); return null; }
  }

  function setStorage(key, value) {
    if (!storageEnabled) return false;
    try { localStorage.setItem(key, value); return true; }
    catch (e) { warn('Erro ao setar localStorage:', key, e.message); return false; }
  }

  function getSessionStorage(key) {
    try { return sessionStorage.getItem(key); }
    catch (e) { warn('Erro ao ler sessionStorage:', key, e.message); return null; }
  }

  function setSessionStorage(key, value) {
    try { sessionStorage.setItem(key, value); return true; }
    catch (e) { warn('Erro ao setar sessionStorage:', key, e.message); return false; }
  }

  // ============================================
  // FUNÇÕES AUXILIARES
  // ============================================

  function getUrlParam(param) {
    try { return new URLSearchParams(window.location.search).get(param); }
    catch (e) { return null; }
  }

  function generateId(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // label do campo
  function getLabelForField(field) {
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

  // ============================================
  // SANITIZAÇÃO / COLETA DE VALORES (NOVO)
  // ============================================

  function isInAllowlist(field) {
    var n = (field.name || '').toLowerCase();
    var i = (field.id || '').toLowerCase();
    return fieldValueAllowlist.some(function (k) {
      var key = (k || '').toLowerCase();
      return key && (n === key || i === key);
    });
  }

  function isSensitiveByName(nameOrId) {
    var x = (nameOrId || '').toLowerCase();
    return sensitiveNamePatterns.some(function (pat) { return x.includes(pat.toLowerCase()); });
  }

  function isFieldSensitive(field) {
    var type = (field.type || '').toLowerCase();
    if (type === 'password') return true;
    if (field.hasAttribute('data-tracker-mask')) return true;
    return isSensitiveByName(field.name) || isSensitiveByName(field.id);
  }

  function shouldCollectValue(field) {
    if (!collectFieldValues) return false;
    if (field.getAttribute('data-tracker-no-value') === 'true') return false;

    // tipos suportados
    var t = (field.type || '').toLowerCase();
    var tag = (field.tagName || '').toLowerCase();
    var okType = (
      t === 'text' || t === 'email' || t === 'tel' || t === 'number' ||
      t === 'search' || t === 'url' || t === 'textarea' || t === 'select-one' ||
      t === 'select-multiple' || tag === 'textarea' || tag === 'select'
    );
    if (!okType) return false;

    // máscara pode bloquear a menos que esteja em allowlist
    if (maskSensitiveFields && isFieldSensitive(field) && !isInAllowlist(field)) return false;

    return true;
  }

  function getRawFieldValue(field) {
    var tag = (field.tagName || '').toLowerCase();
    if (tag === 'select') {
      if (field.multiple) {
        return Array.from(field.selectedOptions || []).map(function (o) { return o.value; }).join(', ');
      }
      return field.value || '';
    }
    // inputs/textarea
    return (field.value || '');
  }

  function sanitizeValue(str) {
    try {
      var s = String(str || '');
      // normaliza espaços/brancos
      s = s.replace(/\s+/g, ' ').trim();
      if (s.length > maxFieldValueLength) s = s.slice(0, maxFieldValueLength);
      return s;
    } catch (e) { return ''; }
  }

  function getSafeFieldValue(field) {
    if (!shouldCollectValue(field)) return undefined; // não enviar

    var raw = getRawFieldValue(field);
    var val = sanitizeValue(raw);
    if (!val) return undefined;

    return val;
  }

  // ============================================
  // IDS DE RASTREAMENTO
  // ============================================

  function getVisitorId() {
    var visitorId = getCookie('_visitor_id') || getStorage('_visitor_id');
    if (visitorId) return visitorId;
    visitorId = generateId('vis');
    if (!setCookie('_visitor_id', visitorId, 365)) setStorage('_visitor_id', visitorId);
    return visitorId;
  }

  function getSessionId() {
    var sessionId = getSessionStorage('_session_id');
    if (!sessionId) {
      sessionId = generateId('sess');
      setSessionStorage('_session_id', sessionId);
    }
    return sessionId;
  }

  function getFBP() {
    var fbp = getCookie('_fbp') || getStorage('_fbp');
    if (!fbp) {
      fbp = 'fb.1.' + Date.now() + '.' + Math.random().toString(36).substr(2, 9);
      if (!setCookie('_fbp', fbp, 90)) setStorage('_fbp', fbp);
    }
    return fbp;
  }

  function getFBC() {
    var fbc = getCookie('_fbc') || getStorage('_fbc');
    var fbclid = getUrlParam('fbclid');
    if (fbclid && !fbc) {
      fbc = 'fb.1.' + Date.now() + '.' + fbclid;
      if (!setCookie('_fbc', fbc, 90)) setStorage('_fbc', fbc);
    }
    return fbc;
  }

  function captureUTMs() {
    var utms = {
      utm_source: getUrlParam('utm_source'),
      utm_medium: getUrlParam('utm_medium'),
      utm_campaign: getUrlParam('utm_campaign'),
      utm_content: getUrlParam('utm_content'),
      utm_term: getUrlParam('utm_term')
    };
    if (utms.utm_source || utms.utm_campaign) setSessionStorage('_utms', JSON.stringify(utms));
    var saved = getSessionStorage('_utms');
    return saved ? JSON.parse(saved) : utms;
  }

  // ============================================
  // ENVIAR EVENTO
  // ============================================

  function trackEvent(eventName, eventData) {
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

    for (var key in eventData) {
      if (Object.prototype.hasOwnProperty.call(eventData, key)) {
        payload.event_data[key] = eventData[key];
      }
    }

    log('Enviando evento:', eventName);
    log('Payload:', JSON.stringify(payload, null, 2));

    fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    })
    .then(function (response) {
      if (response.ok) {
        log('Evento enviado com sucesso:', response.status);
        return response.json().catch(function () { return { success: true }; });
      } else {
        warn('Erro ao enviar evento:', response.status, response.statusText);
        throw new Error('HTTP ' + response.status);
      }
    })
    .then(function (data) { log('Resposta do servidor:', data); })
    .catch(function (err) { warn('Erro ao enviar evento:', err.message); });
  }

  // ============================================
  // PAGEVIEW AUTOMÁTICO
  // ============================================

  function sendPageView() {
    trackEvent('PageView', { load_time: performance.now ? Math.round(performance.now()) : 0 });
  }
  if (config.autoPageView !== false) {
    if (document.readyState === 'complete') sendPageView();
    else window.addEventListener('load', sendPageView);
  }

  // ============================================
  // FORM INTERACTION TRACKING
  // ============================================

  if (config.autoFormTracking !== false) {
    var formsStarted = new WeakMap();
    var formFields = new WeakMap();
    var formsSubmitted = new WeakSet();
    var fieldTimers = new WeakMap(); // debounce

    // começou a preencher
    document.addEventListener('focus', function (e) {
      var target = e.target;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        var form = target.closest('form');
        if (form && !form.getAttribute('data-tracker-ignore')) {
          if (!formsStarted.get(form)) {
            formsStarted.set(form, true);
            trackEvent('FormStarted', {
              form_id: form.id || 'unknown',
              form_action: form.action || window.location.href,
              first_field: target.name || target.id || 'unknown'
            });
            log('Formulário iniciado:', form.id || 'unknown');
            formFields.set(form, {});
          }
        }
      }
    }, true);

    // input com debounce -> FieldFilled (NOVO: inclui field_value)
    document.addEventListener('input', function (e) {
      var target = e.target;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        var form = target.closest('form');
        if (form && !form.getAttribute('data-tracker-ignore')) {
          var fieldName = target.name || target.id || 'field_' + target.type;
          var fields = formFields.get(form) || {};

          var prevTimer = fieldTimers.get(target);
          if (prevTimer) clearTimeout(prevTimer);

          var timer = setTimeout(function () {
            var val = getSafeFieldValue(target); // pode voltar undefined (não coleta)
            var hasText = !!((target.value || '').trim());

            if (hasText) {
              if (!fields[fieldName] || !fields[fieldName].tracked) {
                fields[fieldName] = {
                  type: target.type,
                  filled: true,
                  tracked: true,
                  timestamp: new Date().toISOString()
                };
                formFields.set(form, fields);

                var eventPayload = {
                  form_id: form.id || 'unknown',
                  field_name: fieldName,
                  field_type: target.type,
                  field_label: getLabelForField(target)
                };
                if (typeof val !== 'undefined') {
                  eventPayload.field_value = val;
                }

                trackEvent('FieldFilled', eventPayload);
                log('Campo preenchido:', fieldName, typeof val !== 'undefined' ? '(valor enviado)' : '(valor NÃO enviado)');
              }
            }
          }, 1000); // 1s de debounce

          fieldTimers.set(target, timer);
        }
      }
    }, true);

    // blur -> captura FieldFilled se perder o input (NOVO: inclui field_value)
    document.addEventListener('blur', function (e) {
      var target = e.target;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        var form = target.closest('form');
        if (form && !form.getAttribute('data-tracker-ignore')) {
          var fields = formFields.get(form) || {};
          var fieldName = target.name || target.id || 'field_' + target.type;
          var hasText = !!((target.value || '').trim());

          if (hasText && !fields[fieldName]) {
            fields[fieldName] = {
              type: target.type,
              filled: true,
              tracked: true,
              timestamp: new Date().toISOString()
            };
            formFields.set(form, fields);

            var val = getSafeFieldValue(target);
            var eventPayload = {
              form_id: form.id || 'unknown',
              field_name: fieldName,
              field_type: target.type,
              field_label: getLabelForField(target)
            };
            if (typeof val !== 'undefined') {
              eventPayload.field_value = val;
            }

            trackEvent('FieldFilled', eventPayload);
            log('Campo preenchido (blur):', fieldName, typeof val !== 'undefined' ? '(valor enviado)' : '(valor NÃO enviado)');
          }
        }
      }
    }, true);

    // submit (Lead)
    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (form.getAttribute('data-tracker-ignore')) return;

      formsSubmitted.add(form);

      var formData = new FormData(form);
      var leadData = {};

      // mantém compatibilidade (captura campos comuns)
      var commonFields = ['name', 'nome', 'email', 'phone', 'telefone', 'message', 'mensagem'];
      commonFields.forEach(function (field) {
        if (formData.has(field)) {
          leadData[field] = formData.get(field);
        }
      });

      trackEvent('Lead', {
        form_data: leadData,
        form_id: form.id || 'unknown',
        form_action: form.action || window.location.href
      });
    }, true);

    // abandono
    window.addEventListener('beforeunload', function () {
      document.querySelectorAll('form').forEach(function (form) {
        if (form.getAttribute('data-tracker-ignore')) return;
        if (formsSubmitted.has(form)) return;

        var fields = formFields.get(form);
        if (fields && Object.keys(fields).length > 0) {
          var filledFields = Object.keys(fields);
          var fieldCount = filledFields.length;
          var totalFields = form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]), textarea, select').length;
          var completionRate = totalFields > 0 ? Math.round((fieldCount / totalFields) * 100) : 0;

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

    log('Form tracking ativado (Submit, Started, FieldFilled, Abandoned)');
  }

  // ===============================================
  // SCROLL TRACKING
  // ============================================

  if (config.autoScrollTracking !== false) {
    var scrollDepths = { '50': false, '75': false, '90': false };
    var scrollTimer = null;

    function calculateScrollDepth() {
      var windowHeight = window.innerHeight;
      var documentHeight = Math.max(
        document.body.scrollHeight, document.body.offsetHeight,
        document.documentElement.clientHeight, document.documentElement.scrollHeight,
        document.documentElement.offsetHeight
      );
      var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      var scrollableDistance = documentHeight - windowHeight;
      if (scrollableDistance <= 0) return 0;
      var scrolledPercentage = Math.round((scrollTop / scrollableDistance) * 100);
      return Math.min(scrolledPercentage, 100);
    }

    function handleScroll() {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(function () {
        var depth = calculateScrollDepth();

        if (depth >= 50 && !scrollDepths['50']) {
          scrollDepths['50'] = true;
          trackEvent('Scroll', { depth: 50, scroll_percentage: depth });
          log('Scroll marco atingido: 50%');
        }
        if (depth >= 75 && !scrollDepths['75']) {
          scrollDepths['75'] = true;
          trackEvent('Scroll', { depth: 75, scroll_percentage: depth });
          log('Scroll marco atingido: 75%');
        }
        if (depth >= 90 && !scrollDepths['90']) {
          scrollDepths['90'] = true;
          trackEvent('Scroll', { depth: 90, scroll_percentage: depth });
          log('Scroll marco atingido: 90%');
        }
      }, 150);
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    log('Scroll tracking ativado (50%, 75%, 90%)');
  }

  // ============================================
  // API PÚBLICA
  // ============================================

  window.tracker = {
    track: trackEvent,
    getVisitorId: getVisitorId,
    getSessionId: getSessionId,
    version: '1.5.0',
    config: { cookiesEnabled: cookiesEnabled, storageEnabled: storageEnabled }
  };

  log('Tracker inicializado v1.5.0');
  log('Company:', config.companyId);
  log('Webhook:', config.webhookUrl);

})(window, document);
