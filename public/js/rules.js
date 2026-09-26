'use strict';
/**
 * Livre de règles du jeu du salon (PDF servi par /rules/<jeu>.pdf, réservé aux comptes
 * connectés), lu avec PDF.js (public/vendor/pdfjs, Mozilla, licence Apache 2.0) :
 * le document est chargé par morceaux (requêtes Range) au fil des pages consultées,
 * au lieu de télécharger d'abord tout le livre. Barre d'outils aux couleurs du thème :
 * sommaire, page, zoom, recherche. La dernière page lue est mémorisée par jeu.
 */
const PDFJS = '/vendor/pdfjs/';
const RULES_PAGE_KEY = 'plateau.rulesPage.';
const rulesUrl = () => `/rules/${game.id}.pdf`;
let rulesReader = null; // { gameId, viewer, eventBus, linkService, doc } une fois le livre ouvert
let rulesLoading = null; // promesse d'ouverture en cours

/** Bouton visible seulement si un PDF existe pour ce jeu (champ `rules` de l'état). */
function setupRules(available) {
  $('btnRules').hidden = !available;
  if (!available) { $('rulesPanel').hidden = true; return; }
  $('rulesTitle').textContent = 'Règles — ' + game.label;
  $('rulesNewTab').href = rulesUrl();
}

/** Charge PDF.js une seule fois (modules ES importés à la demande : rien n'est chargé tant qu'on n'ouvre pas les règles). */
async function loadPdfJs() {
  if (!globalThis.pdfjsLib) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = PDFJS + 'pdf_viewer.css';
    document.head.appendChild(css);
    globalThis.pdfjsLib = await import(PDFJS + 'pdf.min.mjs'); // pdf_viewer.mjs le lit sur globalThis
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
  }
  return import(PDFJS + 'pdf_viewer.mjs');
}

function rulesStatus(text) {
  $('rulesStatus').textContent = text || '';
  $('rulesStatus').hidden = !text;
}

async function openRulesBook() {
  if (rulesReader && rulesReader.gameId === game.id) return rulesReader;
  if (rulesLoading) return rulesLoading;
  rulesLoading = (async () => {
    rulesStatus('Chargement du lecteur…');
    const { EventBus, PDFLinkService, PDFFindController, PDFViewer, FindState } = await loadPdfJs();
    const gameId = game.id;
    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const findController = new PDFFindController({ eventBus, linkService });
    $('rulesViewer').textContent = '';
    const viewer = new PDFViewer({
      container: $('rulesViewerContainer'),
      viewer: $('rulesViewer'),
      eventBus,
      linkService,
      findController,
    });
    linkService.setViewer(viewer);

    eventBus.on('pagesinit', () => {
      viewer.currentScaleValue = 'page-width';
      let saved = 0;
      try { saved = parseInt(localStorage.getItem(RULES_PAGE_KEY + gameId), 10) || 0; } catch (e) { /* pas de mémoire */ }
      if (saved > 1 && saved <= viewer.pagesCount) viewer.currentPageNumber = saved;
    });
    eventBus.on('pagechanging', ({ pageNumber }) => {
      setFieldValue($('rulesPage'), pageNumber);
      try { localStorage.setItem(RULES_PAGE_KEY + gameId, String(pageNumber)); } catch (e) { /* pas de mémoire */ }
    });
    eventBus.on('scalechanging', ({ scale }) => { $('rulesZoom').textContent = Math.round(scale * 100) + ' %'; });
    eventBus.on('updatefindmatchescount', ({ matchesCount }) => {
      $('rulesFindInfo').textContent = matchesCount.total ? `${matchesCount.current} / ${matchesCount.total}` : '';
    });
    eventBus.on('updatefindcontrolstate', ({ state, matchesCount }) => {
      if (state === FindState.NOT_FOUND) $('rulesFindInfo').textContent = 'Introuvable';
      else if (state === FindState.PENDING) $('rulesFindInfo').textContent = 'Recherche…';
      else if (matchesCount && matchesCount.total) $('rulesFindInfo').textContent = `${matchesCount.current} / ${matchesCount.total}`;
    });

    const task = pdfjsLib.getDocument({
      url: rulesUrl(),
      // Pas de lecture en flux ni de préchargement : seulement les morceaux des pages affichées
      disableStream: true,
      disableAutoFetch: true,
      rangeChunkSize: 1 << 20,
      cMapUrl: PDFJS + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: PDFJS + 'standard_fonts/',
    });
    rulesStatus('Ouverture du livre…');
    const doc = await task.promise;
    viewer.setDocument(doc);
    linkService.setDocument(doc, null);
    $('rulesPages').textContent = '/ ' + doc.numPages;
    $('rulesPage').max = doc.numPages;
    rulesStatus('');
    buildRulesOutline(doc, linkService);
    rulesReader = { gameId, viewer, eventBus, linkService, doc };
    return rulesReader;
  })();
  try {
    return await rulesLoading;
  } catch (e) {
    rulesStatus("Impossible d'ouvrir le livre de règles.");
    throw e;
  } finally {
    rulesLoading = null;
  }
}

