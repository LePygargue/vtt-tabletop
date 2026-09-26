# Idées à développer plus tard

Pistes techniques pour démarrer vite. Ajouter ici les prochaines idées.

---

## Réalisé

- **Portrait de personnage et image du jeton** : image complète stockée sur le jeton du joueur (`token.portrait`), zone ronde dans `token.crop = { x, y, s }`. Envoi : `POST /api/rooms/:id/tokens/:tokenId/portrait` (le joueur pour son jeton, le MJ pour tous). Code client dans `public/js/portrait.js`.
- **Salon en préparation** : `room.status = 'open' | 'prep'`, changé par le message MJ `roomStatus`. Filtre central : `hiddenByPrep()` dans `lib/net.js`, qui refuse tout par défaut sauf la liste blanche `PREP_ALLOWED`. État réduit dans `stateFor()`, actions des joueurs limitées dans `handleMessage()`. Les jets faits en préparation sont marqués `prep` (visibles du MJ seul). Code client dans `public/js/prep.js`.
