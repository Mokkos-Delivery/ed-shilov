/* Public settings only. Never put passwords, private tokens or payment secrets here. */
window.SITE_CONFIG = Object.freeze({
  privacyReviewed: false, // Complete owner/hosting/retention details before enabling external services.
  metrikaId: null,
  supportUrl: '', // Confirmed HTTPS payment page. No button appears until configured.
  ads: {
    enabled: false,
    rsya: { catalogue: '', news: '' }, // Real R-A-... unit IDs after approval.
    partners: [] // {slot:'news', title:'...', image:'/...', url:'https://...', advertiser:'...', erid:'...', from:'YYYY-MM-DD', until:'YYYY-MM-DD'}
  }
});
