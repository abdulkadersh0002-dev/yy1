# VS Code Setup Guide for Trading System

## 🚀 Quick Start

### 1. Install VS Code

Download from: <https://code.visualstudio.com/>

### 2. Open Project in VS Code

```bash
cd /path/to/sg
code .
```

On Windows (PowerShell), the equivalent is:

```powershell
Set-Location C:\path\to\sg
code .
```

### 3. Install Recommended Extensions

When you open the project, VS Code will prompt you to install recommended extensions. Click "Install All" or install them manually:

**Essential Extensions:**

- ESLint (`dbaeumer.vscode-eslint`) - JavaScript linting
- Prettier (`esbenp.prettier-vscode`) - Code formatting
- GitLens (`eamodio.gitlens`) - Enhanced Git features
- REST Client (`humao.rest-client`) - Test APIs directly in VS Code
- Markdown All in One (`yzhang.markdown-all-in-one`) - Markdown editing
- DotENV (`mikestead.dotenv`) - .env file syntax highlighting

**Optional but Recommended:**

- GitHub Pull Requests (`github.vscode-pull-request-github`)
- Coverage Gutters (`ryanluker.vscode-coverage-gutters`)
- TODO Tree (`gruntfuggly.todo-tree`)
- Path Intellisense (`christian-kohler.path-intellisense`)
- IntelliCode (`visualstudioexptteam.vscodeintellicode`)

### 4. Set Up Environment

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your API keys
code .env
```

On Windows (PowerShell):

```powershell
Copy-Item .env.example .env
code .env
```

### 5. Install Dependencies

```bash
npm ci
```

## 📋 Available Commands

### Using Command Palette (Ctrl+Shift+P / Cmd+Shift+P)

Type "Tasks: Run Task" and select:

- 📦 **Install Dependencies** - Run `npm ci`
- 🚀 **Start Development Server** - Start the trading system
- 🚀 **Start Server + Dashboard** - Start backend + dashboard together (recommended)
- 🧪 **Run Tests** - Execute all tests
- 🔍 **Run Linter** - Check code quality
- 🔧 **Fix Linting Issues** - Auto-fix ESLint errors
- ✨ **Format Code** - Format with Prettier
- 🔒 **Security Audit** - Run npm audit
- 🧹 **Free Ports 4101+4173** - Stop any listeners on the backend/dashboard ports
- 🔎 **Check Backend via curl** - Fast health check (heartbeat + EA quotes)

### Keyboard Shortcuts (Customization)

| Action               | Shortcut (Win/Linux) | Shortcut (Mac)   |
| -------------------- | -------------------- | ---------------- |
| Run Task             | `Ctrl+Shift+B`       | `Cmd+Shift+B`    |
| Start Debugging      | `F5`                 | `F5`             |
| Open Command Palette | `Ctrl+Shift+P`       | `Cmd+Shift+P`    |
| Quick Open File      | `Ctrl+P`             | `Cmd+P`          |
| Toggle Terminal      | `Ctrl+` `            | `Cmd+` `         |
| Save All             | `Ctrl+K S`           | `Cmd+K S`        |
| Format Document      | `Shift+Alt+F`        | `Shift+Option+F` |
| Find in Files        | `Ctrl+Shift+F`       | `Cmd+Shift+F`    |

## 🐛 Debugging

### Debug Configurations Available

1. **🚀 Start Server** - Launch the trading system with debugger attached
2. **🧪 Run Tests** - Run all tests with debugging
3. **🎯 Run Current Test File** - Debug the currently open test file
4. **🐛 Debug Current File** - Debug any JavaScript file
5. **📎 Attach to Process** - Attach to a running Node.js process

### How to Debug

1. Set breakpoints by clicking left of line numbers
2. Press `F5` or click "Run and Debug" icon
3. Select a debug configuration
4. Use debug toolbar:
   - Continue (F5)
   - Step Over (F10)
   - Step Into (F11)
   - Step Out (Shift+F11)
   - Restart (Ctrl+Shift+F5)
   - Stop (Shift+F5)

## 🧪 Testing in VS Code

### Run Tests

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Specific file
node --test tests/unit/services/cache-service.test.js
```

### View Coverage

1. Run tests with coverage: `npm run test:coverage`
2. Install "Coverage Gutters" extension
3. Press `Ctrl+Shift+7` to toggle coverage display

## 🔧 Code Quality

### Auto-Format on Save

Enabled by default in `.vscode/settings.json`:

- Code formats automatically when you save
- ESLint fixes are applied on save

### Manual Format

- Format Document: `Shift+Alt+F`
- Format Selection: `Ctrl+K Ctrl+F`

### Linting

- ESLint runs automatically
- View problems: `Ctrl+Shift+M`
- Fix all auto-fixable issues: Run task "Fix Linting Issues"

## 📚 Documentation

### Browse Documentation in VS Code

1. Press `Ctrl+Shift+E` to open Explorer
2. Navigate to `docs/` folder
3. Click any `.md` file to view
4. Press `Ctrl+Shift+V` for Markdown preview

### Quick Navigation

- **API Reference**: `docs/API.md`
- **EA Bridge Guide**: `docs/EA_BRIDGE.md`
- **Real-time EA Mode (recommended)**: `docs/REALTIME_EA_MODE.md`
- **Auto Trading Checklist / Spec**: `docs/AUTO_TRADING_CHECKLIST.md`
- **Signal Accuracy Plan**: `docs/SIGNAL_ACCURACY_PLAN.md`
- **Completeness Assessment**: `docs/COMPLETENESS_ASSESSMENT.md`
- **Environment Setup**: `docs/ENVIRONMENT.md`

