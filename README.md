# Valdynet Transfert – Sevis rapid

Plateforme de transfert d’argent (USD ↔ HTG) de **Valdynet Freelancer LLC**.
Stack : HTML/CSS/JavaScript vanilla, Netlify + Netlify Functions, Supabase (PostgreSQL, Auth, RLS), PayPal REST API.

> **État : Phase 3 sur 6. Ce projet n’est pas prêt pour la production.**
> Les migrations SQL, l’authentification et le tableau de bord client sont écrits mais **non testés** ; aucun paiement n’est actif.

## Avancement

| Phase | Contenu | État |
|---|---|---|
| 1 | Design, page d’accueil, calculateur, service financier central | Livré (non testé automatiquement) |
| 2 | Supabase Auth, schéma SQL, RLS, tableau de bord client | Livré (non testé) |
| 3 | Création de transaction, suivi public (historique : tableau du dashboard) | Livré (non testé) |
| 4 | Tableau de bord admin, paramètres financiers, journaux d’audit | À faire |
| 5 | PayPal Sandbox, flux manuels Wise / MonCash / NatCash | À faire |
| 6 | E-mails, WhatsApp, tests de sécurité, guide de déploiement | À faire |

## Structure actuelle

```text
valdynet-transfert/
├── index.html                      Accueil + calculateur + connexion/inscription
├── forgot-password.html            Réinitialisation du mot de passe
├── customer/dashboard.html         Tableau de bord client (protégé)
├── track.html                      Suivi public
├── customer/new-transfer.html      Nouveau transfert
├── database/migrations/            001_schema.sql, 002_rls.sql, 003_transactions.sql
├── package.json                    Dépendance des fonctions (@supabase/supabase-js)
├── assets/css/style.css
├── assets/js/calculator.js         Affichage uniquement, appelle /api/calculate
├── assets/js/app.js                Langue FR/HT, onglets
├── assets/js/auth.js               Supabase Auth, validation, garde de session
├── assets/js/dashboard.js          Tableau de bord client
├── netlify/functions/config.js     Expose URL + clé anon (publiques) depuis les variables Netlify
├── netlify/functions/create-transaction.js   Création sécurisée (auth, taux limité, idempotence)
├── netlify/functions/track.js      Suivi public (limité, réponses génériques)
├── netlify/functions/_lib/         finance, settings (taux depuis Supabase), common (client service role)
├── netlify/functions/calculate.js  POST /api/calculate
├── netlify/functions/_lib/finance.js   Service financier central (seule source des calculs)
├── netlify.toml                    Redirection /api/*, en-têtes de sécurité
├── .env.example                    Noms des variables (aucune valeur)
└── .gitignore
```

## Lancer en local

Prérequis : Node.js 18 ou plus.

```bash
npm install -g netlify-cli   # une seule fois
netlify dev                  # ouvre http://localhost:8888
```

Ouvrir `index.html` directement ne fonctionne pas : le calculateur a besoin de la fonction `/api/calculate`.

## Déployer sur Netlify

1. Créer un dépôt GitHub et y pousser le projet.
2. Netlify → *Add new site* → *Import from Git*.
3. Paramètres : *Publish directory* `.`, *Functions directory* `netlify/functions`, aucune commande de build.
4. Ajouter `SUPABASE_URL`, `SUPABASE_ANON_KEY` et (Phase 3) `SUPABASE_SERVICE_ROLE_KEY` (serveur uniquement, jamais dans le code ni côté navigateur) dans *Site configuration → Environment variables* (jamais dans le code). Netlify installe `@supabase/supabase-js` depuis `package.json` au déploiement.

## Configurer Supabase (Phase 2)

1. Créer un projet Supabase. Copier l’URL du projet et la clé **anon** dans les variables Netlify (et dans `.env` pour `netlify dev`).
2. SQL Editor : exécuter `database/migrations/001_schema.sql`, puis `002_rls.sql`.
3. Authentication → Providers → Email : activer **Confirm email** ; longueur minimale du mot de passe : 8.
4. Authentication → URL Configuration : définir *Site URL* (votre domaine Netlify) et ajouter `/index.html` et `/forgot-password.html` aux *Redirect URLs*.
5. Premier administrateur : créer le compte via le site, confirmer l’e-mail, puis exécuter dans le SQL Editor la requête en commentaire à la fin de `002_rls.sql`. Le rôle ne peut pas être modifié depuis le navigateur (accès en écriture retiré sur `profiles.role`).
6. Phase 3 : exécuter aussi `003_transactions.sql`. Les taux et frais du calculateur viennent désormais de la table `financial_settings`.
7. Tester avec deux comptes clients : chacun ne doit voir que ses propres données.

