# Plateau JDR

Un plateau partagé en temps réel pour parties de jeu de rôle en ligne : jetons ronds déplaçables, carte importée, grille aimantée, brouillard de guerre géré par le MJ. Aucune dépendance : Node 20+ suffit (le client de test `test.js` demande Node 22+).

## Lancer

    node server.js            # http://localhost:3000
    PORT=8080 node server.js  # autre port

Le site est réservé aux comptes que tu crées toi-même (pas d'auto-inscription) :

    node scripts/manage-users.js add alice motdepasse123 "Alice"
    node scripts/manage-users.js list
    node scripts/manage-users.js passwd alice nouveau-mdp
    node scripts/manage-users.js remove alice

Redémarre le serveur après toute modification de comptes pour qu'elle soit prise en compte. Une fois connecté (`/login`), un compte peut créer un salon (« Créer un salon »), puis envoyer aux joueurs le bouton « Lien joueurs » (ils doivent avoir chacun leur propre compte pour s'y connecter). Le « Lien MJ » (secret) permet de reprendre la main de MJ sur ce salon précis depuis un autre appareil — la connexion au compte et le rôle de MJ d'un salon sont deux choses indépendantes.

## Utilisation

- Compte : nom affiché et couleur par défaut viennent du compte (voir `scripts/manage-users.js`) ; le nom/couleur du jeton restent modifiables en jeu comme avant.
- Joueur : glisse son propre jeton ; change son nom et sa couleur dans le panneau.
- MJ : déplace tous les jetons, ajoute des PNJ, les cache (invisibles des joueurs), règle la grille, active le brouillard et le peint avec Révéler / Cacher.
- Cartes (panneau de droite, MJ) : un salon a un espace de travail de plusieurs cartes (PNG, JPEG, WebP, GIF) — « Ajouter une image » en ajoute une nouvelle sans effacer les autres. Chaque carte garde sa propre grille, son brouillard et ses traits de dessin, indépendamment des autres. ✎ renomme, 🗑 supprime (le salon recrée une carte vierge si c'était la dernière).
- Cartes ouvertes simultanément : jusqu'à 2 cartes peuvent être affichées en même temps (ex. la carte de la rue et celle d'un bâtiment), chacune dans son propre viewport avec sa caméra, ses jetons, son brouillard et son dessin propres — clique une carte dans la liste pour l'ouvrir/la fermer. Le dernier viewport cliqué (liseré de couleur) est celui que ciblent les réglages de Grille/Brouillard du panneau et le bouton « Ajouter » un PNJ. Un jeton appartient à une carte à la fois ; pour le faire passer sur une autre carte ouverte (ex. faire entrer le groupe dans le bâtiment), sélectionne-le et utilise son menu de déplacement entre cartes. Visible et interactif pour tous (MJ et joueurs).
- Vue : molette pour zoomer, glisser dans le vide pour se déplacer, pincement sur mobile, F pour recentrer.
- Dés (panneau de gauche, touche D) : boutons rapides d4 à d100, mode Normal/Avantage/Désavantage, modificateur, et une formule libre façon JDR (`4d6kh3+2`, `2d20kl1-1`...). `kh1`/`kl1` gardent le meilleur/pire dé (avantage/désavantage). Chaque jet est calculé côté serveur (aucun résultat n'est décidé par le navigateur) et diffusé à toute la table avec l'historique. Case « Jet secret » : visible du MJ et de son auteur uniquement.
- Pool de succès (Storytelling System : Hunter, Vampire, Mage, Changeling...) : indique le nombre de d10 (ex. 4), chaque dé est une réussite indépendante à partir de 8 (pas de somme). Pool ≤ 0 : dé de chance unique (10 = 1 réussite, 1 = échec critique). Relance optionnelle 8-again / 9-again / 10-again : chaque dé atteignant ce seuil relance un dé supplémentaire.
- Dessin (panneau de droite) : MJ et joueurs peuvent annoter la carte en direct — pinceau, ligne, flèche, rectangle, cercle, et une gomme pour effacer un trait (le sien, ou n'importe lequel pour le MJ). Le MJ dispose en plus d'un calque caché des joueurs et d'un bouton « Tout effacer ».
- Fiche de personnage (bouton 📋 dans la barre du haut) : tronc commun Chronicles of Darkness (Hunter, Vampire, Mage, Changeling...) — 9 attributs, 27 compétences avec note (0-5) et spécialité libre, Santé/Volonté, Concept/Vertu/Vice, Mérites et Notes libres (pour les mécaniques propres à un type de personnage). Une fiche par joueur et par salon, synchronisée en temps réel comme le reste. Un joueur ne voit/édite que la sienne ; le MJ choisit un joueur dans un sélecteur et voit/édite toutes les fiches du salon. Une aide-mémoire repliable rappelle la répartition des points de création par priorité.

## Données

Les salons sont sauvegardés dans `data/rooms.json`, les comptes dans `data/users.json` et les cartes dans `data/uploads/` (variable `DATA_DIR` pour changer). Un salon inactif depuis 120 jours est supprimé. L'historique des jets de dés (50 derniers par salon) n'est pas persisté : il est perdu si le serveur redémarre. Les sessions de connexion et les tickets WebSocket sont uniquement en mémoire : un redémarrage du serveur déconnecte tout le monde (il suffit de se reconnecter sur `/login`).

## Derrière Nginx (WebSocket)

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        client_max_body_size 25m;
        proxy_read_timeout 3600s;
    }

Prévoir un service systemd (ou pm2) pour relancer `node server.js`, et HTTPS (le client passe automatiquement en `wss://`).

## Exposer avec Cloudflare Tunnel

Pour donner accès à des joueurs distants sans domaine ni certificat à gérer (cloudflared fait tourner un tunnel HTTPS, WebSocket compris, sans configuration supplémentaire) :

    node server.js                              # démarre le serveur en local
    cloudflared tunnel --url http://localhost:3000

`cloudflared` affiche une URL temporaire en `https://xxxx.trycloudflare.com` (elle change à chaque lancement) : c'est elle qu'il faut donner aux joueurs, pas `localhost`. Nécessite [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) installé au préalable. Pour une URL fixe et personnalisée (ex. `jdr.mondomaine.fr`), crée un tunnel nommé et rattaché à ton domaine (`cloudflared tunnel login`, `cloudflared tunnel create`, `cloudflared tunnel route dns`) plutôt qu'un tunnel rapide.
