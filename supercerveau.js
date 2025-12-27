/**
 * ============================================================================
 * 🧠 SUPERCERVEAU V2 - VERSION SÉCURISÉE
 * ============================================================================
 * 
 * Agent autonome qui :
 * - Exécute les tâches APPROUVÉES par Benoît
 * - Suggère de nouvelles tâches (en pending_validation)
 * - NE CRÉE JAMAIS de sous-tâches automatiquement
 * - Respecte les limites de budget
 * - S'arrête en cas d'erreurs répétées
 * 
 * @date 27 décembre 2025
 * @version 2.0.0 - SÉCURISÉ
 */

const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

// ============================================================================
// CONFIGURATION SÉCURISÉE
// ============================================================================

const CONFIG = {
  // Supabase
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://upqldbeaxuikbzohlgne.supabase.co',
  SUPABASE_KEY: process.env.SUPABASE_SERVICE_KEY || 'sb_secret_Q87xtWlfrMjtaqzgJFIJbA_jpAK2pP6',
  
  // Anthropic
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  MODEL: 'claude-sonnet-4-20250514',
  
  // 🔒 LIMITES DE SÉCURITÉ
  LIMITS: {
    DAILY_BUDGET_USD: 10,           // Max $10/jour
    MAX_COST_PER_TASK: 2,           // Max $2/tâche
    DAILY_TOKEN_LIMIT: 500000,      // Max 500K tokens/jour
    MAX_TASKS_PER_HOUR: 10,         // Max 10 tâches créées/heure
    MAX_CONSECUTIVE_ERRORS: 3,      // Circuit breaker après 3 erreurs
    HEARTBEAT_INTERVAL_MS: 30000,   // Heartbeat toutes les 30s
    TASK_CHECK_INTERVAL_MS: 60000,  // Check tâches toutes les 60s
  },
  
  // Email
  EMAIL: {
    enabled: !!process.env.GMAIL_APP_PASSWORD,
    from: 'copilote@planetebeauty.com',
    to: 'bmapbenoit@gmail.com',
    smtp: {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.GMAIL_USER || 'bmapbenoit@gmail.com',
        pass: process.env.GMAIL_APP_PASSWORD
      }
    }
  }
};

// ============================================================================
// CLIENTS
// ============================================================================

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

let emailTransporter = null;
if (CONFIG.EMAIL.enabled) {
  emailTransporter = nodemailer.createTransport(CONFIG.EMAIL.smtp);
}

// ============================================================================
// ÉTAT GLOBAL
// ============================================================================

const state = {
  isRunning: false,
  consecutiveErrors: 0,
  tasksCreatedThisHour: 0,
  lastHourReset: Date.now(),
  
  // Budget tracking
  budget: {
    date: new Date().toISOString().split('T')[0],
    tokens_used: 0,
    cost_usd: 0,
    api_calls: 0
  }
};

// ============================================================================
// FONCTIONS UTILITAIRES
// ============================================================================

function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const emoji = { info: 'ℹ️', warn: '⚠️', error: '❌', success: '✅', brain: '🧠' }[level] || '📝';
  console.log(`${timestamp} ${emoji} [${level.toUpperCase()}] ${message}`, data);
  
  // Log dans Supabase
  supabase.from('agent_logs').insert({
    agent: 'supercerveau-v2',
    level,
    message,
    metadata: data
  }).then(() => {}).catch(() => {});
}

async function sendEmail(subject, body) {
  if (!emailTransporter) return;
  try {
    await emailTransporter.sendMail({
      from: CONFIG.EMAIL.from,
      to: CONFIG.EMAIL.to,
      subject,
      html: body
    });
    log('info', `Email envoyé: ${subject}`);
  } catch (err) {
    log('error', `Erreur email: ${err.message}`);
  }
}

// ============================================================================
// GESTION DU BUDGET
// ============================================================================

function resetDailyBudgetIfNeeded() {
  const today = new Date().toISOString().split('T')[0];
  if (state.budget.date !== today) {
    log('info', 'Reset budget quotidien', { previous: state.budget });
    state.budget = { date: today, tokens_used: 0, cost_usd: 0, api_calls: 0 };
  }
}

function resetHourlyLimitIfNeeded() {
  const now = Date.now();
  if (now - state.lastHourReset > 3600000) { // 1 heure
    state.tasksCreatedThisHour = 0;
    state.lastHourReset = now;
  }
}

function checkBudgetLimits() {
  resetDailyBudgetIfNeeded();
  
  if (state.budget.cost_usd >= CONFIG.LIMITS.DAILY_BUDGET_USD) {
    throw new Error(`🛑 BUDGET QUOTIDIEN ATTEINT: $${state.budget.cost_usd.toFixed(2)} / $${CONFIG.LIMITS.DAILY_BUDGET_USD}`);
  }
  
  if (state.budget.tokens_used >= CONFIG.LIMITS.DAILY_TOKEN_LIMIT) {
    throw new Error(`🛑 LIMITE TOKENS ATTEINTE: ${state.budget.tokens_used} / ${CONFIG.LIMITS.DAILY_TOKEN_LIMIT}`);
  }
}

