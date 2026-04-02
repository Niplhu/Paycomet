import logging

from odoo import _, http
from odoo.http import request

_logger = logging.getLogger(__name__)

# Minimal HTML page returned to the iframe after Paycomet redirects to urlOk/urlKo.
# If loaded inside an iframe it breaks out to the parent window; otherwise it
# redirects the current window directly.
_IFRAME_BREAKOUT_HTML = """\
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>Procesando pago...</title>
    <style>
        body {{ font-family: system-ui, sans-serif; display: flex;
               align-items: center; justify-content: center;
               min-height: 100vh; margin: 0; background: #f8f9fa; }}
        p {{ color: #6c757d; font-size: .9rem; }}
    </style>
</head>
<body>
    <p>Procesando, por favor espere&hellip;</p>
    <script>
        var dest = {dest!r};
        try {{
            if (window !== window.top) {{
                window.top.location.href = dest;
            }} else {{
                window.location.href = dest;
            }}
        }} catch (e) {{
            window.location.href = dest;
        }}
    </script>
</body>
</html>"""


class PaycometJetController(http.Controller):

    @http.route(
        '/payment/jetframe/return',
        type='http',
        auth='public',
        methods=['GET', 'POST'],
        csrf=False,
        save_session=False,
    )
    def jetframe_return(self, **data):
        """
        Handle the browser return from Paycomet after the hosted form is
        completed (urlOk / urlKo).  This URL is loaded inside our iframe
        overlay, so we respond with an HTML page that navigates the *parent*
        window to /payment/status rather than performing a plain HTTP redirect
        (which would stay inside the iframe).
        """
        _logger.info(
            "Paycomet JET return: reference=%s status=%s full_data=%s",
            data.get('reference'),
            data.get('status'),
            data,
        )

        try:
            request.env['payment.transaction'].sudo()._handle_notification_data(
                'jetframe', dict(data)
            )
        except Exception:
            _logger.exception(
                "Paycomet JET: return processing failed – reference=%s order=%s",
                data.get('reference'),
                data.get('order'),
            )

        # Return an HTML page that breaks out of the iframe and navigates the
        # parent (or current window) to the payment status page.
        html = _IFRAME_BREAKOUT_HTML.format(dest='/payment/status')
        return request.make_response(
            html,
            headers=[('Content-Type', 'text/html; charset=utf-8')],
        )

    @http.route(
        '/payment/jetframe/notify',
        type='http',
        auth='public',
        methods=['POST'],
        csrf=False,
        save_session=False,
    )
    def jetframe_notify(self, **data):
        """
        Server-to-server (IPN/webhook) notification from Paycomet.

        Paycomet POSTs here when a payment status changes asynchronously
        (e.g. after the browser has already been redirected).  This endpoint
        ensures the transaction is updated even if the user never returns to
        the shop.

        The urlNotification is set in _jetframe_get_form_challenge_url.
        """
        _logger.info(
            "Paycomet JET notify (S2S): full_data=%s",
            data,
        )

        # Paycomet sends Order and Response (OK/KO) in the POST body.
        # Normalise to the internal keys used by _process_notification_data.
        notification = dict(data)

        # Map Paycomet's IPN fields to our internal convention when needed.
        if 'Order' in notification and 'order' not in notification:
            notification['order'] = notification['Order']
        if 'Response' in notification and 'status' not in notification:
            response_val = (notification['Response'] or '').strip().lower()
            notification['status'] = 'ok' if response_val == 'ok' else 'ko'
        if 'ErrorCode' in notification and 'errorCode' not in notification:
            notification['errorCode'] = notification['ErrorCode']

        try:
            request.env['payment.transaction'].sudo()._handle_notification_data(
                'jetframe', notification
            )
        except Exception:
            _logger.exception(
                "Paycomet JET: S2S notification processing failed – data=%s",
                notification,
            )

        # Paycomet expects a 200 OK response
        return request.make_response(
            'OK',
            headers=[('Content-Type', 'text/plain')],
        )
