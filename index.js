// STELLA v3.0 - Copilote Business Complet
// Remplace Claude.ai pour Benoit - Toute la connaissance du projet

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import express from 'express';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_PAT;
const GITHUB_REPO = 'bmapbenoit-ctrl/supercerveau-v2';

// ============================================================
// TOOLS - Toutes les capacités de STELLA
// ============================================================
const TOOLS = [
    { name: "shopify_kpis", description: "KPIs Shopify du jour (CA, commandes, panier)", input_schema: { type: "object", properties: {}, required: [] } },
    { name: "shopify_query", description: "Requête GraphQL Shopify (produits, commandes, clients)", input_schema: { type: "object", properties: { query: { type: "string", description: "Requête GraphQL Shopify Admin API" } }, required: ["query"] } },
    { name: "shopify_products", description: "Liste des produits avec filtres", input_schema: { type: "object", properties: { first: { type: "number" }, query: { type: "string" } }, required: [] } },
    { name: "supabase_query", description: "Requête SQL directe sur Supabase", input_schema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] } },
    { name: "supabase_select", description: "Select simple sur une table", input_schema: { type: "object", properties: { table: { type: "string" }, columns: { type: "string" }, filters: { type: "object" }, limit: { type: "number" } }, required: ["table"] } },
    { name: "supabase_insert", description: "Insert dans une table", input_schema: { type: "object", properties: { table: { type: "string" }, data: { type: "object" } }, required: ["table", "data"] } },
    { name: "supabase_update", description: "Update dans une table", input_schema: { type: "object", properties: { table: { type: "string" }, data: { type: "object" }, match: { type: "object" } }, required: ["table", "data", "match"] } },
    { name: "github_read", description: "Lire un fichier GitHub", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
    { name: "github_write", description: "Créer/modifier fichier GitHub (déclenche deploy)", input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, message: { type: "string" } }, required: ["path", "content", "message"] } },
    { name: "github_list", description: "Lister fichiers d'un dossier GitHub", input_schema: { type: "object", properties: { path: { type: "string" } }, required: [] } },
    { name: "memory_save", description: "Sauvegarder info en mémoire longue", input_schema: { type: "object", properties: { key: { type: "string" }, category: { type: "string" }, content: { type: "string" } }, required: ["key", "category", "content"] } },
    { name: "memory_search", description: "Chercher dans la mémoire", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "memory_list", description: "Lister toute la mémoire par catégorie", input_schema: { type: "object", properties: { category: { type: "string" } }, required: [] } },
    { name: "task_create", description: "Créer une tâche", input_schema: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, priority: { type: "string" }, due_date: { type: "string" } }, required: ["title"] } },
    { name: "task_list", description: "Lister les tâches", input_schema: { type: "object", properties: { status: { type: "string" } }, required: [] } },
    { name: "web_search", description: "Recherche web", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }
];

// ============================================================
// TOOL IMPLEMENTATIONS
// ============================================================
async function shopifyGraphQL(query) {
    const response = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_TOKEN },
        body: JSON.stringify({ query })
    });
    return response.json();
}

