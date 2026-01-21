# Intelligent Auto-Trading System

[![CI](https://github.com/abdulkadersh0002-dev/my-app1/actions/workflows/ci.yml/badge.svg)](https://github.com/abdulkadersh0002-dev/my-app1/actions/workflows/ci.yml)

An advanced AI-powered automated trading system with economic, news, and technical analysis capabilities. Designed for production-grade reliability, scalability, and security.

## 📋 Table of Contents

- [Features](#-features)
- [Quick Start](#-quick-start)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [API Reference](#-api-reference)
- [Development](#-development)
- [Testing](#-testing)
- [Architecture](#-architecture)
- [Contributing](#-contributing)
- [License](#-license)

## ✨ Features

- **Multi-timeframe Technical Analysis** - Supports M1 to W1 timeframes
- **Economic Calendar Integration** - Real-time economic event tracking
- **News Sentiment Analysis** - AI-powered news sentiment scoring
- **Multi-broker Support** - OANDA, MT5, and IBKR integration
- **Risk Management** - Advanced position sizing and risk controls
- **Real-time WebSocket Updates** - Live trade and signal broadcasting
- **Prometheus Metrics** - Full observability with Grafana dashboards
- **Health Monitoring** - Comprehensive health checks and alerting

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/abdulkadersh0002-dev/my-app1.git
cd my-app1

# Install dependencies
npm ci

# Copy environment configuration
cp .env.example .env

# Edit .env with your API keys and configuration

# Start backend + dashboard (recommended dev workflow)
npm run start:all
```

What you get:

- Backend API: `http://127.0.0.1:4101`
- Dashboard (dev): `http://127.0.0.1:4173`
- WebSocket: `ws://127.0.0.1:4101/ws/trading`

For the EA-driven realtime workflow (signals stream automatically; no manual “Analyze Pair”), see `docs/REALTIME_EA_MODE.md`.

For MetaTrader 5 setup (EA + WebRequest allowlist + verification), see `docs/MT5_SETUP.md`.

## 📦 Installation

### Prerequisites

- Node.js 20.x or higher
- npm 10.x or higher
- PostgreSQL/TimescaleDB (optional, for persistence)
- Docker (optional, for containerized deployment)

### Install Dependencies

```bash
npm ci
```

### Database Setup (Optional)

If you want to enable persistence, set up TimescaleDB:

```bash
# Run migrations
npm run db:migrate
```

See [db/README.md](./db/README.md) for detailed database setup instructions.

## ⚙ Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

#### Required Variables

| Variable   | Description                                       |
| ---------- | ------------------------------------------------- |
| `PORT`     | Server port (default: 4101)                       |
| `NODE_ENV` | Environment (`development`, `production`, `test`) |

#### EA-driven realtime flags

| Variable                | Description                                            |
| ----------------------- | ------------------------------------------------------ |
| `ALLOW_SYNTHETIC_DATA`  | Allow synthetic/simulated data (dev)                   |
| `REQUIRE_REALTIME_DATA` | Require real-time feeds                                |
| `ALLOW_ALL_SYMBOLS`     | Allow any EA-streamed symbol (disable asset filtering) |

#### API Keys

| Variable                | Description                       |
| ----------------------- | --------------------------------- |
| `TWELVE_DATA_API_KEY`   | TwelveData API key for price data |
| `POLYGON_API_KEY`       | Polygon.io API key                |
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage API key             |
| `FINNHUB_API_KEY`       | Finnhub API key                   |
| `NEWSAPI_KEY`           | NewsAPI key for news sentiment    |
| `FRED_API_KEY`          | FRED API key for economic data    |
| `OPENAI_API_KEY`        | OpenAI API key (optional)         |

#### Database Configuration

| Variable      | Description                   |
| ------------- | ----------------------------- |
| `DB_HOST`     | Database host                 |
| `DB_PORT`     | Database port (default: 5432) |
| `DB_NAME`     | Database name                 |
| `DB_USER`     | Database user                 |
| `DB_PASSWORD` | Database password             |
| `DB_SSL`      | Enable SSL (`true`/`false`)   |

See `.env.example` for the complete list of configuration options.

## 📡 API Reference

### Health Endpoints

| Endpoint                | Method | Description                   |
| ----------------------- | ------ | ----------------------------- |
| `/api/healthz`          | GET    | Kubernetes-style health check |
| `/api/health/modules`   | GET    | Module health summary         |
| `/api/health/providers` | GET    | Data provider availability    |
| `/api/health/heartbeat` | GET    | Heartbeat status              |
| `/metrics`              | GET    | Prometheus metrics            |

### Trading Endpoints

| Endpoint                    | Method | Description                         |
| --------------------------- | ------ | ----------------------------------- |
| `/api/status`               | GET    | System status                       |
| `/api/statistics`           | GET    | Trading statistics                  |
| `/api/signal/generate`      | POST   | Generate signal for a pair          |
| `/api/signal/batch`         | POST   | Generate signals for multiple pairs |
| `/api/trade/execute`        | POST   | Execute a trade                     |
| `/api/trades/active`        | GET    | Get active trades                   |
| `/api/trades/history`       | GET    | Get trade history                   |
| `/api/trade/close/:tradeId` | POST   | Close a specific trade              |
| `/api/trade/close-all`      | POST   | Close all trades                    |

### Auto-Trading Endpoints

| Endpoint                  | Method | Description        |
| ------------------------- | ------ | ------------------ |
| `/api/auto-trading/start` | POST   | Start auto-trading |
| `/api/auto-trading/stop`  | POST   | Stop auto-trading  |

### Configuration Endpoints

| Endpoint             | Method | Description               |
| -------------------- | ------ | ------------------------- |
| `/api/config`        | GET    | Get trading configuration |
| `/api/config/update` | POST   | Update configuration      |
| `/api/pairs`         | GET    | Get trading pairs         |
| `/api/pairs/add`     | POST   | Add a trading pair        |
| `/api/pairs/remove`  | POST   | Remove a trading pair     |

### Broker Endpoints

| Endpoint                   | Method | Description              |
| -------------------------- | ------ | ------------------------ |
| `/api/broker/status`       | GET    | Broker connection status |
| `/api/broker/kill-switch`  | POST   | Toggle kill switch       |
| `/api/broker/manual-order` | POST   | Place manual order       |
| `/api/broker/manual-close` | POST   | Close position manually  |

### Feature Endpoints

| Endpoint                   | Method | Description              |
| -------------------------- | ------ | ------------------------ |
| `/api/features`            | GET    | Feature store summary    |
| `/api/features/:pair`      | GET    | Features for a pair      |
| `/api/features-snapshots`  | GET    | Feature snapshots        |
| `/api/risk/command-center` | GET    | Risk command center data |

## 💻 Development

### Development Mode

```bash
# Start with hot reload
npm run dev

# Run dashboard dev server
npm run dashboard:dev

# Start both together
npm run start:all
```

### Code Quality

```bash
# Run linter
npm run lint

# Fix lint issues
npm run lint:fix

# Check formatting
npm run format:check

# Fix formatting
npm run format:write
```

### Pre-commit Hooks

Pre-commit hooks are configured with `simple-git-hooks` and `lint-staged` to automatically lint and format code before commits.

## 🧪 Testing

### Run Tests

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration

# Run CI tests with coverage
npm run test:ci
```

### Test Structure

```text
tests/
├── fixtures/           # Test fixtures and mock data
├── helpers/            # Test utility functions
├── integration/        # Integration tests
│   ├── alerting/       # Alertmanager tests
│   ├── api/            # API endpoint tests
│   ├── scripts/        # Script tests
│   └── ws/             # WebSocket tests
└── unit/               # Unit tests
    ├── analyzers/      # Analyzer tests
    └── data/           # Data service tests
```

## 🏗 Architecture

### Directory Structure

```text
.
├── clients/            # Client applications (dashboard)
├── config/             # Configuration files (Prometheus, Grafana, etc.)
├── data/               # Static data files
├── db/                 # Database migrations and schema
├── docs/               # Documentation
├── scripts/            # Utility scripts
├── src/
│   ├── analyzers/      # Technical, economic, news analyzers
│   ├── app/            # Application setup and configuration
│   ├── backtesting/    # Backtesting framework
│   ├── config/         # Runtime configuration
│   ├── data/           # Data fetchers
│   ├── engine/         # Trading engine core
│   ├── etl/            # ETL pipelines
│   ├── middleware/     # Express middleware
│   ├── models/         # Data models and DTOs
│   ├── routes/         # Express route modules
│   ├── services/       # Business services
│   ├── storage/        # Data persistence
│   └── utils/          # Utility functions
└── tests/              # Test suites
```

### Core Components

- **Trading Engine** - Signal generation and trade execution
- **Trade Manager** - Trade lifecycle management
- **Price Data Fetcher** - Multi-provider price data aggregation
- **News Analyzer** - Sentiment analysis from news feeds
- **Economic Analyzer** - Economic indicator processing
- **Technical Analyzer** - Technical indicator calculations

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Development Guidelines

- Follow the existing code style (ESLint + Prettier)
- Write tests for new features
- Update documentation as needed
- Ensure all tests pass before submitting

### Code of Conduct

Please read our Code of Conduct before contributing.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🗺️ Roadmap

- [ ] Enhanced ML-based signal generation
- [ ] Additional broker integrations
- [ ] Improved backtesting framework
- [ ] Mobile dashboard application
- [ ] Advanced risk management features
- [ ] Real-time portfolio optimization
