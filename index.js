// STELLA Brain - Agent Autonome Railway
// Dashboard + API pour Planetebeauty.com

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import express from 'express';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// Configuration
// ============================================================
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

const SYSTEM_PROMPT = `Tu es STELLA, l'assistante IA business de Planetebeauty.com.

CONTEXTE BUSINESS:
- Site e-commerce parfumerie de niche
- CA annuel: 750 000€ HT
- Objectif CA/jour: 3 000€ HT minimum
- Clients: 29 641
- Marge brute: 41%
- Panier moyen cible: 200€

TES RÈGLES:
1. ANTI-HALLUCINATION: Ne jamais inventer de chiffres. Si tu ne sais pas, dis-le.
2. Sois directe, concise, actionnable
3. Priorise toujours le CA et la conversion
4. Alerte sur les anomalies (CA bas, stock, etc.)
5. Propose des actions concrètes

FORMAT RÉPONSES:
- Utilise le markdown
- Bullet points pour les actions
- Emojis pour la lisibilité
- Maximum 500 mots sauf demande explicite`;

// ============================================================
// Express Server
// ============================================================
const app = express();
app.use(express.json());

// Serve static files (dashboard)
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// Shopify GraphQL
// ============================================================
async function shopifyGraphQL(query) {
    const response = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/graphql.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_TOKEN
        },
        body: JSON.stringify({ query })
    });
    return response.json();
}

async function getShopifyKPIs() {
    const today = new Date().toISOString().split('T')[0];
    const query = `{
        orders(first: 50, query: "created_at:>=${today}") {
            edges {
                node {
                    id
                    totalPriceSet { shopMoney { amount } }
                    createdAt
                }
            }
        }
    }`;
    
    try {
        const result = await shopifyGraphQL(query);
        const orders = result.data?.orders?.edges || [];
        const totalCA = orders.reduce((sum, o) => sum + parseFloat(o.node.totalPriceSet.shopMoney.amount), 0);
        const nbCommandes = orders.length;
        const panierMoyen = nbCommandes > 0 ? totalCA / nbCommandes : 0;
        
        return {
            date: today,
            nb_commandes: nbCommandes,
            ca_jour: totalCA.toFixed(2),
            panier_moyen: Math.round(panierMoyen),
            objectif: 3000,
            progression: ((totalCA / 3000) * 100).toFixed(1)
        };
    } catch (error) {
        console.error('Erreur Shopify:', error);
        return {
            date: today,
            nb_commandes: 0,
            ca_jour: "0.00",
            panier_moyen: 0,
            objectif: 3000,
            progression: "0.0"
        };
    }
}

// ============================================================
// Claude API
// ============================================================
async function askClaude(userMessage, context = {}) {
    const kpis = await getShopifyKPIs();
    
    const fullMessage = `
DONNÉES EN TEMPS RÉEL:
- Date: ${kpis.date}
- CA Jour: ${kpis.ca_jour}€ / 3 000€ objectif (${kpis.progression}%)
- Commandes: ${kpis.nb_commandes}
- Panier moyen: ${kpis.panier_moyen}€

QUESTION/DEMANDE:
${userMessage}
`;

    const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: fullMessage }]
    });
    
    return {
        message: response.content[0].text,
        kpis,
        tokens: response.usage
    };
}

// ============================================================
// API Routes
// ============================================================

// Root - serve dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', async (req, res) => {
    const kpis = await getShopifyKPIs();
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            anthropic: !!process.env.ANTHROPIC_API_KEY,
            supabase: !!process.env.SUPABASE_URL,
            shopify: !!process.env.SHOPIFY_STORE
        },
        kpis_sample: kpis
    });
});

// KPIs temps réel
app.get('/kpis', async (req, res) => {
    const kpis = await getShopifyKPIs();
    res.json(kpis);
});

// Briefing du jour
app.get('/briefing', async (req, res) => {
    try {
        const result = await askClaude(
            "Génère le briefing business du jour. Analyse la situation actuelle, identifie les alertes et donne les 3 priorités d'action."
        );
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Chat
app.post('/chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ success: false, error: 'Message requis' });
        }
        const result = await askClaude(message);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Tasks
app.get('/tasks', async (req, res) => {
    const { data, error } = await supabase
        .from('stella_tasks')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
    res.json({ tasks: data || [], error });
});

app.post('/tasks', async (req, res) => {
    const { title, description, priority = 'normal' } = req.body;
    const { data, error } = await supabase
        .from('stella_tasks')
        .insert({ title, description, priority, status: 'pending' })
        .select()
        .single();
    res.json({ task: data, error });
});

// ============================================================
// Cron Jobs
// ============================================================

// Briefing matin 8h Paris (7h UTC en hiver)
cron.schedule('0 7 * * *', async () => {
    console.log('⏰ Cron: Briefing matin');
    const result = await askClaude("Briefing matinal complet avec priorités du jour.");
    console.log('📋 Briefing généré:', result.message.substring(0, 200));
});

// Check KPIs toutes les heures
cron.schedule('0 * * * *', async () => {
    console.log('⏰ Cron: Check KPIs horaire');
    const kpis = await getShopifyKPIs();
    const progression = parseFloat(kpis.progression);
    const heure = new Date().getHours();
    const progressionAttendue = (heure / 24) * 100;
    
    if (progression < progressionAttendue - 20) {
        console.log(`🚨 ALERTE: CA en retard! ${kpis.ca_jour}€ vs objectif`);
        // TODO: Envoyer notification
    }
});

// Récap soir 20h Paris (19h UTC en hiver)
cron.schedule('0 19 * * *', async () => {
    console.log('⏰ Cron: Récap soir');
    const result = await askClaude("Récapitulatif de la journée: CA final, points forts, points à améliorer demain.");
    console.log('📊 Récap:', result.message.substring(0, 200));
});

// ============================================================
// Start Server
// ============================================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🌟 STELLA Brain démarré sur port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🔌 API: http://localhost:${PORT}/health`);
});
