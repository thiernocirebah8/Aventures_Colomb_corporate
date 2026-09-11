/**
 * netlify/functions/notify-payment.js
 *
 * URL de notification (notify_url) appelée par CinetPay après un paiement.
 * ⚠️ On revérifie toujours le statut réel auprès de CinetPay avant d'agir —
 * ne jamais faire confiance à la notification seule (recommandation officielle
 * CinetPay contre les attaques "man in the middle"). Cette partie est inchangée.
 *
 * Ce qui change : la confirmation / l'échec du billet et la génération du code
 * d'entrée se font maintenant dans SUPABASE (plus par Apps Script), via les
 * fonctions SQL "confirm_ticket_payment" et "fail_ticket_payment".
 *
 * Variables d'environnement Netlify à définir (en plus de celles déjà en place) :
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   EMAILJS_SERVICE_ID / EMAILJS_TEMPLATE_ID / EMAILJS_PUBLIC_KEY
 *     -> mêmes valeurs que dans index.html. Va dans ton compte EmailJS ->
 *        Account -> Security -> active "Allow non-browser requests" pour que
 *        cet envoi serveur-à-serveur soit accepté.
 */

const SUPABASE_HEADERS = {
  'Content-Type': 'application/json',
  'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Méthode non autorisée' };
  }

  let transactionId;
  try {
    const params = new URLSearchParams(event.body);
    transactionId = params.get('cpm_trans_id') || JSON.parse(event.body).transaction_id;
  } catch (e) {
    return { statusCode: 400, body: 'Corps de requête invalide' };
  }
  if (!transactionId) return { statusCode: 400, body: 'transaction_id manquant' };

  // Revérification obligatoire du statut auprès de CinetPay (inchangé)
  const checkRes = await fetch('https://api-checkout.cinetpay.com/v2/payment/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apikey: process.env.CINETPAY_API_KEY,
      site_id: process.env.CINETPAY_SITE_ID,
      transaction_id: transactionId
    })
  });
  const checkData = await checkRes.json();
  const status = checkData?.data?.status; // 'ACCEPTED' | 'REFUSED' | 'WAITING_FOR_CUSTOMER' ...

  if (status === 'WAITING_FOR_CUSTOMER') {
    // Paiement mobile money en attente de confirmation côté client (push USSD) :
    // CinetPay renverra une nouvelle notification une fois résolu.
    // Le billet reste réservé (stock non relâché) en attendant.
    return { statusCode: 200, body: 'OK - en attente de confirmation client' };
  }

  if (status !== 'ACCEPTED') {
    // Paiement refusé/annulé : on libère le billet réservé pour remettre le
    // stock à disposition des autres acheteurs.
    try {
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/fail_ticket_payment`, {
        method: 'POST',
        headers: SUPABASE_HEADERS,
        body: JSON.stringify({ p_transaction_id: transactionId })
      });
    } catch (e) {
      console.error('Échec libération du billet après paiement refusé', e);
    }
    return { statusCode: 200, body: 'OK - paiement non accepté' };
  }

  // Paiement confirmé -> Supabase génère le code d'entrée et marque le billet payé.
  let confirmData;
  try {
    const confirmRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/confirm_ticket_payment`, {
      method: 'POST',
      headers: SUPABASE_HEADERS,
      body: JSON.stringify({ p_transaction_id: transactionId })
    });
    confirmData = await confirmRes.json();
  } catch (e) {
    console.error('Échec finalisation billet (Supabase)', e);
    return { statusCode: 500, body: 'Erreur finalisation' };
  }

  if (!confirmData || !confirmData.ok) {
    console.error('Échec finalisation billet', confirmData);
    return { statusCode: 500, body: 'Erreur finalisation' };
  }

  // Récupère les infos du billet pour l'e-mail de confirmation.
  try {
    const ticketRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/tickets?transaction_id=eq.${encodeURIComponent(transactionId)}&select=*,events(name,lieu,event_date,heure)`,
      { headers: SUPABASE_HEADERS }
    );
    const ticketRows = await ticketRes.json();
    const ticket = Array.isArray(ticketRows) ? ticketRows[0] : null;

    if (ticket && ticket.email && process.env.EMAILJS_SERVICE_ID) {
      const eventName = ticket.events?.name || 'ton événement';
      const message =
`Bonjour ${ticket.prenom || ''},

Ton billet pour "${eventName}" est confirmé !

Référence : ${ticket.ref}
Code d'entrée : ${ticket.code}
Quantité : ${ticket.quantite}

Présente ce code à l'entrée le jour J.

À bientôt !
Aventures Colomb`;

      await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: process.env.EMAILJS_SERVICE_ID,
          template_id: process.env.EMAILJS_TEMPLATE_ID,
          user_id: process.env.EMAILJS_PUBLIC_KEY,
          template_params: {
            subject: `Ton billet — ${eventName}`,
            message,
            to_email: ticket.email,
            client_email: ticket.email,
            client_name: `${ticket.prenom || ''} ${ticket.nom || ''}`.trim()
          }
        })
      });
    }
  } catch (e) {
    // L'email est un "bonus" — un échec d'envoi ne doit pas faire échouer la
    // confirmation du billet, qui est déjà actée côté Supabase à ce stade.
    console.error('Échec envoi email e-billet', e);
  }

  return { statusCode: 200, body: 'OK' };
};
