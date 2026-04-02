/** @odoo-module **/

// Odoo 18 payment form is a legacy publicWidget (not an OWL component).
// It is exported as the DEFAULT export of the module and must be extended
// with the legacy .include() mixin, not with @web/core/utils/patch.
import PaymentForm from '@payment/js/payment_form';
import { _t } from '@web/core/l10n/translation';

PaymentForm.include({

    // -------------------------------------------------------------------------
    // Override: force redirect flow so Odoo fetches the challenge URL from the
    // server before we intercept it to show in an iframe.
    // -------------------------------------------------------------------------

    async _prepareInlineForm(providerId, providerCode, paymentOptionId, paymentMethodCode, flow) {
        if (providerCode !== 'jetframe') {
            return this._super(...arguments);
        }
        if (flow !== 'token') {
            this._setPaymentFlow('redirect');
        }
    },

    // -------------------------------------------------------------------------
    // Override: instead of submitting the redirect form (full-page navigation),
    // extract the Paycomet challenge URL and open it inside an iframe overlay.
    // -------------------------------------------------------------------------

    _processRedirectFlow(providerCode, paymentOptionId, paymentMethodCode, processingValues) {
        if (providerCode !== 'jetframe') {
            return this._super(...arguments);
        }

        // Odoo renders the `redirect_form` template server-side and passes the
        // HTML in processingValues.redirect_form_html.  The form's `action`
        // attribute is the Paycomet challenge URL.
        const div = document.createElement('div');
        div.innerHTML = processingValues['redirect_form_html'] || '';
        const form = div.querySelector('form');
        const challengeUrl = form ? form.getAttribute('action') : null;

        if (challengeUrl) {
            this._jetframeShowIframe(challengeUrl);
        } else {
            // Safety fallback: let Odoo do the full-page redirect
            this._super(...arguments);
        }
    },

    // -------------------------------------------------------------------------
    // Show the Paycomet hosted form inside an iframe overlay on the same page.
    // -------------------------------------------------------------------------

    _jetframeShowIframe(url) {
        // Remove any leftover overlay from a previous attempt
        document.getElementById('o_jetframe_overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'o_jetframe_overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', _t('Pago seguro'));

        overlay.innerHTML = `
            <div class="o_jetframe_container">
                <div class="o_jetframe_header">
                    <div class="o_jetframe_title">
                        <svg class="o_jetframe_lock" xmlns="http://www.w3.org/2000/svg"
                             width="14" height="14" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2.5"
                             stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                        <span>${_t('Pago seguro — Paycomet')}</span>
                    </div>
                    <button class="o_jetframe_close" type="button"
                            aria-label="${_t('Cerrar')}">&#x2715;</button>
                </div>
                <div class="o_jetframe_body">
                    <div class="o_jetframe_loading" id="o_jetframe_loading">
                        <div class="o_jetframe_spinner"></div>
                        <span>${_t('Cargando formulario de pago...')}</span>
                    </div>
                    <iframe
                        id="o_jetframe_iframe"
                        src="${url}"
                        title="${_t('Formulario de pago seguro de Paycomet')}"
                        allow="payment"
                        style="display:none"
                    ></iframe>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const iframe = overlay.querySelector('#o_jetframe_iframe');
        const loading = overlay.querySelector('#o_jetframe_loading');

        // Hide the spinner once the first page of the iframe has loaded
        iframe.addEventListener('load', () => {
            loading.style.display = 'none';
            iframe.style.display = 'block';
        }, { once: true });

        // Close button — re-enable the Pay button so the user can retry
        const self = this;
        overlay.querySelector('.o_jetframe_close').addEventListener('click', () => {
            overlay.remove();
            self._enableButton();
        });

        // Backdrop click also closes
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
                self._enableButton();
            }
        });

        // Escape key closes
        const handleKey = (e) => {
            if (e.key === 'Escape') {
                overlay.remove();
                self._enableButton();
                document.removeEventListener('keydown', handleKey);
            }
        };
        document.addEventListener('keydown', handleKey);
    },
});
