/**
 * Акты — обёртка единого зала «Счета и акты».
 */
window.AsgardActsPage = {
  render(opts) {
    return AsgardBillingPage.render(Object.assign({}, opts || {}, { tab: 'acts' }));
  }
};
