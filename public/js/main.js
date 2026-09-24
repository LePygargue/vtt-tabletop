'use strict';
/**
 * Démarrage : mise en place de la vue, boucle de rendu, connexion.
 * Dernier fichier chargé : tout ce dont il dépend est déjà défini.
 */
initViewport();
syncTopbarHeight(); // cf. help.js
window.addEventListener('resize', () => resizeViewport(viewport));
if (innerWidth < 700) { document.body.classList.add('panel-closed'); document.body.classList.add('dice-closed'); }

$('btnLogout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/login';
});

$('btnHome').addEventListener('click', () => {
  location.href = '/';
});

connect();
