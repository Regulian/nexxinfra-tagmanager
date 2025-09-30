/**
 * Nexxinfra Tag Manager - Tracker v1.2.0
 * Atualizado: Usar apenas fetch (sem sendBeacon para evitar CORS)
 */
(function(window, document) {
  'use strict';

  // Configuração
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

  // Verificar se cookies estão disponíveis
  var cookiesEnabled = false;
  try {
    document.cookie = '_test=1';
    cookiesEnabled = document.cookie.indexOf('_test=1') !== -1;
    document.cookie = '_test=1; expires=Thu, 01 Jan 1970 00:00:01 GMT';
  } catch(e) {
    warn('Cookies bloqueados:', e.message);
  }

  // Verificar se localStorage está disponível
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

  // Funções auxiliares de cookie (com fallback)
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

  // Funções de localStorage (fallback para cookies)
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

  // Funções de sessionStorage
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

  // Pegar parâmetro da URL
  function getUrlParam(param) {
    try {
      var urlParams = new URLSearchParams(window.location.search);
      return urlParams.get(param);
    } catch(e) {
      return null;
    }
  }

  // Gerar ID único
  function generateId(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // Visitor ID (tenta cookie, depois localStorage, depois temporário)
  function getVisitorId() {
    var visitorId;
    
    // Tentar cookie primeiro
    visitorId = getCookie('_visitor_id');
    if (visitorId) return visitorId;
    
    // Tentar localStorage
    visitorId = getStorage('_visitor_id');
    if (visitorId) return visitorId;
    
    // Gerar novo
    visitorId = generateId('vis');
    
    // Tentar salvar (cookie primeiro, depois localStorage)
    if (!setCookie('_visitor_id', visitorId, 365)) {
      setStorage('_visitor_id', visitorId);
    }
    
    return visitorId;
  }

  // Session ID (sessionStorage ou temporário)
  function getSessionId() {
    var sessionId = getSessionStorage('_session_id');
    
    if (!sessionId) {
      sessionId = generateId('sess');
      setSessionStorage('_session_id', sessionId);
    }
    
    return sessionId;
  }

  // Facebook Pixel Browser ID
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

  // Facebook Click ID
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

  // Capturar UTMs
  function captureUTMs() {
    var utms = {
      utm_source: getUrlParam('utm_source'),
      utm_medium: getUrlParam('utm_medium'),
      utm_campaign: getUrlParam('utm_campaign'),
      utm_content: getUrlParam('utm_content'),
      utm_term: getUrlParam('utm_term')
    };

    // Salvar se tiver UTMs novos
    if (utms.utm_source || utms.utm_campaign) {
      setSessionStorage('_utms', JSON.stringify(utms));
    }

    // Retornar UTMs salvos ou da URL
    var savedUtms = getSessionStorage('_utms');
    return savedUtms ? JSON.parse(savedUtms) : utms;
  }

  // Enviar evento (APENAS FETCH)
  function trackEvent(eventName, eventData) {
    eventData = eventData || {};
    
    var utms = captureUTMs();
    
    var payload = {
      company_id: config.companyId,
      event_name: eventName,
      event_data: {
        // URL info
        page_url: window.location.href,
        page_title: document.title,
        referrer: document.referrer,
        
        // IDs de rastreamento
        visitor_id: getVisitorId(),
        session_id: getSessionId(),
        fbp: getFBP(),
        fbc: getFBC(),
        gclid: getUrlParam('gclid'),
        
        // UTMs
        utm_source: utms.utm_source,
        utm_medium: utms.utm_medium,
        utm_campaign: utms.utm_campaign,
        utm_content: utms.utm_content,
        utm_term: utms.utm_term,
        
        // Device info
        user_agent: navigator.userAgent,
        screen_resolution: screen.width + 'x' + screen.height,
        language: navigator.language,
        
        // Timestamp
        timestamp: new Date().toISOString()
      }
    };

    // Mesclar eventData customizado
    for (var key in eventData) {
      if (eventData.hasOwnProperty(key)) {
        payload.event_data[key] = eventData[key];
      }
    }

    log('Enviando evento:', eventName);
    log('Payload:', JSON.stringify(payload, null, 2));

    // Enviar usando APENAS fetch (sem sendBeacon para evitar problemas CORS)
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
          // Caso não seja JSON válido
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

  // PageView automático
  function sendPageView() {
    trackEvent('PageView', {
      load_time: performance.now ? Math.round(performance.now()) : 0
    });
  }

  // Aguardar carregamento
  if (config.autoPageView !== false) {
    if (document.readyState === 'complete') {
      sendPageView();
    } else {
      window.addEventListener('load', sendPageView);
    }
  }

  // Capturar formulários automaticamente
  if (config.autoFormTracking !== false) {
    document.addEventListener('submit', function(e) {
      var form = e.target;
      
      if (form.getAttribute('data-tracker-ignore')) {
        return;
      }

      var formData = new FormData(form);
      var leadData = {};
      
      // Campos comuns
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

  // API pública
  window.tracker = {
    track: trackEvent,
    getVisitorId: getVisitorId,
    getSessionId: getSessionId,
    version: '1.2.0',
    config: {
      cookiesEnabled: cookiesEnabled,
      storageEnabled: storageEnabled
    }
  };

  log('Tracker inicializado');
  log('Company:', config.companyId);
  log('Webhook:', config.webhookUrl);
  log('Version:', '1.2.0');

})(window, document);