// STELLA Brain - Agent Autonome COMPLET
// Peut coder, déployer, modifier l'architecture

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
const GITHUB_TOKEN = process.env.GITHUB_PAT;
const GITHUB_REPO = 'bmapbenoit-ctrl/supercerveau-v2';

// ============================================================
// TOOLS - Ce que STELLA peut faire
// ============================================================
const TOOLS = [
    {
        name: "shopify_kpis",
        description: "Récupère les KPIs Shopify du jour (CA, commandes, panier moyen)",
        input_schema: { type: "object", properties: {}, required: [] }
    },
    {
        name: "shopify_query",
        description: "Exécute une requête GraphQL Shopify pour récupérer des données (produits, commandes, clients)",
        input_schema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Requête GraphQL Shopify" }
            },
            required: ["query"]
        }
    },
    {
        name: "supabase_query",
        description: "Exécute une requête SQL sur Supabase (SELECT, INSERT, UPDATE, DELETE, CREATE TABLE)",
        input_schema: {
            type: "object",
            properties: {
                sql: { type: "string", description: "Requête SQL à exécuter" }
            },
            required: ["sql"]
        }
    },
    {
        name: "supabase_select",
        description: "Récupère des données d'une table Supabase",
        input_schema: {
            type: "object",
            properties: {
                table: { type: "string", description: "Nom de la table" },
                columns: { type: "string", description: "Colonnes à sélectionner (défaut: *)" },
                filters: { type: "object", description: "Filtres {colonne: valeur}" },
                limit: { type: "number", description: "Nombre max de résultats" }
            },
            required: ["table"]
        }
    },
    {
        name: "supabase_insert",
        description: "Insère des données dans une table Supabase",
        input_schema: {
            type: "object",
            properties: {
                table: { type: "string", description: "Nom de la table" },
                data: { type: "object", description: "Données à insérer" }
            },
            required: ["table", "data"]
        }
    },
    {
        name: "github_read_file",
        description: "Lit le contenu d'un fichier sur GitHub",
        input_schema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Chemin du fichier (ex: src/index.js)" }
            },
            required: ["path"]
        }
    },
    {
        name: "github_write_file",
        description: "Crée ou modifie un fichier sur GitHub (déclenche un déploiement Railway)",
        input_schema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Chemin du fichier" },
                content: { type: "string", description: "Contenu du fichier" },
                message: { type: "string", description: "Message de commit" }
            },
            required: ["path", "content", "message"]
        }
    },
    {
        name: "github_list_files",
        description: "Liste les fichiers d'un dossier sur GitHub",
        input_schema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Chemin du dossier (défaut: racine)" }
            },
            required: []
        }
    },
    {
        name: "web_search",
        description: "Recherche sur le web (via DuckDuckGo)",
        input_schema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Recherche à effectuer" }
            },
            required: ["query"]
        }
    },
    {
        name: "memory_save",
        description: "Sauvegarde une information importante dans la mémoire longue",
        input_schema: {
            type: "object",
            properties: {
                key: { type: "string", description: "Clé unique (ex: 'architecture_decision_1')" },
                category: { type: "string", description: "Catégorie (business, technical, decision, task)" },
                content: { type: "string", description: "Contenu à mémoriser" }
            },
            required: ["key", "category", "content"]
        }
    },
    {
        name: "memory_search",
        description: "Recherche dans la mémoire longue",
        input_schema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Terme de recherche" },
                category: { type: "string", description: "Filtrer par catégorie (optionnel)" }
            },
            required: ["query"]
        }
    },
    {
        name: "create_task",
        description: "Crée une tâche à faire",
        input_schema: {
            type: "object",
            properties: {
                title: { type: "string", description: "Titre de la tâche" },
                description: { type: "string", description: "Description détaillée" },
                priority: { type: "string", enum: ["low", "normal", "high", "urgent"], description: "Priorité" }
            },
            required: ["title"]
        }
    }
];

// ============================================================
// TOOL IMPLEMENTATIONS
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

