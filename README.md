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

Redémarre le serveur après toute modification de comptes pour qu'elle soit prise en compte. Une fois connecté (`/login`), un compte peut créer un salon (« Créer un salon »), puis envoyer aux joueurs le bouton « Lien joueurs » (ils doivent avoir chacun leur propre compte pour s'y connecter). Le salon est rattaché au compte qui l'a créé : ce compte en est MJ sur tous ses appareils et le retrouve dans « Mes salons de MJ ». Le « Lien MJ » (secret) donne aussi le rôle de MJ, et rattache durablement le salon au compte qui l'ouvre (co-MJ, ou salons créés avant ce rattachement).

## Utilisation

- Compte : nom affiché et couleur par défaut viennent du compte (voir `scripts/manage-users.js`) ; le nom/couleur du jeton restent modifiables en jeu comme avant.
- Joueur : glisse son propre jeton ; change son nom et sa couleur dans le panneau.
- MJ : déplace tous les jetons, ajoute des PNJ, les cache (invisibles des joueurs), règle la grille, active le brouillard et le peint avec Révéler / Cacher.
- Cartes (panneau de droite, MJ) : un salon a un espace de travail de plusieurs cartes (PNG, JPEG, WebP, GIF) — « Ajouter une image » en ajoute une nouvelle sans effacer les autres. Chaque carte garde sa propre grille, son brouillard et ses traits de dessin, indépendamment des autres. ✎ renomme, 🗑 supprime (le salon recrée une carte vierge si c'était la dernière).
- Cartes ouvertes simultanément : jusqu'à 2 cartes peuvent être affichées en même temps (ex. la carte de la rue et celle d'un bâtiment), chacune dans son propre viewport avec sa caméra, ses jetons, son brouillard et son dessin propres — clique une carte dans la liste pour l'ouvrir/la fermer. Le dernier viewport cliqué (liseré de couleur) est celui que ciblent les réglages de Grille/Brouillard du panneau et le bouton « Ajouter » un PNJ. Un jeton appartient à une carte à la fois ; pour le faire passer sur une autre carte ouverte (ex. faire entrer le groupe dans le bâtiment), sélectionne-le et utilise son menu de déplacement entre cartes. Visible et interactif pour tous (MJ et joueurs).
- Vue : molette pour zoomer, glisser dans le vide pour se déplacer, pincement sur mobile, F pour recentrer.
- Dés (panneau de gauche, touche D) : boutons rapides d4 à d100, mode Normal/Avantage/Désavantage, modificateur, et une formule libre façon JDR (`4d6kh3+2`, `2d20kl1-1`...). `kh1`/`kl1` gardent le meilleur/pire dé (avantage/désavantage). Chaque jet est calculé côté serveur (aucun résultat n'est décidé par le navigateur) et diffusé à toute la table avec l'historique. Case « Jet secret » : visible du MJ et de son auteur uniquement.
- Jets propres au jeu (panneau des dés, sous la formule libre) : voir « Jeux » ci-dessous. Chaque test est résolu côté serveur et affiche son degré de réussite dans la bannière et l'historique.
- Dessin (panneau de droite) : MJ et joueurs peuvent annoter la carte en direct — pinceau, ligne, flèche, rectangle, cercle, et une gomme pour effacer un trait (le sien, ou n'importe lequel pour le MJ). Le MJ dispose en plus d'un calque caché des joueurs et d'un bouton « Tout effacer ».
- Fiche de personnage (bouton 📋 dans la barre du haut) : celle du jeu du salon (voir « Jeux »). Une fiche par joueur et par salon, synchronisée en temps réel comme le reste. Un joueur ne voit/édite que la sienne ; le MJ choisit un joueur dans un sélecteur et voit/édite toutes les fiches du salon. Un aide-mémoire repliable rappelle les règles utiles, et le panneau « Personnage » résume les jauges principales (PV, Volonté, SAN…). La fiche PNJ rapide du MJ suit aussi le jeu.
- Portrait du personnage (en tête de fiche) : le joueur, ou le MJ, choisit une image, puis « Cadrer le jeton… » pour choisir la zone ronde qui remplit le jeton sur la carte (glisser le cercle ; molette ou curseur pour sa taille). « Retirer l'image » rend au jeton sa couleur et ses initiales.
- Préparation (bouton « Préparation » du MJ, dans la barre du haut) : le plateau est caché aux joueurs pendant que le MJ installe la partie. Le serveur ne leur envoie plus rien du plateau (cartes, jetons, dessins, brouillard, jets, initiative) ; ils peuvent toujours entrer dans le salon pour consulter et modifier leur fiche et leur journal. « Ouvrir la partie » leur rend le plateau aussitôt. Les jets faits pendant la préparation restent réservés au MJ. Le statut est conservé et affiché dans « Mes salons de MJ ».

## Jeux

Le jeu se choisit sur l'accueil, avant « Créer un salon » : toute la direction artistique du site (couleurs, polices, fond, dés) change aussitôt, et le salon créé garde ce jeu. Les salons créés avant ce choix sont des salons Hunter. Plateau, jetons, brouillard, dessin, journal et initiative sont communs à tous les jeux.

- **Hunter: the Reckoning** : fiche Chronicles of Darkness (9 attributs, 27 compétences + spécialité, Santé/Volonté en superficiel/aggravé, Faim/Humanité à libellé modifiable). Jet de pool de d10 (6+ = réussite, paire de 10 = +2) contre une difficulté ; les dés Désespoir (pré-remplis depuis la jauge) déclenchent Overreach (le Danger monte) ou Despair sur un 1. Jauges de cellule Danger et Désespoir dans la barre du haut. Initiative au d10.
- **Pathfinder 2e** (Remaster) : modificateurs d'attributs, rangs de maîtrise (Perception, sauvegardes, compétences) avec total calculé (attribut + niveau + 2 × rang + bonus), PV, CA, points d'héroïsme. Test d20 + modificateur contre un DD à quatre degrés (±10, 20 et 1 naturels décalent d'un cran). Initiative au d20.
- **L'Appel de Cthulhu** (7e) : caractéristiques et compétences en pourcentage (valeurs de base, seuils ½ et ⅕ affichés), PV, SAN, PM, Chance. Test d100 sous la valeur avec dés bonus/malus et difficulté Ordinaire/Majeure/Extrême (critique sur 01, maladresse sur 100 ou 96-100 sous 50). Initiative au score (DEX), sans jet.

Livres de règles : dépose le PDF de chaque jeu dans `data/rules/<jeu>.pdf` (`hunter.pdf`, `pf2e.pdf`, `coc7.pdf`). Un bouton « Règles » (touche R) apparaît alors dans les salons de ce jeu et ouvre le livre dans un panneau, sur ordinateur comme sur téléphone : lecteur PDF.js (Mozilla, licence Apache 2.0, fichiers dans `public/vendor/pdfjs/`) aux couleurs du thème, avec sommaire, pages, zoom et recherche, et mémoire de la dernière page lue. Les PDF ne sont accessibles qu'aux comptes connectés (jamais dans `public/`) et ne sont pas suivis par git. Le livre est chargé par morceaux (requêtes Range) au fil des pages consultées : pas besoin de le télécharger en entier (la recherche, elle, doit lire tout le texte et prend donc plus de temps sur une connexion lente).

Ajouter un jeu : un fichier dans `lib/games/` (fiche, fiche PNJ, jauges, panneaux de jet et leur résolution, décrits en données) déclaré dans `lib/games/index.js`, et un bloc `[data-game="…"]` de variables de thème dans `public/style.css`.

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
