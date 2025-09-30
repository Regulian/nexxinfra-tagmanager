/**
 * Landing Page Tracker v1.0.0
 */

(function(window, document) {
  'use strict';

  // ============================================
  // CONFIGURAÇÃO
  // ============================================
  
  const DEFAULT_CONFIG = {
    webhookUrl: null,
    companyId: null,
    debug: false,
    autoPageView: true,
    autoFormTracking: true,
    cookieDomain: null,
    cookieExpiry: 365
  };

  // Merge configuração do usuário
  window.TrackerConfig = window.TrackerConfig || {};
  const config = Object.assign({}, DEFAULT_CONFIG, window.TrackerConfig);

  // Validação
  if (!config.webhookUrl) {
    console.error('[Tracker] webhookUrl is required');
    return;
  }
  if (!config.companyId) {
    console.error('[Tracker] companyId is required');
    return;
  }

  // ============================================
  // FUNÇÕES AUXILIARES
  // ============================================
  
  function log() {
    if (config.debug) {
      console.log('[Tracker]', ...arguments);
    }
  }

  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
  }

  function setCookie(name, value, days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    const domain = config.cookieDomain ? `domain=${config.cookieDomain};` : '';
    document.cookie = `${name}=${value};expires=${date.toUTCString()};path=/;${domain}`;
  }

  function getUrlParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
  }

  function generateId(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  function getVisitorId() {
    let visitorId = getCookie('_visitor_id');
    if (!visitorId) {
      visitorId = generateId('vis');
      setCookie('_visitor_id', visitorId, config.cookieExpiry);
    }
    return visitorId;
  }

  function getSessionId() {
    let sessionId = sessionStorage.getItem('_session_id');
    if (!sessionId) {
      sessionId = generateId('sess');
      sessionStorage.setItem('_session_id', sessionId);
    }
    return sessionId;
  }

  function getFBP() {
    let fbp = getCookie('_fbp');
    if (!fbp) {
      fbp = 'fb.1.' + Date.now() + '.' + Math.random().toString(36).substr(2, 9);
      setCookie('_fbp', fbp, 90);
    }
    return fbp;
  }

  function getFBC() {
    let fbc = getCookie('_fbc');
    const fbclid = getUrlParam('fbclid');
    
    if (fbclid && !fbc) {
      fbc = 'fb.1.' + Date.now() + '.' + fbclid;
      setCookie('_fbc', fbc, 90);
    }
    
    return fbc;
  }

  function captureUTMs() {
    const utms = {
      utm_source: getUrlParam('utm_source'),
      utm_medium: getUrlParam('utm_medium'),
      utm_campaign: getUrlParam('utm_campaign'),
      utm_content: getUrlParam('utm_content'),
      utm_term: getUrlParam('utm_term')
    };

    if (utms.utm_source || utms.utm_campaign) {
      sessionStorage.setItem('_utms', JSON.stringify(utms));
    }

    const savedUtms = sessionStorage.getItem('_utms');
    return savedUtms ? JSON.parse(savedUtms) : utms;
  }

  // ============================================
  // ENVIAR EVENTO
  // ============================================
  
  function trackEvent(eventName, eventData) {
    eventData = eventData || {};
    
    const payload = {
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
        
        ...captureUTMs(),
        
        user_agent: navigator.userAgent,
        screen_resolution: `${screen.width}x${screen.height}`,
        language: navigator.language,
        
        timestamp: new Date().toISOString(),
        
        ...eventData
      }
    };

    log('Event:', eventName, payload);

    // Enviar
    if (navigator.sendBeacon) {
      // Usar sendBeacon se disponível (mais confiável)
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon(config.webhookUrl, blob);
    } else {
      // Fallback para fetch
      fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function(err) {
        log('Error:', err);
      });
    }
  }

  // ============================================
  // AUTO-TRACKING
  // ============================================
  
  // PageView automático
  if (config.autoPageView) {
    if (document.readyState === 'complete') {
      trackEvent('PageView', { load_time: performance.now() });
    } else {
      window.addEventListener('load', function() {
        trackEvent('PageView', { load_time: performance.now() });
      });
    }
  }

  // Formulários automáticos
  if (config.autoFormTracking) {
    document.addEventListener('submit', function(e) {
      const form = e.target;
      if (!form.hasAttribute('data-tracker-ignore')) {
        const formData = new FormData(form);
        const leadData = {};
        
        // Capturar campos comuns
        ['name', 'nome', 'email', 'phone', 'telefone', 'message', 'mensagem'].forEach(function(field) {
          if (formData.has(field)) {
            leadData[field] = formData.get(field);
          }
        });

        trackEvent('Lead', {
          form_data: leadData,
          form_id: form.id || 'unknown',
          form_action: form.action
        });
      }
    }, true);
  }

  // ============================================
  // API PÚBLICA
  // ============================================
  
  window.tracker = {
    track: trackEvent,
    getVisitorId: getVisitorId,
    getSessionId: getSessionId,
    version: '1.0.0'
  };

  log('Initialized for company:', config.companyId);

})(window, document);