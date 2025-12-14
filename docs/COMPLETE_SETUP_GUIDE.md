# دليل الإعداد الكامل - Complete Setup Guide 🚀

## نظرة عامة - Overview

هذا الدليل الشامل لنقل التطبيق من GitHub إلى VS Code والبدء في العمل بدون أي مشاكل.
This comprehensive guide for transferring the application from GitHub to VS Code and starting work without any issues.

---

## المتطلبات الأساسية - Prerequisites

### 1. البرامج المطلوبة - Required Software

✅ **Node.js** (v16 أو أحدث)

- تحميل من: https://nodejs.org/
- تحقق: `node --version`

✅ **PostgreSQL** (v13 أو أحدث)

- **Windows**: https://www.postgresql.org/download/windows/
- **macOS**: `brew install postgresql@15`
- **Linux**: `sudo apt-get install postgresql postgresql-contrib`
- تحقق: `psql --version`

✅ **Visual Studio Code**

- تحميل من: https://code.visualstudio.com/
- تحقق: افتح VS Code

✅ **Git**

- تحميل من: https://git-scm.com/
- تحقق: `git --version`

---

## خطوات الإعداد - Setup Steps

### الخطوة 1: استنساخ المشروع - Clone Project

```bash
# 1. افتح Terminal أو Command Prompt
# Open Terminal or Command Prompt

# 2. اختر مجلد العمل
# Choose your workspace folder
cd ~/Documents  # أو أي مجلد تريده / or any folder you want

# 3. استنسخ المشروع
# Clone the project
git clone https://github.com/abdulkadersh0002-dev/sg.git

# 4. ادخل إلى المجلد
# Enter the folder
cd sg

# 5. تأكد من الفرع الصحيح
# Ensure correct branch
git checkout copilot/refactor-application-structure
```

### الخطوة 2: فتح المشروع في VS Code

```bash
# من Terminal:
code .

# أو افتح VS Code ثم:
# File > Open Folder > اختر مجلد sg
```

### الخطوة 3: تثبيت الإضافات المطلوبة - Install Extensions

عند فتح المشروع، سيظهر إشعار لتثبيت الإضافات الموصى بها.
When opening the project, a notification will appear to install recommended extensions.

**الطريقة الآلية:**

1. انقر "Install All" في الإشعار
2. انتظر حتى تكتمل التثبيتات

**الطريقة اليدوية:**

1. اضغط `Ctrl+Shift+X` (أو `Cmd+Shift+X` على Mac)
2. ابحث وثبت:
   - ESLint
   - Prettier - Code formatter
   - PostgreSQL
   - GitLens
   - Path Intellisense
   - Error Lens
   - REST Client

### الخطوة 4: تثبيت حزم Node.js - Install Node Packages

```bash
# في Terminal داخل VS Code (Ctrl+`)
# In VS Code Terminal (Ctrl+`)

# تثبيت جميع الحزم
npm install

# انتظر حتى تكتمل (قد يستغرق 2-5 دقائق)
# Wait until complete (may take 2-5 minutes)
```

**ملاحظة:** إذا ظهرت أخطاء:

```bash
# امسح المجلدات القديمة
rm -rf node_modules package-lock.json

# أعد التثبيت
npm install
```

### الخطوة 5: إعداد قاعدة البيانات - Setup Database

#### أ. إنشاء قاعدة البيانات

```bash
# افتح PostgreSQL
# Windows:
# ابحث عن "SQL Shell (psql)" في Start Menu

# macOS/Linux:
sudo -u postgres psql

# داخل psql:
CREATE DATABASE signals_strategy;
CREATE USER signals_user WITH PASSWORD 'your_secure_password_here';
GRANT ALL PRIVILEGES ON DATABASE signals_strategy TO signals_user;
\q
```

#### ب. تكوين الاتصال

1. انسخ ملف البيئة:

```bash
cp .env.example .env
```

2. افتح `.env` وعدّل:

```env
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=signals_strategy
DB_USER=signals_user
DB_PASSWORD=your_secure_password_here
DB_SSL=false

# Application Configuration
PORT=5002
NODE_ENV=development

# TwelveData API (اختياري)
TWELVE_DATA_API_KEY=your_api_key_here
```

#### ج. تشغيل الترحيلات

```bash
# تشغيل جميع ترحيلات قاعدة البيانات
npm run db:migrate

# يجب أن ترى:
# ✅ Migration 009_trading_signals.sql executed successfully
# ✅ Migration 010_trade_executions.sql executed successfully
# ✅ Migration 011_performance_analytics.sql executed successfully
```

### الخطوة 6: التحقق من الإعداد - Verify Setup

```bash
# تشغيل الاختبارات
npm test

# يجب أن ترى: 176/179 tests passing (98.3%)
# 3 اختبارات فاشلة (متوقعة بسبب الشبكة)
```

### الخطوة 7: تشغيل التطبيق - Start Application

**الطريقة 1: من VS Code (الأسهل)**

```
اضغط F5
```

**الطريقة 2: من Terminal**

```bash
npm start

