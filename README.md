# 🧠 Supercerveau Unifié V3.0 - Planetebeauty

Système nerveux central unifié pour Planetebeauty.com, intégrant l'architecture Sidekick complète.

## Architecture

```
SUPERCERVEAU UNIFIÉ V3.0
├── Chef d'orchestre (validation + routing)
├── Message Bus Redis (Pub/Sub temps réel)
├── Agent Stratège (analyse KPIs, rapports)
├── Agent Opérateur (commandes, SAV, notifications)
├── Agent Technicien (code, debug, deploy)
├── Shopify Connector (GraphQL + Cache Redis)
└── Sécurité (budget $10/jour, validation obligatoire)
```

## Démarrage

```bash
# Installation
npm install

# Configuration
cp .env.example .env
# Éditer .env avec vos credentials

# Lancement
npm start
```

## Endpoints API

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| /health | GET | Status système |
| /start | POST | Démarrer orchestrateur |
| /stop | POST | Arrêter orchestrateur |
| /budget | GET | Budget restant |
| /agents | GET | Status des agents |
| /suggest | POST | Suggérer une tâche |
| /kpis | GET | KPIs Shopify |
| /events/:channel | GET | Historique Message Bus |
| /webhooks/shopify | POST | Webhooks Shopify |

## Sécurité

- Budget quotidien: $10/jour
- Limite tokens: 500,000/jour  
- Tâches par heure: max 10
- Circuit breaker: 3 erreurs consécutives
- Validation obligatoire avant exécution

## Déploiement Railway

Variables d'environnement requises:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `UPSTASH_REDIS_URL`
- `UPSTASH_REDIS_TOKEN`
- `SHOPIFY_ACCESS_TOKEN`
- `ANTHROPIC_API_KEY`
- `MODE` (manual|auto)

---
*Généré le 27 décembre 2025*
