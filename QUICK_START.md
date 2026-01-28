# 🚀 Quick Start Guide / دليل البدء السريع

## English Version

### One Command to Rule Them All!

Start both backend and dashboard with a single command:

```bash
npm run dev
```

That's it! ✅

### What Happens?

1. **Backend** starts on `http://127.0.0.1:4101`
2. **Dashboard** starts on `http://127.0.0.1:4173`
3. Both services monitor each other
4. Press `Ctrl+C` to stop everything

### First Time Setup

```bash
# 1. Install dependencies
npm ci

# 2. Copy environment file (if not exists)
cp .env.example .env

# 3. Edit .env with your settings (optional)
nano .env

# 4. Start everything!
npm run dev
```

### Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | 🚀 Start backend + dashboard (recommended) |
| `npm start` | Start backend only |
| `npm run dev:backend` | Start backend with auto-reload |
| `npm run dev:dashboard` | Start dashboard only |
| `npm test` | Run all tests |
| `npm run lint` | Check code quality |

### Verify Everything Works

Open these URLs in your browser:

- 🌐 Dashboard: http://127.0.0.1:4173
- 🔧 Backend Health: http://127.0.0.1:4101/api/healthz
- 📊 Metrics: http://127.0.0.1:4101/metrics
- 📡 WebSocket: ws://127.0.0.1:4101/ws/trading

### Troubleshooting

**Port already in use?**
```bash
# Edit .env and change:
PORT=4101           # Change to 4102, 4103, etc.
DASHBOARD_PORT=4173 # Change to 4174, 4175, etc.
```

**Backend fails to start?**
- Check your `.env` file configuration
- Ensure Node.js version is 20 or higher: `node --version`
- Check logs for error messages

**Dashboard not loading?**
- Wait 30 seconds after starting
- Dashboard takes longer to compile on first run
- Check console output for compilation progress

---

## النسخة العربية

### أمر واحد لتشغيل كل شيء!

شغّل الباكند والداشبورد بأمر واحد فقط:

```bash
npm run dev
```

هذا كل شيء! ✅

### ماذا يحدث؟

1. **الباكند** يبدأ على `http://127.0.0.1:4101`
2. **الداشبورد** يبدأ على `http://127.0.0.1:4173`
3. كلا الخدمتين تراقب بعضهما البعض
4. اضغط `Ctrl+C` لإيقاف كل شيء

### الإعداد للمرة الأولى

```bash
# 1. تثبيت المكتبات
npm ci

# 2. نسخ ملف البيئة (إذا لم يكن موجوداً)
cp .env.example .env

# 3. تعديل .env بإعداداتك (اختياري)
nano .env

# 4. شغّل كل شيء!
npm run dev
```

### الأوامر المتاحة

| الأمر | الوصف |
|------|-------|
| `npm run dev` | 🚀 تشغيل الباكند + الداشبورد (موصى به) |
| `npm start` | تشغيل الباكند فقط |
| `npm run dev:backend` | تشغيل الباكند مع إعادة التحميل التلقائي |
| `npm run dev:dashboard` | تشغيل الداشبورد فقط |
| `npm test` | تشغيل جميع الاختبارات |
| `npm run lint` | فحص جودة الكود |

### التحقق من عمل كل شيء

افتح هذه الروابط في المتصفح:

- 🌐 الداشبورد: http://127.0.0.1:4173
- 🔧 صحة الباكند: http://127.0.0.1:4101/api/healthz
- 📊 المقاييس: http://127.0.0.1:4101/metrics
- 📡 WebSocket: ws://127.0.0.1:4101/ws/trading

### حل المشاكل

**المنفذ مستخدم بالفعل؟**
```bash
# عدّل ملف .env وغيّر:
PORT=4101           # غيّر إلى 4102، 4103، إلخ.
DASHBOARD_PORT=4173 # غيّر إلى 4174، 4175، إلخ.
```

**الباكند لا يبدأ؟**
- تحقق من إعدادات ملف `.env`
- تأكد من أن إصدار Node.js هو 20 أو أعلى: `node --version`
- تحقق من رسائل الخطأ في السجلات

**الداشبورد لا يفتح؟**
- انتظر 30 ثانية بعد البدء
- الداشبورد يأخذ وقتاً أطول للتجميع في أول مرة
- تحقق من مخرجات الكونسول لرؤية تقدم التجميع

---

## 📚 Next Steps

- Read full documentation: [README.md](./README.md)
- Configure MT5: [docs/MT5_SETUP.md](./docs/MT5_SETUP.md)
- Real-time EA Mode: [docs/REALTIME_EA_MODE.md](./docs/REALTIME_EA_MODE.md)
- Decision System: [docs/ADVANCED_DECISION_SYSTEM.md](./docs/ADVANCED_DECISION_SYSTEM.md)

## 🆘 Need Help?

- Check existing issues on GitHub
- Review the logs in console output
- Ensure all prerequisites are installed

**Happy Trading! 🎉 / تداول سعيد! 🎉**