# أو
PORT=5002 npm start
```

**الطريقة 3: من Task Runner**

```
Ctrl+Shift+B
```

### الخطوة 8: فتح Dashboard

1. افتح المتصفح
2. اذهب إلى: `http://127.0.0.1:5002`
3. أو افتح مباشرة: `dashboard/index.html`

---

## التحقق النهائي - Final Verification

### ✅ قائمة التحقق - Checklist

قبل البدء بالعمل، تأكد من:

- [ ] VS Code مفتوح مع المشروع
- [ ] جميع الإضافات مثبتة (شريط الحالة أخضر)
- [ ] `npm install` تم بنجاح (لا توجد أخطاء)
- [ ] قاعدة البيانات تعمل (`npm run db:migrate` نجح)
- [ ] الاختبارات تمر (176/179)
- [ ] التطبيق يبدأ بدون أخطاء (`F5` أو `npm start`)
- [ ] Dashboard يفتح في المتصفح
- [ ] ESLint يعمل (علامة خضراء في شريط الحالة)
- [ ] Prettier ينسق الكود عند الحفظ
- [ ] IntelliSense يعمل (اكتب `const` وانظر الاقتراحات)

---

## الأوامر المفيدة - Useful Commands

### إدارة التطبيق - Application Management

```bash
# بدء التطبيق
npm start

# بدء مع إعادة تشغيل تلقائية
npm run dev

# إيقاف التطبيق (إذا كان يعمل في الخلفية)
npm run emergency-stop
```

### إدارة قاعدة البيانات - Database Management

```bash
# تشغيل الترحيلات
npm run db:migrate

# التحقق من حالة الترحيلات
npm run db:status

# إنشاء نسخة احتياطية
npm run create-backup

# استعادة من نسخة احتياطية
npm run restore-backup -- --backup-id 20231214-120000
```

### الاختبار والتحقق - Testing & Verification

```bash
# تشغيل جميع الاختبارات
npm test

# تشغيل اختبار واحد
npm test -- --grep "TradingSignal"

# التحقق من الإنتاج
npm run verify-production

# اختبار الضغط
npm run stress-test
```

### التنسيق والجودة - Formatting & Quality

```bash
# تنسيق جميع الملفات
npm run format

# فحص ESLint
npm run lint

# إصلاح مشاكل ESLint تلقائياً
npm run lint:fix
```

### حالات الطوارئ - Emergency

```bash
# إيقاف فوري للتداول
npm run emergency-stop

# التراجع إلى آخر نسخة مستقرة
npm run emergency-rollback

# إغلاق جميع الصفقات
npm run close-all-positions

# فحص صحة النظام
npm run health-check
```

---

## اختصارات VS Code المهمة - Important VS Code Shortcuts

### التنقل - Navigation

- `Ctrl+P` - فتح ملف سريع / Quick open file
- `Ctrl+Shift+P` - لوحة الأوامر / Command palette
- `Ctrl+`` - فتح/إغلاق Terminal / Toggle terminal
- `F12` - الذهاب إلى التعريف / Go to definition
- `Shift+F12` - إيجاد المراجع / Find references
- `F2` - إعادة تسمية الرمز / Rename symbol

### التصحيح - Debugging

- `F5` - بدء التصحيح / Start debugging
- `F9` - نقطة توقف / Toggle breakpoint
- `F10` - خطوة فوق / Step over
- `F11` - خطوة داخل / Step into
- `Shift+F5` - إيقاف / Stop

### التحرير - Editing

- `Shift+Alt+F` - تنسيق المستند / Format document
- `Ctrl+/` - تبديل التعليق / Toggle comment
- `Ctrl+Space` - اقتراحات / Trigger suggestions
- `Ctrl+.` - إجراءات سريعة / Quick actions

---

## قوالب الكود - Code Snippets

اكتب هذه الكلمات واضغط `Tab`:

### `signal-model` - إنشاء إشارة تداول

```javascript
const signal = new TradingSignal({
  pair: 'EURUSD',
  timeframe: 'M15',
  signalDirection: 'BUY',
  signalStrength: 85.5,
  signalConfidence: 92.3,
  entry: 1.085,
  stopLoss: 1.083,
  takeProfit: 1.09,
  features: {},
  capturedAt: new Date(),
});
```

### `db-query` - استعلام قاعدة البيانات

```javascript
async function queryName() {
  try {
    const result = await db.query('SELECT * FROM table WHERE condition = $1', [
      value,
    ]);
    return result.rows;
  } catch (error) {
    logger.error('Database query error:', error);
    throw error;
  }
}
```

### `log` - سجل بيانات

```javascript
logger.info('Message', { data });
```

### `try` - كتلة try-catch

```javascript
try {
  // code
} catch (error) {
  logger.error('Error:', error);
  throw error;
}
```

---

## حل المشاكل الشائعة - Common Troubleshooting

### 1. فشل `npm install`

**المشكلة:** أخطاء أثناء التثبيت

**الحل:**

```bash
# امسح وأعد التثبيت
rm -rf node_modules package-lock.json
npm cache clean --force
npm install
```

### 2. خطأ في قاعدة البيانات

**المشكلة:** لا يمكن الاتصال بقاعدة البيانات

**الحل:**

```bash
# تحقق من PostgreSQL يعمل
# Windows: Services > PostgreSQL
# Mac/Linux:
sudo systemctl status postgresql

