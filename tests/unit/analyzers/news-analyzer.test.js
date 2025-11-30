import test from 'node:test';
import assert from 'node:assert/strict';
import EnhancedNewsAnalyzer from '../../../src/analyzers/enhanced-news-analyzer.js';

function createAnalyzer() {
  return new EnhancedNewsAnalyzer(
    {},
    {
      aggregator: {
        async fetch() {
          return [];
        }
      },
      languageProcessor: { analyzeText: () => ({}) },
      calendarService: {
        async fetch() {
          return [];
        }
      }
    }
  );
}

test('calculateSentiment weights article scores by impact', () => {
  const analyzer = createAnalyzer();
  const news = [
    { score: 3, impact: 2 },
    { score: -1, impact: 1 },
    { score: 0.5, impact: 0.5 }
  ];

  const sentiment = analyzer.calculateSentiment(news);
  const totalScore = 3 + -1 + 0.5;
  const totalImpact = 2 + 1 + 0.5;
  assert.equal(sentiment, (totalScore / totalImpact) * 10);
});

test('determineDirection respects sentiment and impact thresholds', () => {
  const analyzer = createAnalyzer();
  assert.equal(analyzer.determineDirection(20, 30), 'strong_buy');
  assert.equal(analyzer.determineDirection(8, 30), 'buy');
  assert.equal(analyzer.determineDirection(-9, 30), 'sell');
  assert.equal(analyzer.determineDirection(-25, 35), 'strong_sell');
  assert.equal(analyzer.determineDirection(5, 10), 'neutral');
});

test('calculateConfidence grows with news volume, events, sources, and sentiment', () => {
  const analyzer = createAnalyzer();
  const confidence = analyzer.calculateConfidence({
    baseNews: new Array(5).fill({}),
    quoteNews: new Array(3).fill({}),
    calendar: [{ impact: 1 }, { impact: 2 }],
    sources: { aggregator: true, sentimentFeeds: true, calendar: true, rss: false },
    sentiment: { overall: 12 }
  });

  assert.ok(confidence > 0);
  assert.ok(confidence <= 100);
});
