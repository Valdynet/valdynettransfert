[DEPLOYMENT.md](https://github.com/user-attachments/files/35535538/DEPLOYMENT.md)

# Guide de déploiement – Valdynet Transfert

Ordre à suivre. Ne jamais coller de secret dans un chat, un fichier du dépôt ou le frontend.

## 1. Supabase
1. Créer un projet. Noter l’URL du projet, la clé **anon** et la clé **service_role** (la dernière reste secrète).
2. SQL Editor : exécuter dans l’ordre `database/migrations/001` à `006`.
3. Exécuter `database/tests/rls_checks.sql` : doit afficher `ALL RLS CHECKS PASSED`.
4. Authentication → Providers → Email : activer **Confirm email**, mot de passe minimum 8.
5. Authentication → URL Configuration : *Site URL* = votre domaine ; *Redirect URLs* = `/index.html` et `/forgot-password.html`.
6. E-mails de compte (confirmation, réinitialisation) : envoyés par Supabase Auth. Pour la production, configurer un SMTP personnalisé (Authentication → SMTP Settings) et adapter les modèles (Authentication → Email Templates).
7. Premier administrateur : s’inscrire sur le site, confirmer l’e-mail, puis exécuter la requête en commentaire à la fin de `002_rls.sql`.

## 2. GitHub
Les fichiers `index.html`, `assets/`, `netlify/`, `customer/`, `admin/`, `database/`, `netlify.toml` et `package.json` sont à la **racine** du dépôt (pas dans un dossier parent). Ne jamais committer `.env`.

## 3. Netlify
Import from Git. *Publish directory* `.`, *Functions directory* `netlify/functions`, pas de commande de build. Puis *Site configuration → Environment variables* (cocher *Contains secret values* pour les secrets) :

| Variable | Rôle | Phase |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Client public | 2 |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** serveur | 3 |
| `PAYPAL_MODE` | `sandbox` puis `live` | 5 |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` | **Secrets** PayPal | 5 |
| `EMAIL_PROVIDER` (`resend`), `EMAIL_API_KEY`, `EMAIL_FROM` | Notifications e-mail (laisser vide = rien n’est envoyé) | 6 |
| `WHATSAPP_NUMBER` | Chiffres seulement, avec indicatif (ex. `509XXXXXXXX`) ; vide = bouton masqué | 6 |

Redéployer après chaque modification de variable. L’envoi des e-mails est planifié toutes les 5 minutes (fonction `send-notifications`, déploiements de production seulement).

## 4. Vérifier le site en ligne
```
node scripts/smoke.js https://VOTRE-SITE.netlify.app
```
Chaque fichier CSS/JS doit être servi avec le bon type ; un `FAIL` indique le fichier manquant ou mal placé.

## 5. Tests automatiques (avant chaque déploiement)
```
node --test tests/*.test.js
```

## 6. Passage en production (PayPal Live)
Tous les essais Sandbox du README réussis, `rls_checks.sql` et `smoke.js` au vert, puis : app PayPal **Live**, nouveaux Client ID / Secret / Webhook ID, `PAYPAL_MODE=live`, redéploiement, premier paiement réel de faible montant. Avant d’augmenter les volumes : vérifier avec un professionnel les obligations réglementaires (enregistrement, KYC/AML) d’un service de transfert d’argent.

## 7. Retour arrière
Netlify → *Deploys* → choisir un déploiement précédent → *Publish deploy*. Les migrations SQL ne se défont pas automatiquement : sauvegarder la base avant d’exécuter une nouvelle migration.