async function executeTool(name, input) {
    console.log(`🔧 Tool: ${name}`, JSON.stringify(input).substring(0, 100));
    
    switch (name) {
        case 'shopify_kpis': {
            const today = new Date().toISOString().split('T')[0];
            const query = `{
                orders(first: 50, query: "created_at:>=${today}") {
                    edges { node { id totalPriceSet { shopMoney { amount } } } }
                }
            }`;
            const result = await shopifyGraphQL(query);
            const orders = result.data?.orders?.edges || [];
            const totalCA = orders.reduce((sum, o) => sum + parseFloat(o.node.totalPriceSet.shopMoney.amount), 0);
            return {
                date: today,
                ca_jour: totalCA.toFixed(2),
                nb_commandes: orders.length,
                panier_moyen: orders.length > 0 ? Math.round(totalCA / orders.length) : 0,
                objectif: 3000,
                progression: ((totalCA / 3000) * 100).toFixed(1) + '%'
            };
        }
        
        case 'shopify_query': {
            return await shopifyGraphQL(input.query);
        }
        
        case 'supabase_query': {
            const { data, error } = await supabase.rpc('exec_sql', { sql_query: input.sql }).single();
            if (error) {
                // Fallback: essayer directement si c'est un SELECT simple
                const match = input.sql.match(/SELECT .* FROM (\w+)/i);
                if (match) {
                    const { data: d2, error: e2 } = await supabase.from(match[1]).select('*').limit(50);
                    return { data: d2, error: e2?.message };
                }
                return { error: error.message };
            }
            return { data };
        }
        
        case 'supabase_select': {
            let query = supabase.from(input.table).select(input.columns || '*');
            if (input.filters) {
                for (const [key, value] of Object.entries(input.filters)) {
                    query = query.eq(key, value);
                }
            }
            if (input.limit) query = query.limit(input.limit);
            const { data, error } = await query;
            return { data, error: error?.message };
        }
        
        case 'supabase_insert': {
            const { data, error } = await supabase.from(input.table).insert(input.data).select();
            return { data, error: error?.message };
        }
        
        case 'github_read_file': {
            const response = await fetch(
                `https://api.github.com/repos/${GITHUB_REPO}/contents/${input.path}`,
                { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } }
            );
            const data = await response.json();
            if (data.content) {
                return { content: Buffer.from(data.content, 'base64').toString('utf-8'), sha: data.sha };
            }
            return { error: data.message };
        }
        
        case 'github_write_file': {
            // D'abord récupérer le SHA si le fichier existe
            let sha = null;
            const existing = await fetch(
                `https://api.github.com/repos/${GITHUB_REPO}/contents/${input.path}`,
                { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } }
            );
            const existingData = await existing.json();
            if (existingData.sha) sha = existingData.sha;
            
            const body = {
                message: input.message,
                content: Buffer.from(input.content).toString('base64')
            };
            if (sha) body.sha = sha;
            
            const response = await fetch(
                `https://api.github.com/repos/${GITHUB_REPO}/contents/${input.path}`,
                {
                    method: 'PUT',
                    headers: {
                        'Authorization': `token ${GITHUB_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                }
            );
            const result = await response.json();
            return { 
                success: !!result.commit,
                commit: result.commit?.sha,
                message: result.commit ? 'Fichier modifié, déploiement Railway en cours...' : result.message
            };
        }
        
        case 'github_list_files': {
            const response = await fetch(
                `https://api.github.com/repos/${GITHUB_REPO}/contents/${input.path || ''}`,
                { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } }
            );
            const data = await response.json();
            if (Array.isArray(data)) {
                return { files: data.map(f => ({ name: f.name, type: f.type, path: f.path })) };
            }
            return { error: data.message };
        }
        
        case 'web_search': {
            const response = await fetch(
                `https://api.duckduckgo.com/?q=${encodeURIComponent(input.query)}&format=json`
            );
            const data = await response.json();
            return {
                results: data.RelatedTopics?.slice(0, 5).map(t => ({
                    title: t.Text?.substring(0, 100),
                    url: t.FirstURL
                })) || [],
                abstract: data.Abstract
            };
        }
        
        case 'memory_save': {
            const { data, error } = await supabase.from('stella_memory').upsert({
                key: input.key,
                category: input.category,
                content: input.content,
                updated_at: new Date().toISOString()
            }, { onConflict: 'key' }).select();
            return { saved: !error, data, error: error?.message };
        }
        
        case 'memory_search': {
            let query = supabase.from('stella_memory')
                .select('*')
                .ilike('content', `%${input.query}%`);
            if (input.category) query = query.eq('category', input.category);
            const { data, error } = await query.limit(10);
            return { results: data, error: error?.message };
        }
        
        case 'create_task': {
            const { data, error } = await supabase.from('stella_tasks').insert({
                title: input.title,
                description: input.description || '',
                priority: input.priority || 'normal',
                status: 'pending'
            }).select();
            return { task: data?.[0], error: error?.message };
        }
        
        default:
            return { error: `Outil inconnu: ${name}` };
    }
}

