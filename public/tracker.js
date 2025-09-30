/**
 * Nexxinfra Tag Manager - Tracker v1.3.0
 * Features:
 * - Cookie/LocalStorage fallback para ambientes restritos
 * - Auto PageView tracking
 * - Auto Form tracking
 * - Scroll depth tracking (50%, 75%, 90%)
 * - UTM parameters capture
 * - Facebook Pixel IDs (fbp, fbc)
 * - Google Click ID (gclid)
 */
(function(window, document) {
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

  function log() {
    if (debug) {
      console.log('[Tracker]', Array.prototype.slice.call(arguments).join(' '));
    }
  }

  function warn() {
    if (debug) {
      console.warn('[Tracker]', Array.prototype.slice.call(arguments).join(' '));
    }
  }

  // ============================================
  // DETECÇÃO DE RECURSOS
  // ============================================

  var cookiesEnabled = false;
  try {
    document.cookie = '_test=1';
    cookiesEnabled = document.cookie.indexOf('_test=1') !== -1;
    document.cookie = '_test=1; expires=Thu, 01 Jan 1970 00:00:01 GMT';
  } catch(e) {
    warn('Cookies bloqueados:', e.message);
  }

  var storageEnabled = false;
  try {
    localStorage.setItem('_test', '1');
    localStorage.removeItem('_test');
    storageEnabled = true;
  } catch(e) {
    warn('LocalStorage bloqueado:', e.message);
  }

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
    } catch(e) {
      warn('Erro ao ler cookie:', name, e.message);
      return null;
    }
  }

  function setCookie(name, value, days) {
    if (!cookiesEnabled) return false;
    
    try {
      var date = new Date();
      date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
      document.cookie = name + '=' + value + ';expires=' + date.toUTCString() + ';path=/';
      return true;
    } catch(e) {
      warn('Erro ao setar cookie:', name, e.message);
      return false;
    }
  }

  function getStorage(key) {
    if (!storageEnabled) return null;
    
    try {
      return localStorage.getItem(key);
    } catch(e) {
      warn('Erro ao ler localStorage:', key, e.message);
      return null;
    }
  }

  function setStorage(key, value) {
    if (!storageEnabled) return false;
    
    try {
      localStorage.setItem(key, value);
      return true;
    } catch(e) {
      warn('Erro ao setar localStorage:', key, e.message);
      return false;
    }
  }

  function getSessionStorage(key) {
    try {
      return sessionStorage.getItem(key);
    } catch(e) {
      warn('Erro ao ler sessionStorage:', key, e.message);
      return null;
    }
  }

  function setSessionStorage(key, value) {
    try {
      sessionStorage.setItem(key, value);
      return true;
    } catch(e) {
      warn('Erro ao setar sessionStorage:', key, e.message);
      return false;
    }
  }

  // ============================================
  // FUNÇÕES AUXILIARES
  // ============================================

  function getUrlParam(param) {
    try {
      var urlParams = new URLSearchParams(window.location.search);
      return urlParams.get(param);
    } catch(e) {
      return null;
    }
  }

  function generateId(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // ============================================
  // IDS DE RASTREAMENTO
  // ============================================

  function getVisitorId() {
    var visitorId;
    
    visitorId = getCookie('_visitor_id');
    if (visitorId) return visitorId;
    
    visitorId = getStorage('_visitor_id');
    if (visitorId) return visitorId;
    
    visitorId = generateId('vis');
    
    if (!setCookie('_visitor_id', visitorId, 365)) {
      setStorage('_visitor_id', visitorId);
    }
    
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
      if (!setCookie('_fbp', fbp, 90)) {
        setStorage('_fbp', fbp);
      }
    }
    
    return fbp;
  }

  function getFBC() {
    var fbc = getCookie('_fbc') || getStorage('_fbc');
    var fbclid = getUrlParam('fbclid');
    
    if (fbclid && !fbc) {
      fbc = 'fb.1.' + Date.now() + '.' + fbclid;
      if (!setCookie('_fbc', fbc, 90)) {
        setStorage('_fbc', fbc);
      }
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

    if (utms.utm_source || utms.utm_campaign) {
      setSessionStorage('_utms', JSON.stringify(utms));
    }

    var savedUtms = getSessionStorage('_utms');
    return savedUtms ? JSON.parse(savedUtms) : utms;
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
      if (eventData.hasOwnProperty(key)) {
        payload.event_data[key] = eventData[key];
      }
    }

    log('Enviando evento:', eventName);
    log('Payload:', JSON.stringify(payload, null, 2));

    fetch(config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      keepalive: true
    }).then(function(response) {
      if (response.ok) {
        log('Evento enviado com sucesso:', response.status);
        return response.json().catch(function() {
          return {success: true};
        });
      } else {
        warn('Erro ao enviar evento:', response.status, response.statusText);
        throw new Error('HTTP ' + response.status);
      }
    }).then(function(data) {
      log('Resposta do servidor:', data);
    }).catch(function(err) {
      warn('Erro ao enviar evento:', err.message);
    });
  }

  // ============================================
  // PAGEVIEW AUTOMÁTICO
  // ============================================

  function sendPageView() {
    trackEvent('PageView', {
      load_time: performance.now ? Math.round(performance.now()) : 0
    });
  }

  if (config.autoPageView !== false) {
    if (document.readyState === 'complete') {
      sendPageView();
    } else {
      window.addEventListener('load', sendPageView);
    }
  }

  // ============================================
  // FORMULÁRIOS AUTOMÁTICOS
  // ============================================

  if (config.autoFormTracking !== false) {
    document.addEventListener('submit', function(e) {
      var form = e.target;
      
      if (form.getAttribute('data-tracker-ignore')) {
        return;
      }

      var formData = new FormData(form);
      var leadData = {};
      
      var commonFields = ['name', 'nome', 'email', 'phone', 'telefone', 'message', 'mensagem'];
      commonFields.forEach(function(field) {
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
  }

  // ============================================
  // SCROLL TRACKING
  // ============================================

  if (config.autoScrollTracking !== false) {
    var scrollDepths = {
      '50': false,
      '75': false,
      '90': false
    };

    var scrollTimer = null;

    function calculateScrollDepth() {
      var windowHeight = window.innerHeight;
      var documentHeight = Math.max(
        document.body.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.clientHeight,
        document.documentElement.scrollHeight,
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
      
      scrollTimer = setTimeout(function() {
        var depth = calculateScrollDepth();
        
        if (depth >= 50 && !scrollDepths['50']) {
          scrollDepths['50'] = true;
          trackEvent('Scroll', {
            depth: 50,
            scroll_percentage: depth
          });
          log('Scroll marco atingido: 50%');
        }
        
        if (depth >= 75 && !scrollDepths['75']) {
          scrollDepths['75'] = true;
          trackEvent('Scroll', {
            depth: 75,
            scroll_percentage: depth
          });
          log('Scroll marco atingido: 75%');
        }
        
        if (depth >= 90 && !scrollDepths['90']) {
          scrollDepths['90'] = true;
          trackEvent('Scroll', {
            depth: 90,
            scroll_percentage: depth
          });
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
    version: '1.3.0',
    config: {
      cookiesEnabled: cookiesEnabled,
      storageEnabled: storageEnabled
    }
  };

  log('Tracker inicializado v1.3.0');
  log('Company:', config.companyId);
  log('Webhook:', config.webhookUrl);

})(window, document);