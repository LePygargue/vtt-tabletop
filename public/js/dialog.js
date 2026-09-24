'use strict';
/**
 * Boîte de confirmation aux couleurs du site, en remplacement de window.confirm().
 * Autonome (utilisée par le salon et l'accueil) : repose sur <dialog>, qui gère
 * le focus, la touche Échap et l'affichage au-dessus de tout le reste.
 *
 *   if (!(await confirmDialog({ title: 'Supprimer ?', message: '…', confirmLabel: 'Supprimer', danger: true }))) return;
 */
let confirmDialogPending = null;

function confirmDialog({ title = 'Confirmer', message = '', confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false } = {}) {
  // une seule boîte à la fois : une nouvelle demande annule la précédente
  if (confirmDialogPending) confirmDialogPending(false);

  const dlg = document.createElement('dialog');
  dlg.className = 'confirm-dialog';
  const h = document.createElement('h2');
  h.textContent = title;
  const body = document.createElement('div');
  body.className = 'confirm-body';
  for (const para of String(message).split(/\n\s*\n/)) {
    const p = document.createElement('p');
    p.textContent = para;
    body.appendChild(p);
  }
  const actions = document.createElement('div');
  actions.className = 'row confirm-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = cancelLabel;
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = danger ? 'danger-solid' : 'primary';
  ok.textContent = confirmLabel;
  actions.append(cancel, ok);
  // contenu dans une carte interne : un clic dont la cible est le <dialog> lui-même vient du fond
  const card = document.createElement('div');
  card.className = 'confirm-card';
  card.append(h, body, actions);
  dlg.appendChild(card);
  document.body.appendChild(dlg);

  return new Promise((resolve) => {
    const finish = (value) => {
      if (confirmDialogPending !== finish) return;
      confirmDialogPending = null;
      if (dlg.open) dlg.close();
      dlg.remove();
      resolve(value);
    };
    confirmDialogPending = finish;
    cancel.addEventListener('click', () => finish(false));
    ok.addEventListener('click', () => finish(true));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); }); // Échap
    // clic sur le fond (hors de la boîte) = annuler
    dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) finish(false); });
    dlg.showModal();
    // focus sur « Annuler » pour une action destructrice, sinon sur la confirmation
    (danger ? cancel : ok).focus();
  });
}
