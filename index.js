/**
 * STELLA BRAIN - Agent Autonome Railway
 * Utilise Claude API (Anthropic) - Pas de compression
 * Chaque appel = contexte frais depuis Supabase
 */

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');

const app = express();
app.use(express.json());

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
  PORT: process.env.PORT || 3000,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://upqldbeaxuikbzohlgne.supabase.co',
  SUPABASE_KEY: process.env.SUPABASE_SERVICE_KEY,
  SHOPIFY_STORE: process.env.SHOPIFY_STORE || 'planetemode.myshopify.com',
  SHOPIFY_TOKEN: process.env.SHOPIFY_ACCESS_TOKEN,
  MODEL: 'claude-sonnet-4-20250514',
  MAX_TOKENS: 4096
};

// Clients
const anthropic = new Anthropic({ apiKey: CONFIG.ANTHROPIC_API_KEY });
const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

// ============================================================
// SYSTÈME PROMPT STELLA
// ============================================================

const STELLA_SYSTEM_PROMPT = `Tu es STELLA, l'IA copilote business de Planetebeauty.com.

## CONTEXTE BUSINESS
- Entreprise : BHTC EURL (Holding)
- Site : Planetebeauty.com (parfumerie de niche)
- CA 2025 cible : 750 000€ HT
- CA/jour cible : 3 000€ HT minimum
- Clients : 29 641
- Marge brute : 41%
- Panier moyen cible : 200€

## TES CAPACITÉS
- Analyser les KPIs Shopify en temps réel
- Détecter les opportunités de CA
- Alerter sur les problèmes (stock, commandes, etc.)
- Recommander des actions concrètes
- Répondre aux questions business

## RÈGLES ABSOLUES
1. ANTI-HALLUCINATION : Jamais de chiffre sans source vérifiée
2. Sois CONCIS et ACTIONNABLE
3. Priorise : CA > Conversion > Acquisition
4. Si tu ne sais pas, dis-le

## FORMAT RÉPONSE
- Bullet points pour la clarté
- Chiffres précis avec source
- Actions concrètes avec priorité`;

// ============================================================
// FONCTIONS UTILITAIRES
// ============================================================

/**
 * Charge le contexte depuis Supabase
 */
