# Contributing to Intelligent Auto-Trading System

Thank you for your interest in contributing! This document provides guidelines for contributing to this project.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct. Please be respectful and constructive in all interactions.

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/YOUR-USERNAME/my-app1.git
   cd my-app1
   ```
3. **Add upstream** remote:
   ```bash
   git remote add upstream https://github.com/abdulkadersh0002-dev/my-app1.git
   ```
4. **Install** dependencies:
   ```bash
   npm ci
   ```

## Development Setup

### Prerequisites

- Node.js 20.x or higher
- npm 10.x or higher
- Git

### Environment Configuration

1. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

2. Configure your local `.env` with appropriate values for development

### Running Locally

```bash
# Development mode with hot reload
npm run dev

# Run tests
npm test

# Run linter
npm run lint
```

## Making Changes

### Branch Naming

Use descriptive branch names:

- `feature/add-new-analyzer` - New features
- `fix/trade-execution-bug` - Bug fixes
- `docs/update-api-docs` - Documentation updates
- `refactor/simplify-engine` - Code refactoring

### Commit Messages

Follow conventional commit format:

```
type(scope): description

[optional body]

[optional footer]
```

Types:

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

Examples:

```
feat(analyzer): add RSI divergence detection
fix(broker): handle connection timeout gracefully
docs(api): add websocket endpoint documentation
```

## Pull Request Process

1. **Update** your fork with the latest upstream changes:

   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Create** a feature branch:

   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make** your changes following our coding standards

4. **Test** your changes:

   ```bash
   npm run lint
   npm test
   ```

5. **Commit** your changes with a descriptive message

6. **Push** to your fork:

   ```bash
   git push origin feature/your-feature-name
   ```

7. **Open** a Pull Request on GitHub

### PR Checklist

- [ ] Code follows project style guidelines
- [ ] All tests pass
- [ ] New tests added for new functionality
- [ ] Documentation updated as needed
- [ ] No unrelated changes included
- [ ] PR description clearly explains changes

## Coding Standards

### JavaScript Style

We use ESLint and Prettier for code formatting. The configuration is in `.eslintrc.json` and `.prettierrc.json`.

```bash
# Check code style
npm run lint

# Fix auto-fixable issues
npm run lint:fix

# Format code
npm run format:write
```

### Key Guidelines

- Use ES modules (`import`/`export`)
- Prefer `const` over `let`, avoid `var`
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions small and focused
- Handle errors appropriately

### File Organization

```
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

```
tests/
├── unit/         # Unit tests
├── integration/  # Integration tests
├── fixtures/     # Test data
└── helpers/      # Test utilities
```

### Writing Tests

- Place tests next to the code they test or in the `tests/` directory
- Use descriptive test names
- Test edge cases and error conditions
- Mock external dependencies

### Running Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# With coverage
npm run test:ci
```

## Questions?

If you have questions, feel free to:

- Open an issue for discussion
- Reach out to maintainers

Thank you for contributing! 🎉