## 🔍 Search & Navigation

### Find in Project

- `Ctrl+Shift+F` - Search in all files
- `Ctrl+P` - Quick open file by name
- `Ctrl+T` - Go to symbol in workspace
- `Ctrl+Shift+O` - Go to symbol in file
- `F12` - Go to definition
- `Alt+F12` - Peek definition
- `Shift+F12` - Find all references

## 🌐 API Testing with REST Client

### Create `.http` files

```http
### Health Check
GET http://localhost:4101/api/healthz

### Heartbeat
GET http://localhost:4101/api/health/heartbeat

### EA Quotes (symbol strip)
GET http://localhost:4101/api/broker/bridge/mt5/market/quotes?maxAgeMs=30000

### Get Signal (optional/manual)
GET http://localhost:4101/api/broker/bridge/mt5/signal/get
Authorization: Bearer your-token-here

### EA Bridge Statistics
GET http://localhost:4101/api/broker/bridge/statistics
```

### Execute Requests

- Click "Send Request" above the request
- Or use `Ctrl+Alt+R`

## 🎨 Customization

### Themes

- `Ctrl+K Ctrl+T` - Change color theme
- Recommended: Dark+ (default), Monokai, Solarized Dark

### Settings

- User Settings: `Ctrl+,`
- Workspace Settings: `.vscode/settings.json`

### Keyboard Shortcuts

- View shortcuts: `Ctrl+K Ctrl+S`
- Customize any shortcut

## 🔗 Git Integration

### GitLens Features

- View file history
- See line blame annotations
- Compare branches
- View commit details

### Common Git Commands in VS Code

- View changes: Click "Source Control" icon or `Ctrl+Shift+G`
- Stage files: Click `+` next to file
- Commit: Enter message and press `Ctrl+Enter`
- Push: Click "..." → "Push"
- Pull: Click "..." → "Pull"
- Create branch: Click branch name in status bar

## 📊 Terminal

### Integrated Terminal

- Open: `` Ctrl+` ``
- New Terminal: `Ctrl+Shift+` `
- Split Terminal: `Ctrl+Shift+5`
- Switch between terminals: Dropdown in terminal panel

### Multiple Terminals

1. Main development server
2. Test runner in watch mode
3. General commands

## 🚨 Problem Solving

### Common Issues

**ESLint not working:**

1. Check ESLint is installed: `npm ls eslint`
2. Reload VS Code: `Ctrl+Shift+P` → "Reload Window"
3. Check `.eslintrc.json` exists

**Prettier not formatting:**

1. Set Prettier as default formatter
2. Check `.prettierrc.json` exists
3. Enable "Format on Save" in settings

**Debugging not working:**

1. Ensure Node.js 20+ is installed
2. Check `.vscode/launch.json` exists
3. Try "Reload Window"

**Extensions not loading:**

1. Check internet connection
2. Restart VS Code
3. Manually install from Extensions panel

## 🎯 Best Practices

### Workflow Tips

1. **Use multi-cursor editing**: `Alt+Click` or `Ctrl+D` for next occurrence
2. **Fold code sections**: `Ctrl+Shift+[` to fold, `Ctrl+Shift+]` to unfold
3. **Duplicate lines**: `Shift+Alt+Down` to duplicate down
4. **Move lines**: `Alt+Up/Down` to move lines
5. **Comment lines**: `Ctrl+/` to toggle line comment
6. **Block comment**: `Shift+Alt+A` to toggle block comment

### Code Organization

1. Use file explorer to navigate (`Ctrl+Shift+E`)
2. Use outline view to see file structure (`Ctrl+Shift+O`)
3. Use breadcrumbs at top of editor
4. Use Go to Symbol (`Ctrl+T`) for quick navigation

### Productivity

1. Use Tasks for common operations
2. Use Snippets for repetitive code
3. Use Emmet for HTML/JSX
4. Use IntelliSense (auto-complete) - `Ctrl+Space`
5. Use Quick Fix - `Ctrl+.` on errors/warnings

## 🎓 Learning Resources

### VS Code

- Official Docs: <https://code.visualstudio.com/docs>
- Tips & Tricks: <https://code.visualstudio.com/docs/getstarted/tips-and-tricks>
- Keyboard Shortcuts: <https://code.visualstudio.com/shortcuts/keyboard-shortcuts-windows.pdf>

### Node.js Debugging

- <https://code.visualstudio.com/docs/nodejs/nodejs-debugging>

### Extensions

- ESLint: <https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint>
- Prettier: <https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode>
- GitLens: <https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens>

## 📞 Support

### Project Documentation

- See `docs/` folder for comprehensive guides
- See `README.md` for project overview
- See `.env.example` for configuration options

### VS Code Help

- Help menu → "Welcome"
- Help menu → "Interactive Playground"
- Help menu → "Show All Commands" (`Ctrl+Shift+P`)

---

## ✅ Verification Checklist

After setup, verify everything works:

- [ ] VS Code opens the project
- [ ] Recommended extensions are installed
- [ ] `.env` file is configured
- [ ] Dependencies are installed (`npm ci`)
- [ ] Linter shows no errors (`npm run lint`)
- [ ] Tests pass (`npm test`)
- [ ] Server starts (`npm start`)
- [ ] Debugger attaches (F5)
- [ ] Code formats on save
- [ ] Git integration works
- [ ] Terminal opens (Ctrl+`)

---

## Ready to code

Press `F5` to start the trading system with debugging, or press `Ctrl+Shift+B` to run the default build task.