async function loadContext() {
  try {
    // Dernières sessions
    const { data: sessions } = await supabase
      .from('stella_sessions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    // Tâches pending
    const { data: tasks } = await supabase
      .from('stella_tasks')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .limit(10);

    // Config
    const { data: config } = await supabase
      .from('stella_config')
      .select('*')
      .in('key', ['business_context', 'current_priorities']);

    return {
      recent_sessions: sessions || [],
      pending_tasks: tasks || [],
      config: config || []
    };
  } catch (error) {
    console.error('Erreur chargement contexte:', error);
    return { recent_sessions: [], pending_tasks: [], config: [] };
  }
}

/**
 * Récupère les KPIs Shopify du jour
 */
async function getShopifyKPIs() {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const query = `{
      orders(first: 50, query: "created_at:>=${today}") {
        edges {
          node {
            id
            name
            totalPriceSet { shopMoney { amount currencyCode } }
            createdAt
            lineItems(first: 5) {
              edges {
                node { title quantity }
              }
            }
          }
        }
      }
    }`;

    const response = await fetch(
      `https://${CONFIG.SHOPIFY_STORE}/admin/api/2024-01/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': CONFIG.SHOPIFY_TOKEN
        },
        body: JSON.stringify({ query })
      }
    );

    const data = await response.json();
    const orders = data?.data?.orders?.edges || [];
    
    const totalCA = orders.reduce((sum, o) => 
      sum + parseFloat(o.node.totalPriceSet.shopMoney.amount), 0
    );
    
    return {
      date: today,
      nb_commandes: orders.length,
      ca_jour: totalCA.toFixed(2),
      panier_moyen: orders.length > 0 ? (totalCA / orders.length).toFixed(2) : 0,
      objectif: 3000,
      progression: ((totalCA / 3000) * 100).toFixed(1)
    };
  } catch (error) {
    console.error('Erreur Shopify:', error);
    return null;
  }
}

/**
 * Appelle Claude API avec contexte frais
 */
async function askClaude(userMessage, additionalContext = {}) {
  try {
    // Charger contexte Supabase
    const context = await loadContext();
    
    // Charger KPIs Shopify
    const kpis = await getShopifyKPIs();
    
    // Construire le message avec contexte
    const contextMessage = `
## CONTEXTE ACTUEL (${new Date().toLocaleString('fr-FR')})

### KPIs Shopify du jour
${kpis ? `
- CA du jour : ${kpis.ca_jour}€ (objectif: ${kpis.objectif}€)
- Progression : ${kpis.progression}%
- Commandes : ${kpis.nb_commandes}
- Panier moyen : ${kpis.panier_moyen}€
` : 'Erreur récupération KPIs'}

### Tâches en attente
${context.pending_tasks.length > 0 
  ? context.pending_tasks.map(t => `- [${t.priority}] ${t.title}`).join('\n')
  : 'Aucune tâche en attente'}

### Contexte additionnel
${JSON.stringify(additionalContext, null, 2)}

---

## QUESTION UTILISATEUR
${userMessage}
`;

    // Appel Claude API
    const response = await anthropic.messages.create({
      model: CONFIG.MODEL,
      max_tokens: CONFIG.MAX_TOKENS,
      system: STELLA_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: contextMessage }
      ]
    });

    const assistantMessage = response.content[0].type === 'text' 
      ? response.content[0].text 
      : '';

    // Sauvegarder la session
    await supabase.from('stella_sessions').insert({
      user_message: userMessage,
      assistant_message: assistantMessage,
      context: { kpis, tasks: context.pending_tasks.length },
      tokens_used: response.usage?.input_tokens + response.usage?.output_tokens,
      model: CONFIG.MODEL
    });

    return {
      success: true,
      message: assistantMessage,
      kpis,
      tokens: response.usage
    };

  } catch (error) {
    console.error('Erreur Claude API:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================================
// ENDPOINTS API
// ============================================================

// Health check
app.get('/health', async (req, res) => {
  const kpis = await getShopifyKPIs();
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      anthropic: !!CONFIG.ANTHROPIC_API_KEY,
      supabase: !!CONFIG.SUPABASE_KEY,
      shopify: !!CONFIG.SHOPIFY_TOKEN
    },
    kpis_sample: kpis
  });
});

// Chat endpoint - Poser une question à STELLA
app.post('/chat', async (req, res) => {
  const { message } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: 'Message requis' });
  }

  const response = await askClaude(message);
  res.json(response);
});

// Briefing du jour
app.get('/briefing', async (req, res) => {
  const response = await askClaude(
    'Donne-moi le briefing complet du jour : KPIs, alertes, priorités, recommandations.'
  );
  res.json(response);
});

// KPIs temps réel
app.get('/kpis', async (req, res) => {
  const kpis = await getShopifyKPIs();
  res.json(kpis);
});

// Créer une tâche
app.post('/tasks', async (req, res) => {
  const { title, description, priority = 'normal' } = req.body;
  
  const { data, error } = await supabase
    .from('stella_tasks')
    .insert({ title, description, priority, status: 'pending' })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  
  res.json(data);
});

// Liste des tâches
app.get('/tasks', async (req, res) => {
  const { data } = await supabase
    .from('stella_tasks')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  
  res.json(data || []);
});

// ============================================================
// CRON JOBS - Tâches automatiques
// ============================================================

// Briefing matin à 8h
cron.schedule('0 8 * * *', async () => {
  console.log('🌅 Briefing matin...');
  const response = await askClaude(
    'Briefing matin automatique : analyse les KPIs, identifie les alertes et priorités du jour.'
  );
  
  // Sauvegarder comme tâche complétée
  await supabase.from('stella_tasks').insert({
    title: 'Briefing matin automatique',
    description: response.message,
    priority: 'info',
    status: 'completed',
    result: response
  });
  
  console.log('✅ Briefing envoyé');
}, { timezone: 'Europe/Paris' });

// Check KPIs toutes les heures
cron.schedule('0 * * * *', async () => {
  console.log('📊 Check KPIs horaire...');
  const kpis = await getShopifyKPIs();
  
  if (kpis) {
    // Alerte si CA trop bas à 18h
    const hour = new Date().getHours();
    const expectedProgress = (hour / 24) * 100;
    
    if (hour >= 18 && parseFloat(kpis.progression) < expectedProgress * 0.7) {
      console.log('⚠️ Alerte : CA en retard');
      await askClaude(
        `ALERTE : CA à ${kpis.progression}% alors qu'on devrait être à ${expectedProgress.toFixed(0)}%. Analyse et recommandations urgentes.`
      );
    }
  }
}, { timezone: 'Europe/Paris' });

// Récap soir à 20h
cron.schedule('0 20 * * *', async () => {
  console.log('🌙 Récap soir...');
  const response = await askClaude(
    'Récap de fin de journée : bilan CA, commandes marquantes, ce qui a marché, points d\'attention pour demain.'
  );
  
  await supabase.from('stella_tasks').insert({
    title: 'Récap soir automatique',
    description: response.message,
    priority: 'info',
    status: 'completed',
    result: response
  });
  
  console.log('✅ Récap envoyé');
}, { timezone: 'Europe/Paris' });

// ============================================================
// DÉMARRAGE
// ============================================================

app.listen(CONFIG.PORT, () => {
  console.log(`
🌟 ════════════════════════════════════════════════════════════
   STELLA BRAIN - Agent Autonome
   Port: ${CONFIG.PORT}
   Model: ${CONFIG.MODEL}
   
   Endpoints:
   - GET  /health   → Status système
   - GET  /briefing → Briefing du jour
   - GET  /kpis     → KPIs temps réel
   - POST /chat     → Poser une question
   - GET  /tasks    → Liste tâches
   - POST /tasks    → Créer tâche
   
   Cron Jobs:
   - 08:00 → Briefing matin
   - Toutes les heures → Check KPIs
   - 20:00 → Récap soir
════════════════════════════════════════════════════════════ 🌟
  `);
});
