/**
 * Data Freshness Guard
 * Monitors data quality and freshness from all sources
 */

import logger from '../services/logging/logger.js';

class DataFreshnessGuard {
  constructor() {
    this.dataTimestamps = new Map();
    this.dataGaps = new Map();
    this.incidents = [];
    this.freshnessThresholds = {
      'EA_PRICE': 20000,        // 20 seconds max age for EA prices
      'RSS_NEWS': 300000,       // 5 minutes for news
      'TWELVE_DATA': 60000,     // 1 minute for market data
      'WEBSOCKET': 35000        // 35 seconds for WebSocket heartbeat
    };
    this.sequenceNumbers = new Map();
  }

  /**
   * Validate EA price tick
   */
  validateEATick(tick) {
    const now = Date.now();
    const source = `EA_${tick.pair}`;
    
    // Check timestamp
    const tickTime = new Date(tick.timestamp).getTime();
    const age = now - tickTime;
    
    if (age > this.freshnessThresholds.EA_PRICE) {
      this.recordIncident({
        type: 'STALE_DATA',
        source,
        message: `Stale EA tick for ${tick.pair}: ${age}ms old`,
        data: { pair: tick.pair, age, tick }
      });
      return false;
    }

    // Check sequence
    const lastSeq = this.sequenceNumbers.get(source) || 0;
    const currentSeq = tick.sequence || 0;
    
    if (currentSeq <= lastSeq && lastSeq > 0) {
      this.recordIncident({
        type: 'SEQUENCE_ERROR',
        source,
        message: `Sequence error for ${tick.pair}: expected > ${lastSeq}, got ${currentSeq}`,
        data: { pair: tick.pair, lastSeq, currentSeq }
      });
    }
    
    // Check for gaps
    if (currentSeq > lastSeq + 1 && lastSeq > 0) {
      const gap = currentSeq - lastSeq - 1;
      this.dataGaps.set(source, (this.dataGaps.get(source) || 0) + gap);
      
      if (gap > 5) {
        this.recordIncident({
          type: 'DATA_GAP',
          source,
          message: `Large gap detected for ${tick.pair}: ${gap} ticks missed`,
          data: { pair: tick.pair, gap, lastSeq, currentSeq }
        });
      }
    }

    this.sequenceNumbers.set(source, currentSeq);
    this.dataTimestamps.set(source, now);
    
    return true;
  }

  /**
   * Check data freshness for a source
   */
  checkFreshness(source) {
    const lastUpdate = this.dataTimestamps.get(source);
    if (!lastUpdate) {
      return { fresh: false, age: null, status: 'NEVER_RECEIVED' };
    }

    const age = Date.now() - lastUpdate;
    const threshold = this.freshnessThresholds[source] || 60000;
    const fresh = age < threshold;

    if (!fresh) {
      this.recordIncident({
        type: 'STALE_SOURCE',
        source,
        message: `Data source ${source} is stale: ${age}ms old (threshold: ${threshold}ms)`,
        data: { source, age, threshold }
      });
    }

    return { fresh, age, threshold, status: fresh ? 'FRESH' : 'STALE' };
  }

  /**
   * Update timestamp for a data source
   */
  updateSourceTimestamp(source) {
    this.dataTimestamps.set(source, Date.now());
  }

  /**
   * Record an incident
   */
  recordIncident(incident) {
    const enrichedIncident = {
      ...incident,
      timestamp: new Date().toISOString(),
      id: `INC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };

    this.incidents.push(enrichedIncident);
    
    // Keep only last 1000 incidents
    if (this.incidents.length > 1000) {
      this.incidents.shift();
    }

    logger.warn('Data incident recorded', enrichedIncident);
    
    return enrichedIncident;
  }

  /**
   * Get recent incidents
   */
  getRecentIncidents(limit = 50) {
    return this.incidents.slice(-limit);
  }

  /**
   * Get incident statistics
   */
  getIncidentStats() {
    const stats = {
      total: this.incidents.length,
      byType: {},
      bySource: {},
      last24h: 0
    };

    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    this.incidents.forEach(inc => {
      stats.byType[inc.type] = (stats.byType[inc.type] || 0) + 1;
      stats.bySource[inc.source] = (stats.bySource[inc.source] || 0) + 1;
      
      if (new Date(inc.timestamp).getTime() > oneDayAgo) {
        stats.last24h++;
      }
    });

    return stats;
  }

  /**
   * Get comprehensive health report
   */
  getHealthReport() {
    const report = {
      timestamp: new Date().toISOString(),
      sources: {},
      gaps: {},
      incidents: this.getIncidentStats()
    };

    // Check all sources
    Object.keys(this.freshnessThresholds).forEach(source => {
      report.sources[source] = this.checkFreshness(source);
    });

    // Get gaps
    this.dataGaps.forEach((count, source) => {
      report.gaps[source] = count;
    });

    return report;
  }

  /**
   * Check WebSocket connection health
   */
  validateWebSocketHealth(lastPing) {
    const age = Date.now() - lastPing;
    
    if (age > this.freshnessThresholds.WEBSOCKET) {
      this.recordIncident({
        type: 'WEBSOCKET_TIMEOUT',
        source: 'WEBSOCKET',
        message: `WebSocket heartbeat timeout: ${age}ms since last ping`,
        data: { age, threshold: this.freshnessThresholds.WEBSOCKET }
      });
      return false;
    }

    this.updateSourceTimestamp('WEBSOCKET');
    return true;
  }

  /**
   * Validate RSS news freshness
   */
  validateRSSFreshness(articles) {
    if (!articles || articles.length === 0) {
      this.recordIncident({
        type: 'NO_DATA',
        source: 'RSS_NEWS',
        message: 'No RSS articles received',
        data: { articleCount: 0 }
      });
      return false;
    }

    const mostRecent = Math.max(...articles.map(a => new Date(a.published || a.pubDate).getTime()));
    const age = Date.now() - mostRecent;

    if (age > this.freshnessThresholds.RSS_NEWS) {
      this.recordIncident({
        type: 'STALE_DATA',
        source: 'RSS_NEWS',
        message: `Stale RSS data: most recent article is ${age}ms old`,
        data: { age, articleCount: articles.length }
      });
      return false;
    }

    this.updateSourceTimestamp('RSS_NEWS');
    return true;
  }

  /**
   * Validate TwelveData API response
   */
  validateTwelveDataResponse(response, endpoint) {
    if (!response || response.status === 'error') {
      this.recordIncident({
        type: 'API_ERROR',
        source: 'TWELVE_DATA',
        message: `TwelveData API error on ${endpoint}: ${response?.message || 'Unknown error'}`,
        data: { endpoint, response }
      });
      return false;
    }

    this.updateSourceTimestamp('TWELVE_DATA');
    return true;
  }

  /**
   * Clear old incidents
   */
  clearOldIncidents(olderThanHours = 24) {
    const cutoff = Date.now() - (olderThanHours * 60 * 60 * 1000);
    this.incidents = this.incidents.filter(inc => 
      new Date(inc.timestamp).getTime() > cutoff
    );
  }
}

// Singleton instance
export const dataFreshnessGuard = new DataFreshnessGuard();
export default dataFreshnessGuard;
