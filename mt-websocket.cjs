// MT4/MT5 WebSocket Server - Real Account Data Bridge
// This allows MT4/MT5 EAs to send real account data via WebSocket

const WebSocket = require('ws');

class MTWebSocketServer {
  constructor(port = 8765) {
    this.port = port;
    this.wss = null;
    this.clients = new Map(); // accountNumber -> { ws, data }
    this.accountData = new Map(); // Store latest account data
  }

  start() {
    this.wss = new WebSocket.Server({ port: this.port });

    this.wss.on('connection', (ws) => {
      console.log('[MT WebSocket] 🔌 New EA connection');

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleMessage(ws, data);
        } catch (error) {
          console.error('[MT WebSocket] ❌ Parse error:', error.message);
          ws.send(JSON.stringify({ error: 'Invalid JSON format' }));
        }
      });

      ws.on('close', () => {
        // Remove disconnected client
        for (const [account, client] of this.clients.entries()) {
          if (client.ws === ws) {
            this.clients.delete(account);
            console.log(`[MT WebSocket] 🔌 EA disconnected: ${account}`);
            break;
          }
        }
      });

      ws.on('error', (error) => {
        console.error('[MT WebSocket] ❌ Connection error:', error.message);
      });

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'welcome',
        message: 'Connected to MT WebSocket Server',
        timestamp: new Date().toISOString()
      }));
    });

    console.log(`[MT WebSocket] 🚀 Server running on ws://localhost:${this.port}`);
    console.log('[MT WebSocket] 📡 Ready to receive data from MT4/MT5 EAs');
  }

  handleMessage(ws, data) {
    const { type, account, accountType } = data;

    switch (type) {
      case 'connect':
        this.handleConnect(ws, data);
        break;

      case 'account_update':
        this.handleAccountUpdate(ws, data);
        break;

      case 'position_update':
        this.handlePositionUpdate(ws, data);
        break;

      case 'heartbeat':
        ws.send(JSON.stringify({ type: 'heartbeat_ack', timestamp: new Date().toISOString() }));
        break;

      default:
        console.log('[MT WebSocket] ⚠️ Unknown message type:', type);
    }
  }

  handleConnect(ws, data) {
    const { account, accountType, platform, broker, leverage } = data;

    console.log(`[MT WebSocket] ✅ EA Connected:`);
    console.log(`   Platform: ${platform}`);
    console.log(`   Account: ${account} (${accountType})`);
    console.log(`   Broker: ${broker}`);
    console.log(`   Leverage: ${leverage}`);

    // Store client connection
    this.clients.set(account, {
      ws,
      account,
      accountType,
      platform,
      broker,
      leverage,
      connectedAt: new Date().toISOString()
    });

    // Send confirmation
    ws.send(JSON.stringify({
      type: 'connect_ack',
      message: 'Successfully connected',
      connectionId: `${platform}_${account}`,
      timestamp: new Date().toISOString()
    }));
  }

  handleAccountUpdate(ws, data) {
    const {
      account,
      accountType,
      balance,
      equity,
      margin,
      freeMargin,
      marginLevel,
      profit,
      openPositions,
      broker,
      currency,
      leverage,
      platform
    } = data;

    // Store latest account data
    const accountInfo = {
      accountNumber: account,
      accountType,
      platform: platform || 'MT4',
      server: broker,
      balance: parseFloat(balance),
      equity: parseFloat(equity),
      margin: parseFloat(margin),
      freeMargin: parseFloat(freeMargin),
      marginLevel: parseFloat(marginLevel),
      profit: parseFloat(profit),
      openPositions: parseInt(openPositions),
      currency: currency || 'USD',
      leverage: leverage || '1:100',
      name: `${accountType.toUpperCase()} Account`,
      company: broker,
      timestamp: new Date().toISOString(),
      connected: true
    };

    this.accountData.set(account, accountInfo);

    console.log(`[MT WebSocket] 📊 Account Update: ${account}`);
    console.log(`   Balance: $${balance} | Equity: $${equity} | P/L: $${profit}`);

    // Send acknowledgment (only if WebSocket connection exists)
    if (ws) {
      ws.send(JSON.stringify({
        type: 'account_update_ack',
        timestamp: new Date().toISOString()
      }));
    }
  }

  handlePositionUpdate(ws, data) {
    const { account, positions } = data;

    if (this.accountData.has(account)) {
      const accountInfo = this.accountData.get(account);
      accountInfo.positions = positions;
      accountInfo.openPositions = positions.length;
      this.accountData.set(account, accountInfo);

      console.log(`[MT WebSocket] 📈 Positions Update: ${account} - ${positions.length} open`);
    }

    if (ws) {
      ws.send(JSON.stringify({
        type: 'position_update_ack',
        timestamp: new Date().toISOString()
      }));
    }
  }

  // Get account data for API
  getAccountData(account) {
    return this.accountData.get(account);
  }

  // Get all connected accounts
  getConnectedAccounts() {
    return Array.from(this.clients.keys());
  }

  // Check if account is connected
  isConnected(account) {
    return this.clients.has(account);
  }

  // Get connection info
  getConnectionInfo(account) {
    return this.clients.get(account);
  }
}

module.exports = MTWebSocketServer;
