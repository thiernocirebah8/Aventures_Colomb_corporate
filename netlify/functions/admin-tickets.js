/**
 * netlify/functions/admin-tickets.js
 *
 * Point d'entrée unique et sécurisé pour toutes les actions admin liées à
 * la billetterie (créer/modifier/supprimer un événement, gérer les
 * catégories de billets, lister les billets vendus, vérifier un code à
 * l'entrée). Utilise la clé secrète Supabase (service_role) — jamais
 * exposée au navigateur — et vérifie le mot de passe admin à chaque appel.
 *
 * Variables d'environnement Netlify à définir :
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ADMIN_PASSWORD   -> même mot de passe que celui utilisé pour la connexion admin
 */

const SUPABASE_HEADERS = {
  'Content-Type': 'application/json',
  'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
};

function sbUrl(path){ return `${process.env.SUPABASE_URL}/rest/v1/${path}`; }
function sbRpcUrl(fn){ return `${process.env.SUPABASE_URL}/rest/v1/rpc/${fn}`; }

function ok(data){ return { statusCode: 200, body: JSON.stringify({ ok: true, ...data }) }; }
function fail(statusCode, error){ return { statusCode, body: JSON.stringify({ ok: false, error }) }; }
function generatePartnerCode(){
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for(let i=0;i<8;i++){ code += chars[Math.floor(Math.random()*chars.length)]; }
  return code;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return fail(405, 'Méthode non autorisée');

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return fail(400, 'Requête invalide'); }

  const { action, password } = body;

  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return fail(401, 'Mot de passe administrateur invalide.');
  }

  try{
    switch (action){

      case 'listEvents': {
        const evRes = await fetch(sbUrl('events?select=*,ticket_tiers(*)&order=created_at.desc'), { headers: SUPABASE_HEADERS });
        if(!evRes.ok) return fail(500, "Impossible de charger les événements.");
        const rows = await evRes.json();

        // Revenu payé par événement, pour calculer la part à reverser aux partenaires.
        const paidRes = await fetch(sbUrl('tickets?paiement=eq.Payé&select=event_id,total'), { headers: SUPABASE_HEADERS });
        const paidRows = paidRes.ok ? await paidRes.json() : [];
        const revenueByEvent = {};
        for(const t of paidRows){ revenueByEvent[t.event_id] = (revenueByEvent[t.event_id]||0) + (t.total||0); }

        const events = rows.map(r => {
          const revenuPaye = revenueByEvent[r.id] || 0;
          const commissionPct = r.partner_commission_percent || 0;
          const partPartenaire = r.partner_orange_number ? Math.round(revenuPaye * (1 - commissionPct/100)) : null;
          return {
            id: r.id, name: r.name, lieu: r.lieu || '', date: r.event_date || '', heure: r.heure ? String(r.heure).slice(0,5) : '',
            description: r.description || '', photo: r.photo || null,
            partnerName: r.partner_name || '', partnerOrangeNumber: r.partner_orange_number || '', partnerCommissionPercent: commissionPct,
            partnerAccessCode: r.partner_access_code || '',
            revenuPaye, partPartenaire,
            tiers: (r.ticket_tiers||[]).map(t => ({ id:t.id, name:t.name, price:t.price, total:t.total, sold:t.sold }))
          };
        });
        return ok({ events });
      }

      case 'createEvent': {
        const { id, name, lieu, date, heure, description, photo, tiers, partnerName, partnerOrangeNumber, partnerCommissionPercent } = body;
        const evRes = await fetch(sbUrl('events'), {
          method: 'POST',
          headers: { ...SUPABASE_HEADERS, 'Prefer': 'return=representation' },
          body: JSON.stringify([{
            id, name, lieu: lieu||null, event_date: date||null, heure: heure||null, description: description||'', photo: photo||null,
            partner_name: partnerName || null, partner_orange_number: partnerOrangeNumber || null,
            partner_commission_percent: partnerCommissionPercent || 0,
            partner_access_code: generatePartnerCode()
          }])
        });
        if(!evRes.ok) return fail(500, "Impossible de créer l'événement.");

        if(Array.isArray(tiers) && tiers.length){
          const tiersRes = await fetch(sbUrl('ticket_tiers'), {
            method: 'POST',
            headers: SUPABASE_HEADERS,
            body: JSON.stringify(tiers.map(t => ({ id:t.id, event_id:id, name:t.name, price:t.price||0, total:t.total||0, sold:0 })))
          });
          if(!tiersRes.ok) return fail(500, "Événement créé, mais erreur sur les catégories de billets.");
        }
        return ok({ eventId: id });
      }

      case 'updateEvent': {
        const { eventId, name, lieu, date, heure, description, tiers, partnerName, partnerOrangeNumber, partnerCommissionPercent } = body;
        const evRes = await fetch(sbUrl(`events?id=eq.${encodeURIComponent(eventId)}`), {
          method: 'PATCH',
          headers: SUPABASE_HEADERS,
          body: JSON.stringify({
            name, lieu: lieu||null, event_date: date||null, heure: heure||null, description: description||'',
            partner_name: partnerName || null, partner_orange_number: partnerOrangeNumber || null,
            partner_commission_percent: partnerCommissionPercent || 0
          })
        });
        if(!evRes.ok) return fail(500, "Impossible de mettre à jour l'événement.");

        if(Array.isArray(tiers)){
          // Catégories existantes en base pour cet événement
          const existingRes = await fetch(sbUrl(`ticket_tiers?event_id=eq.${encodeURIComponent(eventId)}&select=id`), { headers: SUPABASE_HEADERS });
          const existing = existingRes.ok ? await existingRes.json() : [];
          const existingIds = existing.map(t=>t.id);
          const incomingIds = tiers.map(t=>t.id);

          // Upsert (insère les nouvelles, met à jour les existantes — sans jamais toucher "sold")
          for(const t of tiers){
            if(existingIds.includes(t.id)){
              await fetch(sbUrl(`ticket_tiers?id=eq.${encodeURIComponent(t.id)}`), {
                method: 'PATCH', headers: SUPABASE_HEADERS,
                body: JSON.stringify({ name:t.name, price:t.price||0, total:t.total||0 })
              });
            } else {
              await fetch(sbUrl('ticket_tiers'), {
                method: 'POST', headers: SUPABASE_HEADERS,
                body: JSON.stringify([{ id:t.id, event_id:eventId, name:t.name, price:t.price||0, total:t.total||0, sold:0 }])
              });
            }
          }
          // Supprime les catégories retirées côté admin (si aucun billet vendu dessus)
          const removedIds = existingIds.filter(id => !incomingIds.includes(id));
          const skipped = [];
          for(const rid of removedIds){
            const delRes = await fetch(sbUrl(`ticket_tiers?id=eq.${encodeURIComponent(rid)}`), { method:'DELETE', headers: SUPABASE_HEADERS });
            if(!delRes.ok) skipped.push(rid);
          }
          if(skipped.length){
            return ok({ warning: `${skipped.length} catégorie(s) non supprimée(s) car des billets ont déjà été vendus dessus.` });
          }
        }
        return ok({});
      }

      case 'deleteEvent': {
        const { eventId } = body;
        const delRes = await fetch(sbUrl(`events?id=eq.${encodeURIComponent(eventId)}`), { method:'DELETE', headers: SUPABASE_HEADERS });
        if(!delRes.ok){
          return fail(409, "Impossible de supprimer : des billets ont déjà été vendus pour cet événement.");
        }
        return ok({});
      }

      case 'uploadEventPhoto': {
        const { eventId, photo } = body;
        const res = await fetch(sbUrl(`events?id=eq.${encodeURIComponent(eventId)}`), {
          method: 'PATCH', headers: SUPABASE_HEADERS, body: JSON.stringify({ photo })
        });
        if(!res.ok) return fail(500, "Erreur lors de l'enregistrement de la photo.");
        return ok({});
      }

      case 'listTickets': {
        const res = await fetch(sbUrl('tickets?select=*,events(name),ticket_tiers(name)&order=created_at.desc'), { headers: SUPABASE_HEADERS });
        if(!res.ok) return fail(500, 'Impossible de charger les billets.');
        const rows = await res.json();
        const tickets = rows.map(r => ({
          id:r.id, ref:r.ref, code:r.code, used:r.used, usedAt:r.used_at,
          eventName:r.events?.name || '', typeBillet:r.ticket_tiers?.name || '',
          prenom:r.prenom, nom:r.nom, tel:r.tel, email:r.email,
          quantite:r.quantite, total:r.total, date:r.created_at,
          traite:r.traite, paiement:r.paiement
        }));
        return ok({ tickets });
      }

      case 'markTicketTraite': {
        const { ticketId } = body;
        const res = await fetch(sbUrl(`tickets?id=eq.${encodeURIComponent(ticketId)}`), {
          method: 'PATCH', headers: SUPABASE_HEADERS, body: JSON.stringify({ traite: true })
        });
        if(!res.ok) return fail(500, 'Erreur.');
        return ok({});
      }

      case 'deleteTicket': {
        const { ticketId } = body;
        const res = await fetch(sbUrl(`tickets?id=eq.${encodeURIComponent(ticketId)}`), { method:'DELETE', headers: SUPABASE_HEADERS });
        if(!res.ok) return fail(500, 'Erreur.');
        return ok({});
      }

      case 'checkEntryCode': {
        const { code } = body;
        const res = await fetch(sbUrl(`tickets?code=eq.${encodeURIComponent((code||'').toUpperCase())}&select=*,events(name)`), { headers: SUPABASE_HEADERS });
        if(!res.ok) return fail(500, 'Erreur de vérification.');
        const rows = await res.json();
        const ticket = rows[0];
        if(!ticket) return fail(404, `Code invalide — aucun billet ne correspond à "${code}".`);
        if(ticket.used){
          const usedDate = ticket.used_at ? new Date(ticket.used_at).toLocaleString('fr-FR') : '';
          return fail(409, `Code déjà utilisé — ${ticket.prenom} ${ticket.nom}, entré le ${usedDate}.`);
        }
        await fetch(sbUrl(`tickets?id=eq.${encodeURIComponent(ticket.id)}`), {
          method: 'PATCH', headers: SUPABASE_HEADERS,
          body: JSON.stringify({ used: true, used_at: new Date().toISOString() })
        });
        return ok({ ticket: { prenom:ticket.prenom, nom:ticket.nom, quantite:ticket.quantite, eventName: ticket.events?.name || '' } });
      }

      case 'regeneratePartnerCode': {
        const { eventId } = body;
        const newCode = generatePartnerCode();
        const res = await fetch(sbUrl(`events?id=eq.${encodeURIComponent(eventId)}`), {
          method: 'PATCH', headers: SUPABASE_HEADERS, body: JSON.stringify({ partner_access_code: newCode })
        });
        if(!res.ok) return fail(500, 'Erreur lors de la régénération du code.');
        return ok({ partnerAccessCode: newCode });
      }

      default:
        return fail(400, 'Action inconnue.');
    }
  }catch(e){
    console.error('admin-tickets error', e);
    return fail(500, 'Erreur serveur inattendue.');
  }
};
