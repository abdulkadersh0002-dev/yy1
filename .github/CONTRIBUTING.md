# Contributing to Intelligent Auto-Trading System

Thank you for your interest in contributing! This document provides guidelines for contributing to this project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)

## Code of Conduct

By participating in this project, you agree to be respectful and constructive in all interactions.

## Getting Started

1. Fork the repository on GitHub.

2. Clone your fork locally.

   ```bash
   git clone https://github.com/YOUR-USERNAME/sg.git
   cd sg
   ```

3. Add the upstream remote.

   ```bash
   git remote add upstream https://github.com/abdulkadersh0002-dev/sg.git
   ```

4. Install dependencies.

   ```bash
   npm ci
   ```

## Development Setup

### Prerequisites

- Node.js 20.x or higher
- npm 10.x or higher
- Git

### Environment Configuration

1. Copy the example environment file.

   ```bash
   cp .env.example .env
   ```

2. Configure your local `.env` with appropriate values for development.

### Running Locally

```bash
npm run dev
```

## Making Changes

### Branch Naming

Use descriptive branch names:

- `feature/add-new-analyzer` - New features
- `fix/trade-execution-bug` - Bug fixes
- `docs/update-api-docs` - Documentation updates
- `refactor/simplify-engine` - Code refactoring

### Commit Messages

Follow a conventional commit format:

```text
type(scope): description

[optional body]

[optional footer]
```

Examples:

```text
feat(analyzer): add RSI divergence detection
fix(broker): handle connection timeout gracefully
docs(api): add websocket endpoint documentation
```

## Pull Request Process

1. Update your fork with the latest upstream changes.

   ```bash
   git fetch upstream
   git rebase upstream/HEAD
   ```

2. Create a feature branch.

   ```bash
   git checkout -b feature/your-feature-name
   ```

3. Run checks locally.

   ```bash
   npm run lint
   npm test
   npm run format:check
   ```

4. Push to your fork and open a Pull Request.

## Coding Standards

### JavaScript Style

We use ESLint and Prettier.

```bash
npm run lint
npm run format:write
```

### Key Guidelines

- Use ES modules (`import`/`export`).
- Prefer `const` over `let`; avoid `var`.
- Use meaningful names; keep functions focused.
- Handle errors explicitly.

### File Organization

```text
src/
├── analyzers/    # Analysis modules
├── services/     # Business logic
├── middleware/   # Express middleware
├── routes/       # Route handlers
├── utils/        # Utility functions
└── models/       # Data models
```

## Testing Guidelines

### Test Structure

```text
tests/
├── unit/         # Unit tests
├── integration/  # Integration tests
├── fixtures/     # Test data
└── helpers/      # Test utilities
```

### Running Tests

```bash
npm test
```

## Questions

If you have questions:

- Open an issue for discussion.
- Reach out to maintainers.
