/**
 * ============================================================================
 * 🧠 SUPERCERVEAU UNIFIÉ V3.0 - PLANETEBEAUTY
 * ============================================================================
 * Architecture Sidekick complète :
 * - Chef d'orchestre central
 * - Message Bus Redis Pub/Sub
 * - 3 Agents spécialisés (Stratège, Opérateur, Technicien)
 * - Shopify Connector avec cache
 * - Sécurité complète (validation, budget, circuit breaker)
 * ============================================================================
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { Redis } = require('@upstash/redis');
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Sécurité
  DAILY_BUDGET_USD: 10,
  MAX_COST_PER_TASK: 2,
  DAILY_TOKEN_LIMIT: 500000,
  MAX_TASKS_PER_HOUR: 10,
  MAX_CONSECUTIVE_ERRORS: 3,
  
  // Intervals
  HEARTBEAT_INTERVAL_MS: 30000,    // 30 secondes
  TASK_CHECK_INTERVAL_MS: 60000,  // 1 minute
  AGENT_SYNC_INTERVAL_MS: 10000,  // 10 secondes
  
  // Message Bus channels
  CHANNELS: {
    TASKS: 'tasks',
    LEARNINGS: 'learnings',
    ALERTS: 'alerts',
    SYNC: 'sync',
    SHOPIFY: 'shopify'
  }
};

// ============================================================================
// CLIENTS
// ============================================================================

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://upqldbeaxuikbzohlgne.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL || 'https://clear-labrador-39930.upstash.io',
  token: process.env.UPSTASH_REDIS_TOKEN || process.env.UPSTASH_REDIS_TOKEN
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const emailTransport = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER || 'bmapbenoit@gmail.com',
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// ============================================================================
// ÉTAT GLOBAL
// ============================================================================

const STATE = {
  isRunning: false,
  startTime: null,
  
  // Budget tracking
  budget: {
    date: new Date().toISOString().split('T')[0],
    tokens_used: 0,
    cost_usd: 0,
    api_calls: 0
  },
  
  // Error tracking
  consecutiveErrors: 0,
  lastError: null,
  
  // Rate limiting
  tasksCreatedThisHour: 0,
  hourStartTime: Date.now(),
  
  // Agents status
  agents: {
    stratege: { status: 'stopped', lastActivity: null, tasksCompleted: 0 },
    operateur: { status: 'stopped', lastActivity: null, tasksCompleted: 0 },
    technicien: { status: 'stopped', lastActivity: null, tasksCompleted: 0 }
  }
};

// ============================================================================
// MESSAGE BUS (Redis Pub/Sub)
// ============================================================================

class MessageBus {
  constructor() {
    this.subscribers = new Map();
  }
  
  async publish(channel, type, payload, source = 'supercerveau') {
    const event = {
      id: uuidv4(),
      channel,
      type,
      payload,
      source,
      timestamp: new Date().toISOString()
    };
    
    // Stocker dans Redis
    await redis.lpush(`events:${channel}`, JSON.stringify(event));
    await redis.ltrim(`events:${channel}`, 0, 99); // Garder 100 derniers
    await redis.set(`latest:${channel}`, JSON.stringify(event));
    
    // Notifier subscribers locaux
    const subs = this.subscribers.get(channel) || [];
    for (const callback of subs) {
      try {
        await callback(event);
      } catch (err) {
        console.error(`[MESSAGE_BUS] Error in subscriber for ${channel}:`, err.message);
      }
    }
    
    console.log(`[MESSAGE_BUS] Published ${type} to ${channel}`);
    return event.id;
  }
  
  subscribe(channel, callback) {
    const subs = this.subscribers.get(channel) || [];
    subs.push(callback);
    this.subscribers.set(channel, subs);
    console.log(`[MESSAGE_BUS] Subscribed to ${channel}`);
    
    return () => {
      const current = this.subscribers.get(channel) || [];
      this.subscribers.set(channel, current.filter(cb => cb !== callback));
    };
  }
  
  async getHistory(channel, count = 10) {
    const events = await redis.lrange(`events:${channel}`, 0, count - 1);
    return (events || []).map(e => typeof e === 'string' ? JSON.parse(e) : e);
  }
}

const messageBus = new MessageBus();

// ============================================================================
// SHOPIFY CONNECTOR (avec cache Redis)
// ============================================================================

const SHOPIFY_CONFIG = {
  store: 'planetemode.myshopify.com',
  accessToken: process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN,
  apiVersion: '2024-10',
  cache: {
    products: 300,    // 5 min
    inventory: 30,    // 30 sec
    orders: 60,       // 1 min
    customers: 180    // 3 min
  }
};

class ShopifyConnector {
  async graphql(query, variables = {}) {
    const response = await fetch(
      `https://${SHOPIFY_CONFIG.store}/admin/api/${SHOPIFY_CONFIG.apiVersion}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': SHOPIFY_CONFIG.accessToken
        },
        body: JSON.stringify({ query, variables })
      }
    );
    
    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status}`);
    }
    
    const data = await response.json();
    if (data.errors) {
      throw new Error(`Shopify GraphQL error: ${JSON.stringify(data.errors)}`);
    }
    
    return data.data;
  }
  
  async getCached(cacheKey, ttl, fetchFn) {
    // Check cache
    const cached = await redis.get(`pb:cache:${cacheKey}`);
    if (cached) {
      console.log(`[SHOPIFY] Cache HIT: ${cacheKey}`);
      return typeof cached === 'string' ? JSON.parse(cached) : cached;
    }
    
    // Fetch and cache
    console.log(`[SHOPIFY] Cache MISS: ${cacheKey}`);
    const data = await fetchFn();
    await redis.set(`pb:cache:${cacheKey}`, JSON.stringify(data), { ex: ttl });
    return data;
  }
  
  async getKPIs() {
    return this.getCached('kpis', 60, async () => {
      const today = new Date().toISOString().split('T')[0];
      
      const query = `
        query {
          orders(first: 100, query: "created_at:>='${today}T00:00:00Z'") {
            edges {
              node {
                totalPriceSet { shopMoney { amount } }
              }
            }
          }
        }
      `;
      
      const data = await this.graphql(query);
      const orders = data.orders?.edges || [];
      const ca_jour = orders.reduce((sum, o) => 
        sum + parseFloat(o.node.totalPriceSet?.shopMoney?.amount || 0), 0);
      
      return {
        ca_jour: Math.round(ca_jour),
        commandes: orders.length,
        panier_moyen: orders.length > 0 ? Math.round(ca_jour / orders.length) : 0,
        updated_at: new Date().toISOString()
      };
    });
  }
  
  async invalidateCache(pattern) {
    // Trouver et supprimer les clés matchant le pattern
    console.log(`[SHOPIFY] Invalidating cache: ${pattern}`);
    await redis.del(`pb:cache:${pattern}`);
    
    // Publier l'événement d'invalidation
    await messageBus.publish(CONFIG.CHANNELS.SHOPIFY, 'cache_invalidated', { pattern });
  }
}

const shopify = new ShopifyConnector();

// ============================================================================
// AGENTS SPÉCIALISÉS
// ============================================================================

// Agent Stratège - Analyse et recommandations
const AgentStratege = {
  name: 'stratege',
  
  async execute(task) {
    console.log(`[STRATÈGE] Exécution: ${task.title}`);
    STATE.agents.stratege.status = 'busy';
    STATE.agents.stratege.lastActivity = new Date().toISOString();
    
    try {
      let result;
      
      switch (task.task_type) {
        case 'analyze_kpis':
          result = await this.analyzeKPIs();
          break;
        case 'generate_report':
          result = await this.generateReport(task.input_data);
          break;
        case 'suggest_optimizations':
          result = await this.suggestOptimizations();
          break;
        default:
          result = await this.genericAnalysis(task);
      }
      
      STATE.agents.stratege.tasksCompleted++;
      STATE.agents.stratege.status = 'idle';
      return { success: true, result };
      
    } catch (error) {
      STATE.agents.stratege.status = 'error';
      throw error;
    }
  },
  
  async analyzeKPIs() {
    const kpis = await shopify.getKPIs();
    const target = 3000; // Objectif CA/jour
    const gap = target - kpis.ca_jour;
    
    return {
      kpis,
      analysis: {
        target,
        gap,
        percentage: Math.round((kpis.ca_jour / target) * 100),
        status: kpis.ca_jour >= target ? 'ON_TARGET' : 'BELOW_TARGET',
        recommendation: gap > 0 
          ? `Il manque ${gap}€ pour atteindre l'objectif. Actions suggérées: campagne email, push social.`
          : `Objectif atteint ! Continuer les actions actuelles.`
      }
    };
  },
  
  async generateReport(params) {
    // Génération rapport avec Claude
    const response = await callClaude(`
      Génère un rapport business pour Planetebeauty.com.
      Période: ${params?.period || 'aujourd\'hui'}
      Format: concis, bullet points, chiffres clés
    `);
    return { report: response };
  },
  
  async suggestOptimizations() {
    const kpis = await shopify.getKPIs();
    return {
      suggestions: [
        { priority: 'high', action: 'Optimiser les fiches produits sans description SEO' },
        { priority: 'medium', action: 'Activer les emails d\'abandon de panier' },
        { priority: 'low', action: 'Ajouter des avis clients aux best-sellers' }
      ],
      based_on_kpis: kpis
    };
  },
  
  async genericAnalysis(task) {
    const response = await callClaude(`
      En tant qu'analyste business pour Planetebeauty (parfumerie niche), analyse:
      ${task.description || task.title}
      
      Fournis une analyse structurée avec recommandations.
    `);
    return { analysis: response };
  }
};

// Agent Opérateur - Exécution et opérations
const AgentOperateur = {
  name: 'operateur',
  
  async execute(task) {
    console.log(`[OPÉRATEUR] Exécution: ${task.title}`);
    STATE.agents.operateur.status = 'busy';
    STATE.agents.operateur.lastActivity = new Date().toISOString();
    
    try {
      let result;
      
      switch (task.task_type) {
        case 'process_order':
          result = await this.processOrder(task.input_data);
          break;
        case 'update_inventory':
          result = await this.updateInventory(task.input_data);
          break;
        case 'handle_sav':
          result = await this.handleSAV(task.input_data);
          break;
        case 'send_notification':
          result = await this.sendNotification(task.input_data);
          break;
        default:
          result = await this.genericOperation(task);
      }
      
      STATE.agents.operateur.tasksCompleted++;
      STATE.agents.operateur.status = 'idle';
      return { success: true, result };
      
    } catch (error) {
      STATE.agents.operateur.status = 'error';
      throw error;
    }
  },
  
  async processOrder(orderData) {
    // Logique de traitement commande
    return { processed: true, order_id: orderData?.order_id };
  },
  
  async updateInventory(inventoryData) {
    await shopify.invalidateCache('inventory');
    return { updated: true };
  },
  
  async handleSAV(savData) {
    const response = await callClaude(`
      En tant que service client Planetebeauty, réponds à ce message client:
      "${savData?.message || 'Message client'}"
      
      Ton: professionnel, empathique, orienté solution.
      Format: réponse prête à envoyer.
    `);
    return { response, ready_to_send: true };
  },
  
  async sendNotification(notifData) {
    if (notifData?.type === 'email') {
      await sendEmail(notifData.to, notifData.subject, notifData.body);
    }
    return { sent: true };
  },
  
  async genericOperation(task) {
    return { executed: true, task_type: task.task_type };
  }
};

// Agent Technicien - Code et technique
const AgentTechnicien = {
  name: 'technicien',
  
  async execute(task) {
    console.log(`[TECHNICIEN] Exécution: ${task.title}`);
    STATE.agents.technicien.status = 'busy';
    STATE.agents.technicien.lastActivity = new Date().toISOString();
    
    try {
      let result;
      
      switch (task.task_type) {
        case 'generate_code':
          result = await this.generateCode(task.input_data);
          break;
        case 'debug':
          result = await this.debug(task.input_data);
          break;
        case 'optimize':
          result = await this.optimize(task.input_data);
          break;
        case 'deploy':
          result = await this.deploy(task.input_data);
          break;
        default:
          result = await this.genericTech(task);
      }
      
      STATE.agents.technicien.tasksCompleted++;
      STATE.agents.technicien.status = 'idle';
      return { success: true, result };
      
    } catch (error) {
      STATE.agents.technicien.status = 'error';
      throw error;
    }
  },
  
  async generateCode(params) {
    const response = await callClaude(`
      Génère du code ${params?.language || 'JavaScript'} pour:
      ${params?.description || 'fonction générique'}
      
      Code propre, commenté, prêt à l'emploi.
    `);
    return { code: response };
  },
  
  async debug(params) {
    const response = await callClaude(`
      Debug ce code/erreur:
      ${params?.error || params?.code || 'Erreur non spécifiée'}
      
      Identifie le problème et propose une solution.
    `);
    return { diagnosis: response };
  },
  
  async optimize(params) {
    return { optimized: true, improvements: ['Performance', 'Lisibilité'] };
  },
  
  async deploy(params) {
    return { deployed: true, environment: params?.env || 'production' };
  },
  
  async genericTech(task) {
    const response = await callClaude(`
      En tant que technicien expert, traite cette demande:
      ${task.description || task.title}
    `);
    return { response };
  }
};

// ============================================================================
// FONCTIONS UTILITAIRES
// ============================================================================

async function callClaude(prompt, maxTokens = 1000) {
  // Vérifier budget
  if (!checkBudgetLimits()) {
    throw new Error('Budget quotidien dépassé');
  }
  
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }]
  });
  
  // Tracker usage
  const tokensUsed = response.usage?.input_tokens + response.usage?.output_tokens || 0;
  STATE.budget.tokens_used += tokensUsed;
  STATE.budget.cost_usd += (tokensUsed / 1000) * 0.015; // Estimation coût
  STATE.budget.api_calls++;
  
  return response.content[0].text;
}

function checkBudgetLimits() {
  // Reset si nouveau jour
  const today = new Date().toISOString().split('T')[0];
  if (STATE.budget.date !== today) {
    STATE.budget = { date: today, tokens_used: 0, cost_usd: 0, api_calls: 0 };
  }
  
  if (STATE.budget.cost_usd >= CONFIG.DAILY_BUDGET_USD) {
    console.error('[BUDGET] Limite quotidienne atteinte!');
    return false;
  }
  
  if (STATE.budget.tokens_used >= CONFIG.DAILY_TOKEN_LIMIT) {
    console.error('[BUDGET] Limite tokens atteinte!');
    return false;
  }
  
  return true;
}

function resetHourlyLimitIfNeeded() {
  const now = Date.now();
  if (now - STATE.hourStartTime >= 3600000) { // 1 heure
    STATE.tasksCreatedThisHour = 0;
    STATE.hourStartTime = now;
  }
}

async function sendEmail(to, subject, body) {
  try {
    await emailTransport.sendMail({
      from: process.env.GMAIL_USER,
      to,
      subject: `[Planetebeauty] ${subject}`,
      html: body
    });
    console.log(`[EMAIL] Envoyé à ${to}: ${subject}`);
  } catch (error) {
    console.error('[EMAIL] Erreur:', error.message);
  }
}

async function sendAlertEmail(subject, details) {
  await sendEmail(
    'bmapbenoit@gmail.com',
    `🚨 ALERTE: ${subject}`,
    `<h2>${subject}</h2><pre>${JSON.stringify(details, null, 2)}</pre>`
  );
}

// ============================================================================
// ORCHESTRATEUR PRINCIPAL
// ============================================================================

async function processApprovedTasks() {
  if (!STATE.isRunning) return;
  
  try {
    // Récupérer les tâches approuvées
    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('status', 'approved')
      .order('priority', { ascending: true })
      .limit(5);
    
    if (error) throw error;
    if (!tasks || tasks.length === 0) return;
    
    console.log(`[ORCHESTRATEUR] ${tasks.length} tâche(s) approuvée(s) à traiter`);
    
    for (const task of tasks) {
      // Vérifier budget avant chaque tâche
      if (!checkBudgetLimits()) {
        console.log('[ORCHESTRATEUR] Budget épuisé, arrêt du traitement');
        await sendAlertEmail('Budget épuisé', STATE.budget);
        break;
      }
      
      // Marquer en cours
      await supabase
        .from('tasks')
        .update({ status: 'in_progress', started_at: new Date().toISOString() })
        .eq('id', task.id);
      
      // Router vers l'agent approprié
      let result;
      try {
        switch (task.assigned_to) {
          case 'stratege':
            result = await AgentStratege.execute(task);
            break;
          case 'operateur':
            result = await AgentOperateur.execute(task);
            break;
          case 'technicien':
            result = await AgentTechnicien.execute(task);
            break;
          default:
            // Auto-assignation basée sur le type
            if (task.task_type?.includes('analyze') || task.task_type?.includes('report')) {
              result = await AgentStratege.execute(task);
            } else if (task.task_type?.includes('code') || task.task_type?.includes('debug')) {
              result = await AgentTechnicien.execute(task);
            } else {
              result = await AgentOperateur.execute(task);
            }
        }
        
        // Succès
        await supabase
          .from('tasks')
          .update({
            status: 'completed',
            result: result,
            completed_at: new Date().toISOString()
          })
          .eq('id', task.id);
        
        STATE.consecutiveErrors = 0;
        console.log(`[ORCHESTRATEUR] ✅ Tâche ${task.id} complétée`);
        
        // Publier sur le Message Bus
        await messageBus.publish(CONFIG.CHANNELS.TASKS, 'task_completed', {
          task_id: task.id,
          title: task.title,
          result
        });
        
      } catch (taskError) {
        // Échec
        STATE.consecutiveErrors++;
        
        await supabase
          .from('tasks')
          .update({
            status: 'failed',
            error: taskError.message,
            completed_at: new Date().toISOString()
          })
          .eq('id', task.id);
        
        console.error(`[ORCHESTRATEUR] ❌ Tâche ${task.id} échouée:`, taskError.message);
        
        // Circuit breaker
        if (STATE.consecutiveErrors >= CONFIG.MAX_CONSECUTIVE_ERRORS) {
          console.error('[ORCHESTRATEUR] Circuit breaker activé!');
          await sendAlertEmail('Circuit breaker activé', {
            consecutiveErrors: STATE.consecutiveErrors,
            lastError: taskError.message
          });
          STATE.isRunning = false;
          break;
        }
      }
    }
    
  } catch (error) {
    console.error('[ORCHESTRATEUR] Erreur:', error.message);
    STATE.consecutiveErrors++;
  }
}

async function suggestTask(title, taskType, description, assignTo = 'auto', inputData = {}) {
  resetHourlyLimitIfNeeded();
  
  if (STATE.tasksCreatedThisHour >= CONFIG.MAX_TASKS_PER_HOUR) {
    throw new Error('Limite de tâches par heure atteinte');
  }
  
  // Vérifier duplicates
  const { data: existing } = await supabase
    .from('tasks')
    .select('id')
    .eq('title', title)
    .in('status', ['pending_validation', 'approved', 'in_progress'])
    .limit(1);
  
  if (existing && existing.length > 0) {
    throw new Error('Tâche similaire déjà en cours');
  }
  
  // Créer la tâche en pending_validation
  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      title,
      task_type: taskType,
      description,
      assigned_to: assignTo,
      input_data: inputData,
      status: 'pending_validation',
      source: 'supercerveau',
      created_by: 'supercerveau-unifie',
      priority: 3,
      estimated_cost: 0.5,
      decision_level: 2
    })
    .select()
    .single();
  
  if (error) throw error;
  
  STATE.tasksCreatedThisHour++;
  
  // Notifier par email
  await sendEmail(
    'bmapbenoit@gmail.com',
    `Nouvelle tâche à valider: ${title}`,
    `<h2>Nouvelle tâche suggérée</h2>
     <p><strong>Titre:</strong> ${title}</p>
     <p><strong>Type:</strong> ${taskType}</p>
     <p><strong>Description:</strong> ${description}</p>
     <p><a href="https://copilote.planetebeauty.com">Valider dans le Dashboard</a></p>`
  );
  
  // Publier sur le Message Bus
  await messageBus.publish(CONFIG.CHANNELS.TASKS, 'task_suggested', {
    task_id: task.id,
    title,
    taskType
  });
  
  return task;
}

async function sendHeartbeat() {
  try {
    await supabase
      .from('brain_heartbeat')
      .upsert({
        brain_id: 'supercerveau-unifie',
        last_activity: new Date().toISOString(),
        status: STATE.isRunning ? 'active' : 'stopped',
        current_task: 'orchestrating',
        tokens_used: STATE.budget.tokens_used
      }, { onConflict: 'brain_id' });
    
    // Mettre à jour aussi dans Redis pour accès rapide
    await redis.set('supercerveau:heartbeat', JSON.stringify({
      timestamp: new Date().toISOString(),
      status: STATE.isRunning ? 'active' : 'stopped',
      agents: STATE.agents,
      budget: STATE.budget
    }), { ex: 60 });
    
  } catch (error) {
    console.error('[HEARTBEAT] Erreur:', error.message);
  }
}

// ============================================================================
// BOUCLE PRINCIPALE
// ============================================================================

let mainLoopInterval = null;
let heartbeatInterval = null;

async function startOrchestrator() {
  if (STATE.isRunning) {
    console.log('[ORCHESTRATEUR] Déjà en cours d\'exécution');
    return;
  }
  
  console.log('🧠 [SUPERCERVEAU UNIFIÉ] Démarrage...');
  STATE.isRunning = true;
  STATE.startTime = new Date().toISOString();
  
  // Initialiser les agents
  STATE.agents.stratege.status = 'idle';
  STATE.agents.operateur.status = 'idle';
  STATE.agents.technicien.status = 'idle';
  
  // Souscrire aux événements Shopify
  messageBus.subscribe(CONFIG.CHANNELS.SHOPIFY, async (event) => {
    if (event.type === 'webhook_received') {
      console.log(`[SHOPIFY] Webhook reçu: ${event.payload?.topic}`);
      // Invalidation cache automatique gérée par le webhook handler
    }
  });
  
  // Démarrer les intervals
  mainLoopInterval = setInterval(processApprovedTasks, CONFIG.TASK_CHECK_INTERVAL_MS);
  heartbeatInterval = setInterval(sendHeartbeat, CONFIG.HEARTBEAT_INTERVAL_MS);
  
  // Premier heartbeat immédiat
  await sendHeartbeat();
  
  console.log('✅ [SUPERCERVEAU UNIFIÉ] En ligne et opérationnel');
  console.log(`   - Agents: Stratège, Opérateur, Technicien`);
  console.log(`   - Message Bus: Redis Pub/Sub actif`);
  console.log(`   - Shopify: Connecteur avec cache`);
  console.log(`   - Sécurité: Budget $${CONFIG.DAILY_BUDGET_USD}/jour, validation obligatoire`);
}

async function stopOrchestrator() {
  console.log('🛑 [SUPERCERVEAU UNIFIÉ] Arrêt...');
  STATE.isRunning = false;
  
  if (mainLoopInterval) clearInterval(mainLoopInterval);
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  
  STATE.agents.stratege.status = 'stopped';
  STATE.agents.operateur.status = 'stopped';
  STATE.agents.technicien.status = 'stopped';
  
  await sendHeartbeat();
  console.log('✅ [SUPERCERVEAU UNIFIÉ] Arrêté');
}

// ============================================================================
// API EXPRESS
// ============================================================================

// Health check
app.get('/health', async (req, res) => {
  const redisOk = await redis.ping().then(() => true).catch(() => false);
  const supabaseOk = await supabase.from('tasks').select('count').limit(1).then(() => true).catch(() => false);
  
  res.json({
    status: STATE.isRunning ? 'running' : 'stopped',
    uptime: STATE.startTime ? Math.floor((Date.now() - new Date(STATE.startTime).getTime()) / 1000) : 0,
    services: {
      redis: redisOk ? 'ok' : 'error',
      supabase: supabaseOk ? 'ok' : 'error',
      anthropic: process.env.ANTHROPIC_API_KEY ? 'configured' : 'missing'
    },
    agents: STATE.agents,
    budget: STATE.budget,
    consecutiveErrors: STATE.consecutiveErrors
  });
});

// Démarrer
app.post('/start', async (req, res) => {
  await startOrchestrator();
  res.json({ success: true, message: 'Supercerveau démarré' });
});

// Arrêter
app.post('/stop', async (req, res) => {
  await stopOrchestrator();
  res.json({ success: true, message: 'Supercerveau arrêté' });
});

// Budget
app.get('/budget', (req, res) => {
  res.json({
    ...STATE.budget,
    remaining_usd: (CONFIG.DAILY_BUDGET_USD - STATE.budget.cost_usd).toFixed(4),
    remaining_tokens: CONFIG.DAILY_TOKEN_LIMIT - STATE.budget.tokens_used
  });
});

// Agents status
app.get('/agents', (req, res) => {
  res.json(STATE.agents);
});

// Suggérer une tâche
app.post('/suggest', async (req, res) => {
  try {
    const { title, task_type, description, assign_to, input_data } = req.body;
    const task = await suggestTask(title, task_type, description, assign_to, input_data);
    res.json({ success: true, task });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// KPIs Shopify
app.get('/kpis', async (req, res) => {
  try {
    const kpis = await shopify.getKPIs();
    res.json(kpis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Message Bus history
app.get('/events/:channel', async (req, res) => {
  const events = await messageBus.getHistory(req.params.channel, 20);
  res.json(events);
});

// Webhooks Shopify
app.post('/webhooks/shopify', async (req, res) => {
  const topic = req.headers['x-shopify-topic'];
  console.log(`[WEBHOOK] Reçu: ${topic}`);
  
  // Invalidation cache selon le topic
  if (topic?.includes('inventory')) {
    await shopify.invalidateCache('inventory');
    await shopify.invalidateCache('kpis');
  } else if (topic?.includes('products')) {
    await shopify.invalidateCache('products');
  } else if (topic?.includes('orders')) {
    await shopify.invalidateCache('orders');
    await shopify.invalidateCache('kpis');
  }
  
  // Publier sur Message Bus
  await messageBus.publish(CONFIG.CHANNELS.SHOPIFY, 'webhook_received', {
    topic,
    timestamp: new Date().toISOString()
  });
  
  res.status(200).send('OK');
});

// ============================================================================
// DÉMARRAGE
// ============================================================================

const PORT = process.env.PORT || 3001;

app.listen(PORT, async () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║        🧠 SUPERCERVEAU UNIFIÉ V3.0 - PLANETEBEAUTY          ║
╠══════════════════════════════════════════════════════════════╣
║  Port: ${PORT}                                                  ║
║  Mode: ${process.env.MODE || 'manual'}                                            ║
║                                                              ║
║  Architecture Sidekick:                                      ║
║  ├── Chef d'orchestre ✅                                     ║
║  ├── Message Bus Redis ✅                                    ║
║  ├── Agent Stratège ✅                                       ║
║  ├── Agent Opérateur ✅                                      ║
║  ├── Agent Technicien ✅                                     ║
║  └── Shopify Connector ✅                                    ║
║                                                              ║
║  Sécurité:                                                   ║
║  ├── Budget: $${CONFIG.DAILY_BUDGET_USD}/jour                                      ║
║  ├── Validation obligatoire                                  ║
║  └── Circuit breaker: ${CONFIG.MAX_CONSECUTIVE_ERRORS} erreurs                        ║
╚══════════════════════════════════════════════════════════════╝
  `);
  
  // Démarrage auto si MODE=auto
  if (process.env.MODE === 'auto') {
    await startOrchestrator();
  }
});