async function executeTool(name, input) {
    console.log(`🔧 Tool: ${name}`, JSON.stringify(input).substring(0, 100));
    try {
        switch (name) {
            case 'shopify_kpis': {
                const today = new Date().toISOString().split('T')[0];
                const query = `{ orders(first: 100, query: "created_at:>=${today}") { edges { node { totalPriceSet { shopMoney { amount } } createdAt } } } }`;
                const result = await shopifyGraphQL(query);
                const orders = result.data?.orders?.edges || [];
                const totalCA = orders.reduce((sum, o) => sum + parseFloat(o.node.totalPriceSet.shopMoney.amount), 0);
                return { 
                    date: today, 
                    ca_jour: totalCA.toFixed(2) + '€', 
                    nb_commandes: orders.length, 
                    panier_moyen: orders.length > 0 ? Math.round(totalCA / orders.length) + '€' : '0€', 
                    objectif: '3000€',
                    progression: ((totalCA / 3000) * 100).toFixed(1) + '%',
                    statut: totalCA >= 3000 ? '✅ Objectif atteint' : totalCA >= 2000 ? '🟡 En bonne voie' : '🔴 Sous objectif'
                };
            }
            case 'shopify_query': return await shopifyGraphQL(input.query);
            case 'shopify_products': {
                const first = input.first || 10;
                const q = input.query ? `, query: "${input.query}"` : '';
                const query = `{ products(first: ${first}${q}) { edges { node { id title handle status totalInventory priceRangeV2 { minVariantPrice { amount } } } } } }`;
                return await shopifyGraphQL(query);
            }
            case 'supabase_query': {
                const { data, error } = await supabase.rpc('exec_sql', { sql_query: input.sql });
                return { data, error: error?.message };
            }
            case 'supabase_select': {
                let q = supabase.from(input.table).select(input.columns || '*');
                if (input.filters) Object.entries(input.filters).forEach(([k, v]) => q = q.eq(k, v));
                if (input.limit) q = q.limit(input.limit);
                const { data, error } = await q;
                return { data, error: error?.message };
            }
            case 'supabase_insert': {
                const { data, error } = await supabase.from(input.table).insert(input.data).select();
                return { data, error: error?.message };
            }
            case 'supabase_update': {
                let q = supabase.from(input.table).update(input.data);
                Object.entries(input.match).forEach(([k, v]) => q = q.eq(k, v));
                const { data, error } = await q.select();
                return { data, error: error?.message };
            }
            case 'github_read': {
                const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${input.path}`, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                const d = await r.json();
                return d.content ? { content: Buffer.from(d.content, 'base64').toString('utf-8'), sha: d.sha } : { error: d.message };
            }
            case 'github_write': {
                let sha = null;
                const existing = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${input.path}`, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                const ed = await existing.json();
                if (ed.sha) sha = ed.sha;
                const body = { message: input.message, content: Buffer.from(input.content).toString('base64') };
                if (sha) body.sha = sha;
                const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${input.path}`, {
                    method: 'PUT', headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
                });
                const result = await r.json();
                return { success: !!result.commit, commit: result.commit?.sha?.substring(0,8), message: result.commit ? '✅ Fichier modifié, Railway redéploie automatiquement (~2min)' : result.message };
            }
            case 'github_list': {
                const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${input.path || ''}`, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                const d = await r.json();
                return Array.isArray(d) ? { files: d.map(f => ({ name: f.name, type: f.type, path: f.path })) } : { error: d.message };
            }
            case 'memory_save': {
                const { error } = await supabase.from('stella_memory').upsert({ key: input.key, category: input.category, content: input.content, updated_at: new Date().toISOString() }, { onConflict: 'key' });
                return { saved: !error, key: input.key, error: error?.message };
            }
            case 'memory_search': {
                const { data } = await supabase.from('stella_memory').select('*').or(`content.ilike.%${input.query}%,key.ilike.%${input.query}%`).limit(10);
                return { results: data };
            }
            case 'memory_list': {
                let q = supabase.from('stella_memory').select('*').order('updated_at', { ascending: false });
                if (input.category) q = q.eq('category', input.category);
                const { data } = await q.limit(20);
                return { memories: data };
            }
            case 'task_create': {
                const { data, error } = await supabase.from('stella_tasks').insert({ 
                    title: input.title, 
                    description: input.description || '', 
                    priority: input.priority || 'normal', 
                    status: 'pending',
                    due_date: input.due_date 
                }).select();
                return { task: data?.[0], error: error?.message };
            }
            case 'task_list': {
                let q = supabase.from('stella_tasks').select('*').order('created_at', { ascending: false });
                if (input.status) q = q.eq('status', input.status);
                const { data } = await q.limit(20);
                return { tasks: data };
            }
            case 'web_search': {
                const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(input.query)}&format=json`);
                const d = await r.json();
                return { results: d.RelatedTopics?.slice(0, 5).map(t => ({ text: t.Text, url: t.FirstURL })) || [] };
            }
            default: return { error: `Outil inconnu: ${name}` };
        }
    } catch (e) {
        console.error(`Tool error ${name}:`, e);
        return { error: e.message };
    }
}

// ============================================================
// SYSTEM PROMPT - Le cerveau de STELLA
// ============================================================
const SYSTEM_PROMPT = `Tu es STELLA, le copilote business IA de Benoit HODIESNE.

## TON IDENTITÉ
- Tu remplaces Claude.ai comme interlocuteur principal
- Tu as accès à TOUTE la mémoire et l'historique du projet
- Tu peux agir directement (pas besoin d'un autre chat)

## ENTREPRISES
- **BHTC EURL** : Holding + Planetebeauty.com (e-commerce parfumerie niche)
- **Lab Olfactif** : Future boutique physique luxe (ouverture sept 2026, Polygone Riviera)

## CHIFFRES CLÉS
- CA 2025 cible : 750 000€ | Objectif quotidien : 3 000€ HT
- Clients : 29 641 | Produits : ~427 | Marge brute : 41%
- Panier moyen actuel : 177€ → cible 200€

## TES 4 MODULES
1. **PERCEVOIR** : Tu collectes les données (Shopify, GA4, Ads...)
2. **PENSER** : Tu analyses, scores, recommandes
3. **AGIR** : Tu exécutes (modifier code, créer tâches, alertes)
4. **APPRENDRE** : Tu mémorises pour t'améliorer

## 28 FONCTIONS À DÉPLOYER
- 3 actives (11%) | 8 specs validées (29%) | 17 à spécifier (60%)
- Priorités : #6 RGPD, #5 SEO, #1 Bandeau, #8 Tracking
- Économies cible : 342€/mois = 4 104€/an
- Livraison : Mars 2026

## TES OUTILS (UTILISE-LES!)
- **shopify_kpis** : KPIs temps réel
- **shopify_query** / **shopify_products** : Données boutique
- **supabase_*** : Base de données
- **github_*** : Lire/modifier code → déploie auto sur Railway
- **memory_*** : Ta mémoire persistante
- **task_*** : Gestion des tâches

## RÈGLES ABSOLUES
1. **ANTI-HALLUCINATION** : JAMAIS de chiffre sans utiliser un outil pour vérifier
2. **PROACTIF** : Propose des actions concrètes, ne reste pas passif
3. **DIRECT** : Pas de blabla, va à l'essentiel
4. **AUTONOME** : Fais les actions toi-même quand c'est niveau 1-2-3
5. **MÉMOIRE** : Sauvegarde les décisions importantes

## NIVEAUX DE DÉCISION
- **1-2-3** : Tu fais directement (95% des cas)
- **4-5** : Tu demandes validation à Benoit

## AU DÉMARRAGE
Utilise memory_list pour charger ton contexte, puis réponds de façon informée.

## CONCURRENTS À SURVEILLER
Notino, Nose Paris, JOVOY Paris, 50ml, BeautyTheShop, Incenza, Odorare, Première Avenue`;

// ============================================================
// CONVERSATIONS PERSISTANTES
// ============================================================
async function getConversation(sessionId) {
    const { data } = await supabase.from('stella_conversations').select('messages').eq('session_id', sessionId).single();
    return data?.messages || [];
}

async function saveConversation(sessionId, messages) {
    await supabase.from('stella_conversations').upsert({ 
        session_id: sessionId, 
        messages: messages,
        updated_at: new Date().toISOString()
    }, { onConflict: 'session_id' });
}

// ============================================================
// CLAUDE API AVEC TOOLS
// ============================================================
async function askClaude(userMessage, sessionId) {
    // Charger conversation existante
    let history = await getConversation(sessionId);
    
    // Charger mémoire complète pour le contexte
    const { data: memories } = await supabase.from('stella_memory').select('*').order('category').limit(30);
    const memoryContext = memories?.length > 0 
        ? `\n\n## MÉMOIRE PROJET (${memories.length} entrées)\n${memories.map(m => `**[${m.category}] ${m.key}**: ${m.content}`).join('\n\n')}`
        : '';
    
    // Ajouter le message
    history.push({ role: 'user', content: userMessage });
    
    let response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: SYSTEM_PROMPT + memoryContext,
        tools: TOOLS,
        messages: history
    });
    
    // Boucle d'exécution des outils
    let iterations = 0;
    while (response.stop_reason === 'tool_use' && iterations < 15) {
        iterations++;
        const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
        const toolResults = [];
        
        for (const toolUse of toolUseBlocks) {
            const result = await executeTool(toolUse.name, toolUse.input);
            toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) });
        }
        
        history.push({ role: 'assistant', content: response.content });
        history.push({ role: 'user', content: toolResults });
        
        response = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            system: SYSTEM_PROMPT + memoryContext,
            tools: TOOLS,
            messages: history
        });
    }
    
    // Sauvegarder
    history.push({ role: 'assistant', content: response.content });
    if (history.length > 40) history = history.slice(-40);
    await saveConversation(sessionId, history);
    
    const textContent = response.content.find(b => b.type === 'text');
    return { message: textContent?.text || 'Action effectuée.', tokens: response.usage };
}

