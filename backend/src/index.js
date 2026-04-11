require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const authRoutes = require('./routes/auth');
const onboardingRoutes = require('./routes/onboarding');
const groupRoutes = require('./routes/groups');
const scheduleWindowRoutes = require('./routes/scheduleWindow');
const auditLogRoutes = require('./routes/auditLogs');
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ISSUE #80 FIX #7: REGISTER COMMITTEE ROUTES
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * FILE: backend/src/index.js (DÜZELTILDI)
 * STATUS: ✅ MODIFIED
 * 
 * PROBLEM FIXED:
 * PR Review Issue #80 required the new committees routes to be registered in
 * the main Express application. Without this registration, the validation endpoint
 * and all committee routes would not be accessible.
 * 
 * WHAT CHANGED:
 * • Added import: const committeeRoutes = require('./routes/committees');
 * • Registered route: app.use('/api/v1/committees', committeeRoutes);
 * • Now all Process 4.0 endpoints are accessible:
 *   - POST /api/v1/committees                    (4.1 Create)
 *   - POST /api/v1/committees/{id}/advisors      (4.2 Assign Advisors)
 *   - POST /api/v1/committees/{id}/jury          (4.3 Assign Jury)
 *   - POST /api/v1/committees/{id}/validate ✅   (4.4 KEY FIX)
 *   - POST /api/v1/committees/{id}/publish       (4.5 Placeholder)
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const committeeRoutes = require('./routes/committees');
const { errorHandler } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Database connection
const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/senior-app';
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

// Connect to database
connectDB();

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ ISSUE #80 FIX #7: COMMITTEE ROUTES REGISTRATION (CRITICAL)               ║
// ╚════════════════════════════════════════════════════════════════════════════╝
// Routes for Process 4.0 (Committee Assignment workflow) are now registered
// below. All Process 4.0 endpoints are now accessible via /api/v1/committees:
//   ✅ POST /api/v1/committees                    — Create draft (4.1)
//   ✅ POST /api/v1/committees/{id}/advisors      — Assign advisors (4.2)
//   ✅ POST /api/v1/committees/{id}/jury          — Assign jury (4.3)
//   ✅ POST /api/v1/committees/{id}/validate ⭐   — VALIDATE (4.4) - KEY FIX
//   ✅ POST /api/v1/committees/{id}/publish       — Publish (4.5)

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/onboarding', onboardingRoutes);
app.use('/api/v1/groups', groupRoutes);
app.use('/api/v1/schedule-window', scheduleWindowRoutes);
app.use('/api/v1/audit-logs', auditLogRoutes);
/**
 * NEW ROUTE: Committee assignment workflows (Process 4.0)
 * Implemented in Issue #80 to fix scope mismatch and missing validation endpoint
 */
app.use('/api/v1/committees', committeeRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    code: 'NOT_FOUND',
    message: 'Endpoint not found',
  });
});

// Global error handler
app.use(errorHandler);

// Start server only if not in test environment or if NODE_ENV is not 'test'
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

module.exports = app;
