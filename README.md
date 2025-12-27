# 🧠 Supercerveau V2 - Planetebeauty

Agent IA autonome **sécurisé** pour Planetebeauty.com

## 🔒 Sécurités

| Protection | Limite |
|------------|--------|
| Budget quotidien | $10/jour |
| Coût max par tâche | $2 |
| Tokens quotidiens | 500 000 |
| Tâches par heure | 10 max |
| Circuit breaker | 3 erreurs |
| Sous-tâches | **INTERDIT** |

## ⚡ Fonctionnement

1. Le Supercerveau lit les tâches **approuvées** dans Supabase
2. Il les exécute une par une
3. Il peut **suggérer** des tâches (en `pending_validation`)
4. Benoît valide dans le Dashboard → https://copilote.planetebeauty.com
5. Si trop d'erreurs → Circuit breaker → Email d'alerte

## 🚀 Déploiement Railway

Variables requises :
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `ANTHROPIC_API_KEY`
- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`
- `PORT` (3001)
- `MODE` (manual ou auto)

## 📡 API

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/health` | GET | Status agent |
| `/start` | POST | Démarrer l'agent |
| `/stop` | POST | Arrêter l'agent |
| `/budget` | GET | Budget restant |
| `/suggest` | POST | Suggérer une tâche |

## 🛑 Mode Manuel (par défaut)

Par sécurité, l'agent démarre en mode **MANUEL**.

Pour démarrer :
```bash
curl -X POST https://supercerveau-v2.up.railway.app/start
```

Pour activer le mode auto, ajouter `MODE=auto` dans les variables Railway.