// ============================================================
// EXPRESS SERVER
// ============================================================
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/health', (req, res) => res.json({ 
    status: 'healthy', 
    version: '3.0.0-copilote',
    name: 'STELLA',
    capabilities: TOOLS.map(t => t.name)
}));

app.get('/kpis', async (req, res) => {
    const kpis = await executeTool('shopify_kpis', {});
    res.json(kpis);
});

app.post('/chat', async (req, res) => {
    try {
        const { message, session_id = 'benoit-main' } = req.body;
        if (!message) return res.status(400).json({ success: false, error: 'Message requis' });
        console.log(`💬 [${session_id}] ${message.substring(0, 50)}...`);
        const result = await askClaude(message, session_id);
        res.json({ success: true, ...result });
    } catch (e) {
        console.error('Chat error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/upload', async (req, res) => {
    try {
        const { filename, content, session_id = 'benoit-main' } = req.body;
        await supabase.from('stella_memory').upsert({
            key: `upload_${filename}_${Date.now()}`,
            category: 'uploaded_file',
            content: `Fichier: ${filename}\n${content.substring(0, 50000)}`,
            updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
        const result = await askClaude(`Analyse ce fichier uploadé: ${filename}\n\nContenu (extrait):\n${content.substring(0, 5000)}`, session_id);
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/conversations/:session_id', async (req, res) => {
    const messages = await getConversation(req.params.session_id);
    res.json({ messages });
});

app.get('/memory', async (req, res) => {
    const { data } = await supabase.from('stella_memory').select('*').order('category').limit(50);
    res.json({ memories: data });
});

// ============================================================
// CRON JOBS
// ============================================================
cron.schedule('0 8 * * *', async () => {
    console.log('📅 Briefing matinal...');
    await askClaude("Briefing matinal complet: KPIs, tâches prioritaires, alertes.", 'cron-briefing');
});

cron.schedule('0 20 * * *', async () => {
    console.log('📊 Récap du soir...');
    await askClaude("Récap de la journée. Sauvegarde les points clés en mémoire.", 'cron-recap');
});

// Check KPIs toutes les heures
cron.schedule('0 * * * *', async () => {
    const kpis = await executeTool('shopify_kpis', {});
    console.log(`📊 KPIs: ${kpis.ca_jour} (${kpis.progression})`);
});

// ============================================================
// START
// ============================================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`⭐ STELLA v3.0 Copilote sur port ${PORT}`);
    console.log(`📚 ${TOOLS.length} outils disponibles`);
});