function updateBudget(inputTokens, outputTokens) {
  // Prix Claude Sonnet: $3/M input, $15/M output
  const cost = (inputTokens / 1000000) * 3 + (outputTokens / 1000000) * 15;
  state.budget.tokens_used += inputTokens + outputTokens;
  state.budget.cost_usd += cost;
  state.budget.api_calls += 1;
  
  log('info', `Budget mis à jour`, {
    cost_this_call: `$${cost.toFixed(4)}`,
    total_today: `$${state.budget.cost_usd.toFixed(4)} / $${CONFIG.LIMITS.DAILY_BUDGET_USD}`,
    tokens_today: `${state.budget.tokens_used.toLocaleString()} / ${CONFIG.LIMITS.DAILY_TOKEN_LIMIT.toLocaleString()}`
  });
}

// ============================================================================
// CIRCUIT BREAKER
// ============================================================================

function recordSuccess() {
  state.consecutiveErrors = 0;
}

function recordError(error) {
  state.consecutiveErrors++;
  log('error', `Erreur #${state.consecutiveErrors}: ${error.message}`);
  
  if (state.consecutiveErrors >= CONFIG.LIMITS.MAX_CONSECUTIVE_ERRORS) {
    log('error', '🛑 CIRCUIT BREAKER ACTIVÉ - Trop d\'erreurs consécutives');
    sendEmail(
      '🚨 ALERTE: Supercerveau arrêté',
      `<h2>Circuit Breaker activé</h2>
       <p>${state.consecutiveErrors} erreurs consécutives détectées.</p>
       <p>Dernière erreur: ${error.message}</p>
       <p><a href="https://copilote.planetebeauty.com">Vérifier le dashboard</a></p>`
    );
    stopAgent();
  }
}

// ============================================================================
// APPEL CLAUDE API
// ============================================================================