Limites actuelles : la page admin n’existe pas encore (Phase 4), les transactions sont créées par le backend en Phase 3, et la garde de session des pages client est un confort d’usage : la vraie protection des données est la RLS. Le script Supabase est chargé depuis jsDelivr en version fixe, sans empreinte SRI : l’héberger vous-même est préférable avant la production.

## Politique de calcul financier (par défaut)

Définie dans `netlify/functions/_lib/finance.js`, modifiable plus tard depuis les paramètres admin (Phase 4).

- Taux dépôt : 1 USD = 140 HTG. Taux retrait : 1 USD = 130 HTG.
- Minimum : 10 USD ou l’équivalent en HTG.
- Frais Valdynet (politique `full_amount`) : 5 % de 10 à 30 USD inclus, 10 % au-dessus de 30 USD. Le pourcentage s’applique au **montant complet** (pas par tranche), d’après son équivalent USD. Le frais s’ajoute au montant, dans la devise de l’expéditeur.
- Conséquence à valider : 30,00 $ → 1,50 $ de frais, mais 30,01 $ → 3,00 $.
- Frais fournisseurs (PayPal, Wise, MonCash, NatCash) : séparés, affichés « À confirmer » tant qu’ils ne sont pas configurés, jamais comptés comme revenu Valdynet.
- Devise de paiement : PayPal et Wise en USD, MonCash et NatCash en HTG.
- Services actifs : dépôt et retrait. Transfert portefeuille à portefeuille et international sont désactivés (taux et itinéraires non définis).

## API

`POST /api/calculate` avec `{ "service": "deposit", "method": "paypal", "amount": 50 }`.
Retourne le détail du calcul, ou `{ "ok": false, "error": "CODE" }` (`SERVICE_UNAVAILABLE`, `METHOD_UNAVAILABLE`, `INVALID_AMOUNT`, `BELOW_MINIMUM`).

## Tests

Aucun test automatisé pour l’instant. Prévus : calculateur (taux, minimum, seuils de frais), puis authentification, isolation des données, paiements et suivi, au fil des phases. Les paiements PayPal se testeront uniquement en Sandbox.

## Liste de contrôle de sécurité

Cochée = en place dans le code actuel. Non cochée = à faire.

- [x] En-têtes HTTPS/sécurité (HSTS, nosniff, anti-framing, CSP restrictive)
- [x] Aucun secret dans le code frontend
- [x] Calculs côté serveur (le navigateur n’est qu’un affichage)
- [x] Limite de taille et validation d’entrée sur `/api/calculate`
- [x] Sorties écrites avec `textContent` (pas d’injection HTML)
- [x] Supabase Auth, réinitialisation du mot de passe (écrits, à tester) ; vérification d’e-mail à activer dans Supabase
- [ ] Rôle admin vérifié côté serveur
- [x] Row Level Security sur toutes les tables, écriture client retirée (migrations écrites, à exécuter et tester)
- [x] Limitation de débit (création et suivi) et idempotence des transactions (écrits, à tester) ; idempotence des paiements en Phase 5
- [ ] Vérification serveur des paiements PayPal et signature des webhooks
- [x] Suivi public : référence non devinable, limitation de débit, réponses génériques (écrit, à tester)
- [x] Tables de journaux en ajout seul (déclencheurs) ; alimentation des journaux en Phases 3–4
- [ ] Restrictions d’envoi de fichiers (preuves de paiement)
- [ ] Tests de sécurité et de non-régression

Ne pas affirmer de conformité PCI DSS ni d’approbation réglementaire sans validation indépendante. Un service de transfert d’argent peut exiger enregistrement ou licence, ainsi que des procédures KYC/AML : à vérifier avec un professionnel avant d’augmenter les volumes.

## Intégrations nécessitant des identifiants externes

| Service | Variables | Phase |
|---|---|---|
| Supabase | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (serveur uniquement) | 2 |
| PayPal (Sandbox puis Live) | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` | 5 |
| Fournisseur d’e-mail | à choisir | 6 |
| Wise / MonCash / NatCash | instructions de paiement saisies dans l’admin (pas d’API pour l’instant) | 5 |
