// search-console-tool.js - Outil Search Console pour STELLA v3.1 (ES Module)

import { google } from 'googleapis';

class SearchConsoleTool {
  constructor() {
    let credentials = {};
    
    // Support base64 OU JSON direct
    const rawCreds = process.env.GOOGLE_SERVICE_ACCOUNT || '';
    if (rawCreds) {
      try {
        if (rawCreds.startsWith('{')) {
          // JSON direct
          credentials = JSON.parse(rawCreds);
        } else {
          // Base64 encoded (plus fiable pour les clés privées)
          credentials = JSON.parse(Buffer.from(rawCreds, 'base64').toString('utf-8'));
        }
      } catch (e) {
        console.error('❌ Erreur parsing GOOGLE_SERVICE_ACCOUNT:', e.message);
      }
    }
    
    this.siteUrl = process.env.SEARCH_CONSOLE_SITE || 'https://planetebeauty.com/';
    
    if (credentials.client_email) {
      const auth = new google.auth.GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/webmasters.readonly']
      });
      this.searchConsole = google.searchconsole({ version: 'v1', auth });
      this.connected = true;
      console.log('✅ Search Console connecté - Site:', this.siteUrl);
    } else {
      this.connected = false;
      console.log('⚠️ Search Console non configuré');
    }
  }

  _getDateRange(days) {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    return { startDate, endDate };
  }

  async getTopQueries(days = 7, limit = 20) {
    if (!this.connected) return { error: 'Search Console non configuré' };
    try {
      const { startDate, endDate } = this._getDateRange(days);
      const response = await this.searchConsole.searchanalytics.query({
        siteUrl: this.siteUrl,
        requestBody: { startDate, endDate, dimensions: ['query'], rowLimit: limit }
      });

      return response.data.rows?.map(row => ({
        query: row.keys[0],
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: (row.ctr * 100).toFixed(2) + '%',
        position: row.position.toFixed(1)
      })) || [];
    } catch (error) {
      return { error: error.message };
    }
  }

  async getTopPages(days = 7, limit = 20) {
    if (!this.connected) return { error: 'Search Console non configuré' };
    try {
      const { startDate, endDate } = this._getDateRange(days);
      const response = await this.searchConsole.searchanalytics.query({
        siteUrl: this.siteUrl,
        requestBody: { startDate, endDate, dimensions: ['page'], rowLimit: limit }
      });

      return response.data.rows?.map(row => ({
        page: row.keys[0].replace(this.siteUrl, '/'),
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: (row.ctr * 100).toFixed(2) + '%',
        position: row.position.toFixed(1)
      })) || [];
    } catch (error) {
      return { error: error.message };
    }
  }

  async getDeviceData(days = 7) {
    if (!this.connected) return { error: 'Search Console non configuré' };
    try {
      const { startDate, endDate } = this._getDateRange(days);
      const response = await this.searchConsole.searchanalytics.query({
        siteUrl: this.siteUrl,
        requestBody: { startDate, endDate, dimensions: ['device'] }
      });

      return response.data.rows?.map(row => ({
        device: row.keys[0],
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: (row.ctr * 100).toFixed(2) + '%',
        position: row.position.toFixed(1)
      })) || [];
    } catch (error) {
      return { error: error.message };
    }
  }

  async getCountryData(days = 7, limit = 10) {
    if (!this.connected) return { error: 'Search Console non configuré' };
    try {
      const { startDate, endDate } = this._getDateRange(days);
      const response = await this.searchConsole.searchanalytics.query({
        siteUrl: this.siteUrl,
        requestBody: { startDate, endDate, dimensions: ['country'], rowLimit: limit }
      });

      return response.data.rows?.map(row => ({
        country: row.keys[0],
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: (row.ctr * 100).toFixed(2) + '%',
        position: row.position.toFixed(1)
      })) || [];
    } catch (error) {
      return { error: error.message };
    }
  }

  async getOpportunities(days = 28, limit = 20) {
    if (!this.connected) return { error: 'Search Console non configuré' };
    try {
      const { startDate, endDate } = this._getDateRange(days);
      const response = await this.searchConsole.searchanalytics.query({
        siteUrl: this.siteUrl,
        requestBody: { startDate, endDate, dimensions: ['query'], rowLimit: 100 }
      });

      // Filtrer position 5-20 avec impressions > 50 = opportunités SEO
      const opportunities = response.data.rows
        ?.filter(row => row.position >= 5 && row.position <= 20 && row.impressions > 50)
        ?.sort((a, b) => b.impressions - a.impressions)
        ?.slice(0, limit)
        ?.map(row => ({
          query: row.keys[0],
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: (row.ctr * 100).toFixed(2) + '%',
          position: row.position.toFixed(1),
          potentialClicks: Math.round(row.impressions * 0.15) // CTR estimé si top 3
        })) || [];

      return opportunities;
    } catch (error) {
      return { error: error.message };
    }
  }

  async getFullReport(days = 7) {
    const [queries, pages, devices, countries, opportunities] = await Promise.all([
      this.getTopQueries(days, 10),
      this.getTopPages(days, 10),
      this.getDeviceData(days),
      this.getCountryData(days, 5),
      this.getOpportunities(28, 10)
    ]);

    const totals = Array.isArray(queries) ? queries.reduce((acc, q) => ({
      clicks: acc.clicks + q.clicks,
      impressions: acc.impressions + q.impressions
    }), { clicks: 0, impressions: 0 }) : { clicks: 0, impressions: 0 };

    return {
      summary: {
        totalClicks: totals.clicks,
        totalImpressions: totals.impressions,
        avgCtr: totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(2) + '%' : '0%',
        period: `${days} derniers jours`
      },
      topQueries: queries,
      topPages: pages,
      devices,
      countries,
      opportunities,
      generatedAt: new Date().toISOString()
    };
  }
}

export default SearchConsoleTool;