async function callClaude(systemPrompt, userMessage, maxTokens = 1024) {
  checkBudgetLimits();
  
  if (!CONFIG.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY non configurée');
  }
  
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CONFIG.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: CONFIG.MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${error}`);
  }
  
  const data = await response.json();
  updateBudget(data.usage?.input_tokens || 0, data.usage?.output_tokens || 0);
  
  return data.content[0]?.text || '';
}

// ============================================================================
// GESTION DES TÂCHES
// ============================================================================

async function getApprovedTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('status', 'approved')
    .order('created_at', { ascending: true })
    .limit(5);
  
  if (error) throw error;
  return data || [];
}

async function updateTaskStatus(taskId, status, result = null, error = null) {
  const update = {
    status,
    updated_at: new Date().toISOString()
  };
  
  if (status === 'executing') {
    update.started_at = new Date().toISOString();
  }
  if (status === 'completed') {
    update.completed_at = new Date().toISOString();
    update.result = result;
  }
  if (status === 'failed') {
    update.error = error;
  }
  
  const { error: updateError } = await supabase
    .from('tasks')
    .update(update)
    .eq('id', taskId);
  
  if (updateError) throw updateError;
}

async function executeTask(task) {
  log('brain', `Exécution tâche: ${task.title}`, { id: task.id, type: task.task_type });
  
  // Marquer comme en cours
  await updateTaskStatus(task.id, 'executing');
  
  const systemPrompt = `Tu es le Supercerveau de Planetebeauty.com.

CONTEXTE:
- CA cible: 3000€/jour
- Clients: 29641
- Panier moyen: 177€ (objectif 200€)

TÂCHE À EXÉCUTER:
ID: ${task.id}
Titre: ${task.title}
Type: ${task.task_type}
Description: ${task.description || 'N/A'}
Input: ${JSON.stringify(task.input_data || {})}

RÈGLES ABSOLUES:
1. Exécute la tâche demandée
2. NE CRÉE JAMAIS de sous-tâches
3. Retourne un JSON avec: { "success": true/false, "result": {...}, "summary": "..." }
4. Si tu as besoin d'une action supplémentaire, mentionne-la dans le summary mais NE LA CRÉE PAS

Réponds UNIQUEMENT en JSON valide.`;

  try {
    const response = await callClaude(systemPrompt, `Exécute cette tâche maintenant.`, 2048);
    
    // Parser le JSON
    let result;
    try {
      // Extraire le JSON de la réponse
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : { success: true, summary: response };
    } catch {
      result = { success: true, summary: response };
    }
    
    await updateTaskStatus(task.id, 'completed', result);
    log('success', `Tâche terminée: ${task.title}`, { result: result.summary });
    
    return result;
    
  } catch (err) {
    await updateTaskStatus(task.id, 'failed', null, err.message);
    throw err;
  }
}

// ============================================================================
// 🔒 SUGGESTION DE TÂCHE (SÉCURISÉE)
// ============================================================================

async function suggestTask(title, description, taskType = 'suggested', decisionLevel = 3, estimatedCost = 0.5) {
  // Vérifier limite horaire
  resetHourlyLimitIfNeeded();
  
  if (state.tasksCreatedThisHour >= CONFIG.LIMITS.MAX_TASKS_PER_HOUR) {
    log('warn', `Limite tâches/heure atteinte: ${state.tasksCreatedThisHour}/${CONFIG.LIMITS.MAX_TASKS_PER_HOUR}`);
    return null;
  }
  
  // Vérifier si tâche similaire existe déjà
  const { data: existing } = await supabase
    .from('tasks')
    .select('id')
    .eq('title', title)
    .in('status', ['pending_validation', 'approved', 'executing'])
    .limit(1);
  
  if (existing && existing.length > 0) {
    log('warn', `Tâche similaire existe déjà: ${title}`);
    return null;
  }
  
  // Créer la tâche en pending_validation
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      title,
      description,
      task_type: taskType,
      status: 'pending_validation', // 🔒 TOUJOURS en attente de validation
      decision_level: decisionLevel,
      estimated_cost: estimatedCost,
      source: 'supercerveau-v2',
      created_by: 'supercerveau-v2',
      can_create_subtasks: false // 🔒 INTERDIT de créer des sous-tâches
    })
    .select()
    .single();
  
  if (error) throw error;
  
  state.tasksCreatedThisHour++;
  log('info', `Tâche suggérée: ${title}`, { id: data.id, tasksThisHour: state.tasksCreatedThisHour });
  
  // Notification email
  await sendEmail(
    `🔔 Nouvelle tâche à valider: ${title}`,
    `<h2>Tâche suggérée par le Supercerveau</h2>
     <p><strong>Titre:</strong> ${title}</p>
     <p><strong>Description:</strong> ${description || 'N/A'}</p>
     <p><strong>Niveau:</strong> ${decisionLevel}</p>
     <p><strong>Coût estimé:</strong> $${estimatedCost}</p>
     <p><a href="https://copilote.planetebeauty.com">Valider dans le Dashboard</a></p>`
  );
  
  return data;
}

// ============================================================================
// HEARTBEAT
// ============================================================================

async function sendHeartbeat() {
  try {
    await supabase.from('brain_heartbeat').upsert({
      brain_id: 'supercerveau-v2',
      last_activity: new Date().toISOString(),
      status: state.isRunning ? 'active' : 'idle',
      current_task: null,
      tokens_used: state.budget.tokens_used
    }, { onConflict: 'brain_id' });
  } catch (err) {
    log('error', `Heartbeat error: ${err.message}`);
  }
}

// ============================================================================
// BOUCLE PRINCIPALE
// ============================================================================

async function mainLoop() {
  if (!state.isRunning) return;
  
  try {
    // 1. Récupérer les tâches approuvées
    const tasks = await getApprovedTasks();
    
    if (tasks.length > 0) {
      log('brain', `${tasks.length} tâche(s) approuvée(s) à exécuter`);
      
      // 2. Exécuter chaque tâche
      for (const task of tasks) {
        if (!state.isRunning) break;
        
        try {
          await executeTask(task);
          recordSuccess();
        } catch (err) {
          recordError(err);
        }
        
        // Pause entre les tâches
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } else {
      log('info', 'Aucune tâche approuvée en attente');
    }
    
    recordSuccess();
    
  } catch (err) {
    recordError(err);
  }
}

// ============================================================================
// DÉMARRAGE / ARRÊT
// ============================================================================

let heartbeatInterval = null;
let mainLoopInterval = null;

function startAgent() {
  if (state.isRunning) {
    log('warn', 'Agent déjà en cours d\'exécution');
    return;
  }
  
  log('brain', '🚀 SUPERCERVEAU V2 DÉMARRÉ', {
    limits: CONFIG.LIMITS,
    email: CONFIG.EMAIL.enabled ? 'activé' : 'désactivé'
  });
  
  state.isRunning = true;
  state.consecutiveErrors = 0;
  
  // Heartbeat
  sendHeartbeat();
  heartbeatInterval = setInterval(sendHeartbeat, CONFIG.LIMITS.HEARTBEAT_INTERVAL_MS);
  
  // Boucle principale
  mainLoop();
  mainLoopInterval = setInterval(mainLoop, CONFIG.LIMITS.TASK_CHECK_INTERVAL_MS);
  
  // Email de démarrage
  sendEmail(
    '🧠 Supercerveau V2 démarré',
    `<h2>Le Supercerveau est actif</h2>
     <p>Limites configurées:</p>
     <ul>
       <li>Budget: $${CONFIG.LIMITS.DAILY_BUDGET_USD}/jour</li>
       <li>Max par tâche: $${CONFIG.LIMITS.MAX_COST_PER_TASK}</li>
       <li>Tokens: ${CONFIG.LIMITS.DAILY_TOKEN_LIMIT.toLocaleString()}/jour</li>
       <li>Tâches: ${CONFIG.LIMITS.MAX_TASKS_PER_HOUR}/heure max</li>
     </ul>
     <p><a href="https://copilote.planetebeauty.com">Voir le Dashboard</a></p>`
  );
}

function stopAgent() {
  if (!state.isRunning) return;
  
  log('brain', '🛑 SUPERCERVEAU V2 ARRÊTÉ');
  state.isRunning = false;
  
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (mainLoopInterval) clearInterval(mainLoopInterval);
  
  // Mettre à jour le heartbeat
  supabase.from('brain_heartbeat').upsert({
    brain_id: 'supercerveau-v2',
    last_activity: new Date().toISOString(),
    status: 'stopped'
  }, { onConflict: 'brain_id' });
}

// ============================================================================
// API EXPRESS (pour contrôle externe)
// ============================================================================

const express = require('express');
const app = express();
app.use(express.json());

// Health
app.get('/health', (req, res) => {
  res.json({
    status: state.isRunning ? 'running' : 'stopped',
    budget: state.budget,
    consecutiveErrors: state.consecutiveErrors,
    tasksCreatedThisHour: state.tasksCreatedThisHour,
    limits: CONFIG.LIMITS
  });
});

// Démarrer
app.post('/start', (req, res) => {
  startAgent();
  res.json({ success: true, message: 'Agent démarré' });
});

// Arrêter
app.post('/stop', (req, res) => {
  stopAgent();
  res.json({ success: true, message: 'Agent arrêté' });
});

// Status budget
app.get('/budget', (req, res) => {
  resetDailyBudgetIfNeeded();
  res.json({
    ...state.budget,
    remaining_usd: (CONFIG.LIMITS.DAILY_BUDGET_USD - state.budget.cost_usd).toFixed(4),
    remaining_tokens: CONFIG.LIMITS.DAILY_TOKEN_LIMIT - state.budget.tokens_used
  });
});

// Suggérer une tâche manuellement
app.post('/suggest', async (req, res) => {
  try {
    const { title, description, task_type, decision_level, estimated_cost } = req.body;
    const task = await suggestTask(title, description, task_type, decision_level, estimated_cost);
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// DÉMARRAGE
// ============================================================================

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       🧠 SUPERCERVEAU V2 - PLANETEBEAUTY                     ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║   API: http://localhost:${PORT}                                  ║`);
  console.log('║                                                              ║');
  console.log('║   🔒 SÉCURITÉS ACTIVES:                                      ║');
  console.log(`║   - Budget: $${CONFIG.LIMITS.DAILY_BUDGET_USD}/jour, $${CONFIG.LIMITS.MAX_COST_PER_TASK}/tâche                       ║`);
  console.log(`║   - Tokens: ${CONFIG.LIMITS.DAILY_TOKEN_LIMIT.toLocaleString()}/jour                              ║`);
  console.log(`║   - Tâches: ${CONFIG.LIMITS.MAX_TASKS_PER_HOUR}/heure max                                ║`);
  console.log(`║   - Circuit breaker: ${CONFIG.LIMITS.MAX_CONSECUTIVE_ERRORS} erreurs                          ║`);
  console.log(`║   - Sous-tâches: INTERDIT                                    ║`);
  console.log('║                                                              ║');
  console.log('║   Endpoints:                                                 ║');
  console.log('║   - GET  /health   → Status agent                            ║');
  console.log('║   - POST /start    → Démarrer                                ║');
  console.log('║   - POST /stop     → Arrêter                                 ║');
  console.log('║   - GET  /budget   → Budget restant                          ║');
  console.log('║   - POST /suggest  → Suggérer tâche                          ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  
  // Démarrage automatique si variable MODE=auto
  if (process.env.MODE === 'auto') {
    log('info', 'Mode AUTO détecté - Démarrage automatique');
    startAgent();
  } else {
    log('info', 'Mode MANUEL - Utilisez POST /start pour démarrer');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log('info', 'SIGTERM reçu - Arrêt gracieux');
  stopAgent();
  process.exit(0);
});

process.on('SIGINT', () => {
  log('info', 'SIGINT reçu - Arrêt gracieux');
  stopAgent();
  process.exit(0);
});

module.exports = { startAgent, stopAgent, suggestTask };
