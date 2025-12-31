// ga4-tool.js - Outil GA4 pour STELLA v3.0 (ES Module)

import { BetaAnalyticsDataClient } from '@google-analytics/data';

class GA4Tool {
  constructor() {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
    this.propertyId = process.env.GA4_PROPERTY_ID || '427142120';
    
    if (credentials.client_email) {
      this.client = new BetaAnalyticsDataClient({ credentials });
      this.connected = true;
      console.log('✅ GA4 connecté - Property:', this.propertyId);
    } else {
      this.connected = false;
      console.log('⚠️ GA4 non configuré (GOOGLE_SERVICE_ACCOUNT manquant)');
    }
  }

  async getKPIs(days = 7) {
    if (!this.connected) return { error: 'GA4 non configuré' };
    try {
      const [response] = await this.client.runReport({
        property: `properties/${this.propertyId}`,
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        metrics: [
          { name: 'sessions' },
          { name: 'activeUsers' },
          { name: 'totalRevenue' },
          { name: 'transactions' },
          { name: 'averagePurchaseRevenue' },
          { name: 'ecommercePurchases' }
        ]
      });

      const row = response.rows?.[0];
      if (!row) return { error: 'Pas de données' };

      return {
        sessions: parseInt(row.metricValues[0].value),
        users: parseInt(row.metricValues[1].value),
        revenue: parseFloat(row.metricValues[2].value).toFixed(2) + '€',
        transactions: parseInt(row.metricValues[3].value),
        avgOrderValue: parseFloat(row.metricValues[4].value).toFixed(2) + '€',
        purchases: parseInt(row.metricValues[5].value),
        period: `${days} derniers jours`
      };
    } catch (error) {
      console.error('GA4 getKPIs error:', error.message);
      return { error: error.message };
    }
  }

  async getDailyData(days = 7) {
    if (!this.connected) return { error: 'GA4 non configuré' };
    try {
      const [response] = await this.client.runReport({
        property: `properties/${this.propertyId}`,
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'date' }],
        metrics: [
          { name: 'sessions' },
          { name: 'activeUsers' },
          { name: 'totalRevenue' },
          { name: 'transactions' }
        ],
        orderBys: [{ dimension: { dimensionName: 'date' } }]
      });

      return response.rows?.map(row => ({
        date: row.dimensionValues[0].value,
        sessions: parseInt(row.metricValues[0].value),
        users: parseInt(row.metricValues[1].value),
        revenue: parseFloat(row.metricValues[2].value).toFixed(2),
        transactions: parseInt(row.metricValues[3].value)
      })) || [];
    } catch (error) {
      return { error: error.message };
    }
  }

  async getTrafficSources(days = 7) {
    if (!this.connected) return { error: 'GA4 non configuré' };
    try {
      const [response] = await this.client.runReport({
        property: `properties/${this.propertyId}`,
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalRevenue' },
          { name: 'transactions' }
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10
      });

      return response.rows?.map(row => ({
        source: row.dimensionValues[0].value,
        medium: row.dimensionValues[1].value,
        sessions: parseInt(row.metricValues[0].value),
        revenue: parseFloat(row.metricValues[1].value).toFixed(2),
        transactions: parseInt(row.metricValues[2].value)
      })) || [];
    } catch (error) {
      return { error: error.message };
    }
  }

  async getTopPages(days = 7, limit = 10) {
    if (!this.connected) return { error: 'GA4 non configuré' };
    try {
      const [response] = await this.client.runReport({
        property: `properties/${this.propertyId}`,
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'averageSessionDuration' },
          { name: 'bounceRate' }
        ],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: limit
      });

      return response.rows?.map(row => ({
        page: row.dimensionValues[0].value,
        views: parseInt(row.metricValues[0].value),
        avgDuration: parseFloat(row.metricValues[1].value).toFixed(0) + 's',
        bounceRate: (parseFloat(row.metricValues[2].value) * 100).toFixed(1) + '%'
      })) || [];
    } catch (error) {
      return { error: error.message };
    }
  }

  async getFullReport(days = 7) {
    const [kpis, daily, sources, pages] = await Promise.all([
      this.getKPIs(days),
      this.getDailyData(days),
      this.getTrafficSources(days),
      this.getTopPages(days, 5)
    ]);

    return { kpis, dailyData: daily, trafficSources: sources, topPages: pages, generatedAt: new Date().toISOString() };
  }
}

export default GA4Tool;
