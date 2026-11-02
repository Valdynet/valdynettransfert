# VALDYNET TRANSFERT

**Sevis rapid**

Valdynet Transfert est une plateforme de transfert d'argent en cours de développement. Le projet vise à permettre aux clients de soumettre des demandes de transfert, de suivre leurs transactions et de consulter leur historique.

## 1. Technologies

- HTML5
- CSS3
- JavaScript
- Netlify
- Netlify Functions (intégration prévue)
- Supabase (intégration prévue)

## 2. Structure du projet

```text
valdynet-transfert/
│
├── index.html
├── login.html
├── register.html
├── track.html
│
├── customer/
│   ├── dashboard.html
│   ├── new-transfer.html
│   ├── history.html
│   ├── profile.html
│   └── logout.html
│
├── admin/
│   ├── login.html
│   ├── dashboard.html
│   ├── transaction-details.html
│   └── settings.html
│
├── assets/
│   ├── css/
│   │   └── style.css
│   │
│   └── js/
│       └── app.js
│
└── netlify/
    └── functions/
```

## 3. Fonctionnalités prévues

### Espace client
- Création de compte
- Connexion
- Demande de transfert
- Consultation de l'historique
- Suivi des transactions
- Gestion du profil

### Espace administrateur
- Connexion administrateur
- Consultation des demandes
- Gestion des transactions
- Modification des statuts
- Configuration des paramètres financiers

### Moyens de paiement prévus
- PayPal
- Wise
- MonCash
- NatCash

Les intégrations de paiement doivent être configurées et testées avant toute utilisation réelle.

## 4. Règles financières prévues

| Paramètre | Valeur |
|---|---:|
| Taux dépôt | 1 USD = 140 HTG |
| Taux retrait | 1 USD = 130 HTG |
| Frais de 10 à 30 USD | 5 % |
| Frais au-dessus de 30 USD | 10 % |
| Minimum | 10 USD ou équivalent HTG |

Les frais des prestataires de paiement doivent être distingués des frais de service de Valdynet Transfert.

## 5. Statuts des transactions

Les statuts prévus sont :

- Pending
- Processing
- Completed
- Cancelled
- Rejected

Chaque transaction devra disposer d'un identifiant unique.

## 6. Installation et organisation

1. Télécharger ou cloner le repository GitHub.
2. Vérifier que les fichiers HTML sont à la racine du projet.
3. Placer `style.css` dans `assets/css/`.
4. Placer `app.js` dans `assets/js/`.
5. Vérifier les chemins des fichiers dans les pages HTML.
6. Déployer le dossier du projet sur Netlify.

## 7. Configuration Netlify

Le projet prévoit l'utilisation de Netlify Functions pour les opérations serveur.

Les variables sensibles devront être configurées dans les variables d'environnement Netlify, notamment :

- PayPal Client Secret
- Supabase URL
- Supabase Service Role Key

**Ne jamais placer les clés secrètes dans les fichiers JavaScript accessibles au navigateur ou dans le repository GitHub.**

## 8. Base de données prévue

Supabase devra gérer les données suivantes :

- Customers
- Orders
- Payments
- Logs

Les accès devront être protégés par des règles de sécurité appropriées.

## 9. État du développement

**Projet en développement.**

Les pages et fonctions actuellement présentes ne signifient pas que toutes les fonctionnalités sont opérationnelles.

Les prochaines étapes comprennent :

1. Corriger et vérifier les chemins CSS et JavaScript.
2. Finaliser l'affichage des pages.
3. Configurer Supabase.
4. Développer les Netlify Functions.
5. Intégrer et tester les paiements.
6. Mettre en place la vérification des transactions.
7. Tester la sécurité avant la mise en production.

## 10. Marque et propriété

**Valdynet Transfert**

Sevis rapid

Préparé par **Valdynet Freelancer LLC**.

Tous droits réservés à Valdynet Freelancer LLC.
