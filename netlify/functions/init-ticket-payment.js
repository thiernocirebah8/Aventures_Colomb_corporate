/**
 * netlify/functions/init-ticket-payment.js
 *
 * Appelée par index.html (submitTicket) juste avant la redirection vers CinetPay.
 * 1) Crée la ligne "En attente" dans la feuille Tickets (via Apps Script)
 * 2) Initie le paiement CinetPay (Orange Money Guinée + autres mobile money)
 * 3) Renvoie l'URL du guichet de paiement au navigateur
 *
 * Variables d'environnement Netlify à définir :
 *   CINETPAY_API_KEY
 *   CINETPAY_SITE_ID
 *   SITE_URL          -> ex: https://aventurescolomb.com
 *   APPS_SCRIPT_URL   -> l'URL /exec de ton Code.gs (même que GOOGLE_SHEETS_URL dans index.html)
 */

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Méthode non autorisée' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Requête invalide' }) }; }

  const { ref, transactionId, dateEnvoi, evenement, eventId, site, quantite, total, prenom, nom, tel, email } = body;

  if (!ref || !transactionId || !evenement || !total || total <= 0) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Informations de billet incomplètes' }) };
  }

  // 1) Ligne "En attente" côté Google Sheets (feuille Tickets)
  const pendingRes = await fetch(process.env.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      type: 'ticket-pending',
      ref, transactionId, dateEnvoi, evenement, eventId, site, quantite, total, prenom, nom, tel, email
    })
  });
  const pendingData = await pendingRes.json();
  if (!pendingData.ok) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Impossible de préparer le billet' }) };
  }

  // 2) Initialisation du paiement CinetPay
  const cpRes = await fetch('https://api-checkout.cinetpay.com/v2/payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apikey: process.env.CINETPAY_API_KEY,
      site_id: process.env.CINETPAY_SITE_ID,
      transaction_id: transactionId,
      amount: total,
      currency: 'GNF',
      description: `Billet ${evenement} - Aventures Colomb`,
      notify_url: `${process.env.SITE_URL}/.netlify/functions/notify-payment`,
      return_url: `${process.env.SITE_URL}/?paiement=merci&ref=${encodeURIComponent(ref)}`,
      channels: 'MOBILE_MONEY',
      customer_name: nom || 'Client',
      customer_surname: prenom || '',
      customer_email: email || 'client@aventurescolomb.com',
      customer_phone_number: tel
    })
  });
  const cpData = await cpRes.json();

  if (String(cpData.code) !== '201') {
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: cpData.message || 'Échec du paiement' }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, paymentUrl: cpData.data.payment_url }) };
};
