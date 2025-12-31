// STELLA Brain v2.1 - Autonome + Upload + Conversations Persistantes

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
// TOOLS
// ============================================================
const TOOLS = [
    { name: "shopify_kpis", description: "Récupère les KPIs Shopify du jour", input_schema: { type: "object", properties: {}, required: [] } },
    { name: "shopify_query", description: "Exécute une requête GraphQL Shopify", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "supabase_select", description: "Récupère des données d'une table Supabase", input_schema: { type: "object", properties: { table: { type: "string" }, columns: { type: "string" }, limit: { type: "number" } }, required: ["table"] } },
    { name: "supabase_insert", description: "Insère des données dans une table", input_schema: { type: "object", properties: { table: { type: "string" }, data: { type: "object" } }, required: ["table", "data"] } },
    { name: "supabase_tables", description: "Liste toutes les tables Supabase", input_schema: { type: "object", properties: {}, required: [] } },
    { name: "github_read_file", description: "Lit un fichier sur GitHub", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
    { name: "github_write_file", description: "Crée/modifie un fichier sur GitHub (déclenche déploiement)", input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, message: { type: "string" } }, required: ["path", "content", "message"] } },
    { name: "github_list_files", description: "Liste les fichiers d'un dossier GitHub", input_schema: { type: "object", properties: { path: { type: "string" } }, required: [] } },
    { name: "memory_save", description: "Sauvegarde une info en mémoire longue", input_schema: { type: "object", properties: { key: { type: "string" }, category: { type: "string" }, content: { type: "string" } }, required: ["key", "category", "content"] } },
    { name: "memory_search", description: "Recherche dans la mémoire", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "create_task", description: "Crée une tâche", input_schema: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, priority: { type: "string" } }, required: ["title"] } }
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
    console.log(`🔧 Tool: ${name}`);
    try {
        switch (name) {
            case 'shopify_kpis': {
                const today = new Date().toISOString().split('T')[0];
                const query = `{ orders(first: 50, query: "created_at:>=${today}") { edges { node { totalPriceSet { shopMoney { amount } } } } } }`;
                const result = await shopifyGraphQL(query);
                const orders = result.data?.orders?.edges || [];
                const totalCA = orders.reduce((sum, o) => sum + parseFloat(o.node.totalPriceSet.shopMoney.amount), 0);
                return { date: today, ca_jour: totalCA.toFixed(2), nb_commandes: orders.length, panier_moyen: orders.length > 0 ? Math.round(totalCA / orders.length) : 0, objectif: 3000, progression: ((totalCA / 3000) * 100).toFixed(1) + '%' };
            }
            case 'shopify_query': return await shopifyGraphQL(input.query);
            case 'supabase_select': {
                let q = supabase.from(input.table).select(input.columns || '*');
                if (input.limit) q = q.limit(input.limit);
                const { data, error } = await q;
                return { data, error: error?.message };
            }
            case 'supabase_insert': {
                const { data, error } = await supabase.from(input.table).insert(input.data).select();
                return { data, error: error?.message };
            }
            case 'supabase_tables': {
                const { data, error } = await supabase.rpc('exec_sql', { sql_query: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'" });
                return { tables: data, error: error?.message };
            }
            case 'github_read_file': {
                const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${input.path}`, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                const d = await r.json();
                return d.content ? { content: Buffer.from(d.content, 'base64').toString('utf-8'), sha: d.sha } : { error: d.message };
            }
            case 'github_write_file': {
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
                return { success: !!result.commit, commit: result.commit?.sha, message: result.commit ? 'Fichier modifié, déploiement Railway en cours...' : result.message };
            }
            case 'github_list_files': {
                const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${input.path || ''}`, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                const d = await r.json();
                return Array.isArray(d) ? { files: d.map(f => ({ name: f.name, type: f.type, path: f.path })) } : { error: d.message };
            }
            case 'memory_save': {
                const { error } = await supabase.from('stella_memory').upsert({ key: input.key, category: input.category, content: input.content, updated_at: new Date().toISOString() }, { onConflict: 'key' });
                return { saved: !error, error: error?.message };
            }
            case 'memory_search': {
                const { data, error } = await supabase.from('stella_memory').select('*').ilike('content', `%${input.query}%`).limit(10);
                return { results: data, error: error?.message };
            }
            case 'create_task': {
                const { data, error } = await supabase.from('stella_tasks').insert({ title: input.title, description: input.description || '', priority: input.priority || 'normal', status: 'pending' }).select();
                return { task: data?.[0], error: error?.message };
            }
            default: return { error: `Outil inconnu: ${name}` };
        }
    } catch (e) {
        return { error: e.message };
    }
}

// ============================================================
// SYSTEM PROMPT
// ============================================================
const SYSTEM_PROMPT = `Tu es STELLA, l'IA autonome de Planetebeauty.com. Tu peux TOUT faire.

## CONTEXTE
- E-commerce parfumerie niche | CA: 750K€/an | Objectif: 3000€/jour
- Clients: 29 641 | Marge: 41% | Panier cible: 200€

## TES CAPACITÉS (utilise les outils!)
- Shopify: KPIs, produits, commandes
- Supabase: Lire/écrire base de données
- GitHub: Lire/modifier code → déploie automatiquement sur Railway
- Mémoire: Sauvegarder infos importantes

## RÈGLES
1. JAMAIS inventer de données - utilise les outils
2. Sois directe et actionnable
3. Quand on te demande de modifier du code, FAIS-LE avec github_write_file
4. Sauvegarde les décisions importantes avec memory_save

## SI ON TE DEMANDE D'AJOUTER UNE FONCTIONNALITÉ
1. Lis le code actuel avec github_read_file
2. Modifie-le
3. Pousse avec github_write_file
4. Confirme que le déploiement est lancé`;

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
    
    // Charger mémoire
    const { data: memories } = await supabase.from('stella_memory').select('*').order('updated_at', { ascending: false }).limit(10);
    const memoryContext = memories?.length > 0 ? `\n\nMÉMOIRE:\n${memories.map(m => `[${m.category}] ${m.key}: ${m.content.substring(0,150)}`).join('\n')}` : '';
    
    // Ajouter le nouveau message
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
    while (response.stop_reason === 'tool_use' && iterations < 10) {
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
    
    // Sauvegarder la réponse finale
    history.push({ role: 'assistant', content: response.content });
    
    // Garder max 30 messages
    if (history.length > 30) history = history.slice(-30);
    await saveConversation(sessionId, history);
    
    const textContent = response.content.find(b => b.type === 'text');
    return { message: textContent?.text || 'Action effectuée.', tokens: response.usage };
}

// ============================================================
// EXPRESS
// ============================================================
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/health', (req, res) => res.json({ status: 'healthy', version: '2.1.0', capabilities: TOOLS.map(t => t.name) }));

app.get('/kpis', async (req, res) => {
    const kpis = await executeTool('shopify_kpis', {});
    res.json(kpis);
});

app.get('/briefing', async (req, res) => {
    try {
        const result = await askClaude("Briefing du jour. Utilise shopify_kpis et donne 3 priorités.", 'briefing');
        res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/chat', async (req, res) => {
    try {
        const { message, session_id = 'default' } = req.body;
        if (!message) return res.status(400).json({ success: false, error: 'Message requis' });
        const result = await askClaude(message, session_id);
        res.json({ success: true, ...result });
    } catch (e) {
        console.error('Chat error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Upload fichier en base64
app.post('/upload', async (req, res) => {
    try {
        const { filename, content, session_id = 'default' } = req.body;
        // Sauvegarder en mémoire
        await supabase.from('stella_memory').upsert({
            key: `file_${filename}_${Date.now()}`,
            category: 'uploaded_file',
            content: `Fichier: ${filename}\nContenu:\n${content.substring(0, 50000)}`,
            updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
        
        // Demander à STELLA d'analyser
        const result = await askClaude(`Analyse ce fichier qui vient d'être uploadé: ${filename}\n\nContenu:\n${content.substring(0, 10000)}`, session_id);
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/conversations/:session_id', async (req, res) => {
    const messages = await getConversation(req.params.session_id);
    res.json({ messages });
});

// ============================================================
// CRON
// ============================================================
cron.schedule('0 7 * * *', () => askClaude("Briefing matinal. Sauvegarde les points clés.", 'cron-morning'));
cron.schedule('0 19 * * *', () => askClaude("Récap de la journée.", 'cron-evening'));

// ============================================================
// START
// ============================================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🌟 STELLA v2.1 sur port ${PORT}`));