// ============================================================
// SYSTEM PROMPT COMPLET
// ============================================================
const SYSTEM_PROMPT = `Tu es STELLA, l'IA autonome de Planetebeauty.com. Tu peux TOUT faire.

## CONTEXTE BUSINESS
- Site e-commerce parfumerie de niche
- CA annuel: 750 000€ HT | Objectif jour: 3 000€
- Clients: 29 641 | Marge: 41% | Panier cible: 200€

## TES CAPACITÉS (utilise les outils)
- **Shopify**: KPIs, produits, commandes, clients
- **Supabase**: Lire/écrire base de données, créer tables
- **GitHub**: Lire/modifier code, déclencher déploiements Railway
- **Web**: Rechercher des informations
- **Mémoire**: Sauvegarder/retrouver des infos importantes

## RÈGLES ABSOLUES
1. ANTI-HALLUCINATION: Utilise TOUJOURS les outils pour vérifier. Ne jamais inventer.
2. AUTONOMIE: Fais les actions toi-même, ne demande pas "veux-tu que je..."
3. MÉMOIRE: Sauvegarde les décisions importantes avec memory_save
4. DÉPLOIEMENT: Quand tu modifies du code, ça déploie automatiquement

## ARCHITECTURE PROJET
- Backend: Railway (Node.js)
- Base: Supabase (PostgreSQL)
- Cache: Redis Upstash
- Shop: Shopify (planetemode.myshopify.com)
- Repo: github.com/bmapbenoit-ctrl/supercerveau-v2

## FORMAT RÉPONSES
- Direct, concis, actionnable
- Markdown avec emojis
- Montre ce que tu as fait (pas juste ce que tu "pourrais" faire)`;

// ============================================================
// CLAUDE API AVEC TOOLS
// ============================================================
async function askClaude(userMessage, conversationHistory = []) {
    // Charger le contexte mémoire
    const { data: memories } = await supabase
        .from('stella_memory')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(20);
    
    const memoryContext = memories?.length > 0 
        ? `\n\n## MÉMOIRE RÉCENTE\n${memories.map(m => `- [${m.category}] ${m.key}: ${m.content.substring(0, 200)}`).join('\n')}`
        : '';
    
    const messages = [
        ...conversationHistory,
        { role: "user", content: userMessage }
    ];
    
    let response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: SYSTEM_PROMPT + memoryContext,
        tools: TOOLS,
        messages
    });
    
    // Boucle d'exécution des outils
    while (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
        const toolResults = [];
        
        for (const toolUse of toolUseBlocks) {
            const result = await executeTool(toolUse.name, toolUse.input);
            toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: JSON.stringify(result)
            });
        }
        
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });
        
        response = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            system: SYSTEM_PROMPT + memoryContext,
            tools: TOOLS,
            messages
        });
    }
    
    const textContent = response.content.find(b => b.type === 'text');
    return {
        message: textContent?.text || 'Pas de réponse',
        tokens: response.usage
    };
}

// ============================================================
// EXPRESS SERVER
// ============================================================
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Conversation storage (in-memory, reset on restart)
const conversations = new Map();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', async (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '2.0.0-autonomous',
        capabilities: TOOLS.map(t => t.name)
    });
});

app.get('/kpis', async (req, res) => {
    const kpis = await executeTool('shopify_kpis', {});
    res.json(kpis);
});

app.get('/briefing', async (req, res) => {
    try {
        const result = await askClaude(
            "Génère le briefing du jour. Utilise shopify_kpis pour les données réelles. Analyse et donne 3 priorités."
        );
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/chat', async (req, res) => {
    try {
        const { message, session_id = 'default' } = req.body;
        if (!message) {
            return res.status(400).json({ success: false, error: 'Message requis' });
        }
        
        // Récupérer l'historique de conversation
        const history = conversations.get(session_id) || [];
        
        const result = await askClaude(message, history);
        
        // Sauvegarder dans l'historique
        history.push({ role: 'user', content: message });
        history.push({ role: 'assistant', content: [{ type: 'text', text: result.message }] });
        
        // Garder max 20 messages
        if (history.length > 40) history.splice(0, 2);
        conversations.set(session_id, history);
        
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/tasks', async (req, res) => {
    const { data, error } = await supabase
        .from('stella_tasks')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
    res.json({ tasks: data || [], error: error?.message });
});

app.get('/memory', async (req, res) => {
    const { data, error } = await supabase
        .from('stella_memory')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(50);
    res.json({ memories: data || [], error: error?.message });
});

// ============================================================
// CRON JOBS
// ============================================================
cron.schedule('0 7 * * *', async () => {
    console.log('⏰ Briefing matin');
    await askClaude("Briefing matinal. Sauvegarde les points clés avec memory_save.");
});

cron.schedule('0 * * * *', async () => {
    const kpis = await executeTool('shopify_kpis', {});
    const progression = parseFloat(kpis.progression);
    const heure = new Date().getHours();
    if (progression < (heure / 24) * 100 - 20) {
        console.log('🚨 CA en retard!');
    }
});

// ============================================================
// START
// ============================================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🌟 STELLA Autonome v2.0 sur port ${PORT}`);
    console.log(`🔧 Outils: ${TOOLS.map(t => t.name).join(', ')}`);
});
