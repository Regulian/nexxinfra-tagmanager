<script>
  window.TrackerConfig = {
    webhookUrl: 'https://primary-production-c3b48.up.railway.app/webhook/api/events',
    companyId: 'uuid-empresa-teste',
    includeAllFieldsOnLead: true,
    includeCheckboxRadioOnLead: true,
    includeUncheckedAsFalse: true,   // se quiser ver "false" p/ não marcados
    // includeDisabledOrHidden: true, // use se campos estiverem desabilitados/hidden no submit
    debug: true,                      // para ver FormSchema e FormDebugSummary
    emitFormDebugSummary: true
  };
</script>
<script src="https://nexxinfra-tagmanager-production.up.railway.app/tracker.js?v=1.7.2"></script>
