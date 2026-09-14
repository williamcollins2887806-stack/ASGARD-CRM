/**
 * Счета — обёртка единого зала «Счета и акты».
 */
window.AsgardInvoicesPage = {
  render(opts) {
    return AsgardBillingPage.render(Object.assign({}, opts || {}, { tab: 'invoices' }));
  }
};