/** Sommaire du PDF (signets), cliquable. */
async function buildRulesOutline(doc, linkService) {
  const nav = $('rulesOutline');
  nav.textContent = '';
  const outline = await doc.getOutline();
  $('rulesTocBtn').hidden = !(outline && outline.length);
  if (!outline) return;
  const build = (items, depth) => {
    const ul = el('ul', 'plain');
    for (const item of items) {
      const li = ul.appendChild(el('li'));
      const b = li.appendChild(el('button', 'rules-outline-item', item.title));
      b.type = 'button';
      b.style.paddingLeft = 8 + depth * 14 + 'px';
      b.addEventListener('click', () => { if (item.dest) linkService.goToDestination(item.dest); });
      if (item.items && item.items.length && depth < 3) li.appendChild(build(item.items, depth + 1));
    }
    return ul;
  };
  nav.appendChild(build(outline, 0));
}

async function toggleRules() {
  const panel = $('rulesPanel');
  panel.hidden = !panel.hidden;
  if (panel.hidden) return;
  try {
    refitRules(await openRulesBook()); // le panneau était caché : dimensions à recalculer
  } catch (e) { /* message déjà affiché */ }
}

/* ---------- Barre d'outils ---------- */
const withReader = (fn) => () => { if (rulesReader) fn(rulesReader); };
$('rulesPrev').addEventListener('click', withReader((r) => { r.viewer.currentPageNumber = Math.max(1, r.viewer.currentPageNumber - 1); }));
$('rulesNext').addEventListener('click', withReader((r) => { r.viewer.currentPageNumber = Math.min(r.viewer.pagesCount, r.viewer.currentPageNumber + 1); }));
$('rulesPage').addEventListener('change', withReader((r) => {
  const n = intOr($('rulesPage').value, r.viewer.currentPageNumber);
  r.viewer.currentPageNumber = Math.min(r.viewer.pagesCount, Math.max(1, n));
}));
$('rulesZoomIn').addEventListener('click', withReader((r) => { r.viewer.currentScale = Math.min(4, r.viewer.currentScale * 1.2); }));
$('rulesZoomOut').addEventListener('click', withReader((r) => { r.viewer.currentScale = Math.max(0.25, r.viewer.currentScale / 1.2); }));
$('rulesFit').addEventListener('click', withReader((r) => { r.viewer.currentScaleValue = 'page-width'; }));
$('rulesTocBtn').addEventListener('click', () => {
  $('rulesPanel').classList.toggle('toc-open');
  if (rulesReader) setTimeout(() => refitRules(rulesReader), 200); // après la transition du sommaire
});
/** La zone de lecture a changé de largeur : réajuste la page si on est en « Largeur ». */
function refitRules(r) {
  if (r.viewer.currentScaleValue === 'page-width') r.viewer.currentScaleValue = 'page-width';
  else r.viewer.update();
}
function rulesFind(again, previous = false) {
  if (!rulesReader) return;
  const query = $('rulesQuery').value.trim();
  if (!query) { $('rulesFindInfo').textContent = ''; return; }
  rulesReader.eventBus.dispatch('find', {
    source: null, type: again ? 'again' : '', query,
    caseSensitive: false, entireWord: false, highlightAll: true, matchDiacritics: false, findPrevious: previous,
  });
}
$('rulesFindForm').addEventListener('submit', (e) => { e.preventDefault(); rulesFind(true); });
$('rulesQuery').addEventListener('input', () => rulesFind(false));
$('rulesFindPrev').addEventListener('click', () => rulesFind(true, true));
window.addEventListener('resize', () => {
  if (rulesReader && !$('rulesPanel').hidden) refitRules(rulesReader);
});

$('btnRules').addEventListener('click', toggleRules);
$('btnRulesClose').addEventListener('click', () => { $('rulesPanel').hidden = true; });
closeOnEscape(() => !$('rulesPanel').hidden, () => { $('rulesPanel').hidden = true; });
closeOnClickOutside($('rulesPanel').querySelector('.overlay-card'), () => !$('rulesPanel').hidden, () => { $('rulesPanel').hidden = true; }, $('btnRules'));