# إذا لم يكن يعمل:
sudo systemctl start postgresql
```

### 3. المنفذ 5002 مستخدم

**المشكلة:** `Error: listen EADDRINUSE: address already in use :::5002`

**الحل:**

```bash
# أوقف العملية المستخدمة للمنفذ
# Windows:
netstat -ano | findstr :5002
taskkill /PID <PID> /F

# Mac/Linux:
lsof -ti:5002 | xargs kill -9
```

### 4. ESLint لا يعمل

**المشكلة:** لا يظهر التنسيق التلقائي

**الحل:**

1. `Ctrl+Shift+P` → "ESLint: Restart ESLint Server"
2. تحقق من التثبيت: `npm list eslint`
3. أعد تشغيل VS Code

### 5. Prettier لا ينسق

**المشكلة:** الكود لا ينسق عند الحفظ

**الحل:**

1. `Ctrl+,` → ابحث "Default Formatter"
2. اختر "Prettier - Code formatter"
3. فعّل "Format On Save"

---

## هيكل المشروع - Project Structure

```
sg/
├── src/                      # كود المصدر
│   ├── ai/                  # نماذج الذكاء الاصطناعي
│   ├── database/            # طبقة قاعدة البيانات
│   ├── domain/              # نماذج النطاق
│   ├── engine/              # محرك التداول
│   ├── monitoring/          # المراقبة والقياسات
│   ├── services/            # الخدمات
│   └── trading/             # منطق التداول
├── dashboard/               # لوحة التحكم
├── db/migrations/           # ترحيلات قاعدة البيانات
├── docs/                    # التوثيق
├── routes/                  # مسارات API
├── scripts/                 # نصوص الأدوات
├── tests/                   # الاختبارات
├── .vscode/                 # إعدادات VS Code
├── .env.example             # مثال ملف البيئة
├── package.json             # تبعيات Node
└── jsconfig.json            # تكوين JavaScript
```

---

## الخطوات التالية - Next Steps

بعد إكمال الإعداد:

### 1. استكشف الكود

- افتح `src/engine/trading-engine.js` - المحرك الرئيسي
- افتح `src/database/services/` - خدمات الحفظ
- افتح `dashboard/index.html` - لوحة التحكم

### 2. جرّب الميزات

```bash
# شغّل التطبيق
npm start

# افتح Dashboard
# في المتصفح: http://127.0.0.1:5002
```

### 3. اقرأ التوثيق

- `docs/DATABASE_COMPLETE.md` - دليل قاعدة البيانات
- `docs/PRODUCTION_HARDENING.md` - ميزات الإنتاج
- `docs/VSCODE_SETUP.md` - إعداد VS Code

### 4. ابدأ التطوير

- ضع نقاط توقف (`F9`)
- اضغط `F5` للتصحيح
- عدّل الكود واحفظ (تنسيق تلقائي)

---

## الدعم - Support

إذا واجهت أي مشاكل:

1. **راجع هذا الدليل** أولاً
2. **افحص الأخطاء** في Terminal
3. **راجع التوثيق** في مجلد `docs/`
4. **تحقق من الاختبارات**: `npm test`
5. **تشغيل التحقق**: `npm run verify-production`

---

## ملخص سريع - Quick Summary

```bash
# 1. استنساخ المشروع
git clone https://github.com/abdulkadersh0002-dev/sg.git
cd sg

# 2. فتح في VS Code
code .

# 3. تثبيت الحزم
npm install

# 4. إعداد قاعدة البيانات
# (أنشئ قاعدة البيانات في PostgreSQL أولاً)
npm run db:migrate

# 5. تكوين البيئة
cp .env.example .env
# (عدّل .env بمعلومات قاعدة البيانات)

# 6. تشغيل الاختبارات
npm test

# 7. بدء التطبيق
npm start
# أو اضغط F5 في VS Code

# 8. افتح Dashboard
# المتصفح: http://127.0.0.1:5002
```

---

## 🎉 تهانينا! - Congratulations!

التطبيق الآن جاهز للعمل في VS Code!
The application is now ready to work in VS Code!

**كل شيء تم إعداده بشكل صحيح:**

- ✅ جميع الحزم مثبتة
- ✅ قاعدة البيانات متصلة
- ✅ VS Code مكون بالكامل
- ✅ التنسيق التلقائي يعمل
- ✅ التصحيح جاهز
- ✅ الاختبارات تمر
- ✅ لا توجد مشاكل!

**ابدأ البرمجة الآن! Happy Coding! 🚀**
