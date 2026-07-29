Fonction Netlify — vérification sécurisée du mot de passe administrateur
// Le mot de passe n'est JAMAIS stocké ici ni envoyé au navigateur : il vit uniquement
// dans une variable d'environnement Netlify (Site settings → Environment variables → ADMIN_PASSWORD)

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Méthode non autorisée' }) };
  }

  try {
    const { password } = JSON.parse(event.body || '{}');
    const realPassword = process.env.ADMIN_PASSWORD;

    if (!realPassword) {
      // La variable d'environnement n'a pas encore été configurée sur Netlify
      return {
        statusCode: 200,
        body: JSON.stringify({ valid: false, configured: false })
      };
    }

    const valid = password === realPassword;
    return {
      statusCode: 200,
      body: JSON.stringify({ valid, configured: true })
    };
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Requête invalide' }) };
  }
};
