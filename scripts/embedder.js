<script>
  window.TrackerConfig = {
    webhookUrl: 'https://primary-production-c3b48.up.railway.app/webhook/api/events',
    companyId: 'uuid-empresa-teste',
    includeAllFieldsOnLead: true,
    includeTrackedValuesOnLead: true,   // <- novo (default já é true)
    // Recomendado se o site desabilita/oculta inputs durante submit:
    includeDisabledOrHidden: true,
    // Opcional:
    includeCheckboxRadioOnLead: true,
    includeUncheckedAsFalse: true,
    debug: true,
    emitFormDebugSummary: true
  };
</script>
<script src="https://nexxinfra-tagmanager-production.up.railway.app/tracker.js?v=1.7.3"></script>
