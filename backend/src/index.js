require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const authRoutes = require('./routes/auth');
const onboardingRoutes = require('./routes/onboarding');
const groupRoutes = require('./routes/groups');
const advisorRequestRoutes = require('./routes/advisorRequests'); // From main
const committeeRoutes = require('./routes/committees');       // From main
const scheduleWindowRoutes = require('./routes/scheduleWindow');
const auditLogRoutes = require('./routes/auditLogs');
const deliverableRoutes = require('./routes/deliverables');
const reviewRoutes = require('./routes/reviews');
const commentsRoutes = require('./routes/comments');
// ISSUE #253: Import final grades approval routes (Process 8.4)
const finalGradesRoutes = require('./routes/finalGrades');
const finalGradeSelfRoutes = require('./routes/finalGradeSelf');
const { errorHandler } = require('./middleware/auth');
const { correlationIdMiddleware } = require('./middleware/correlationId');
const { logInfo, logError } = require('./utils/structuredLogger');
const {
  patchConsoleForRedaction,
  requestLogMiddleware,
} = require('./middleware/securityLogging');
const { startJiraSyncScheduler } = require('./services/jiraSyncScheduler');

let swaggerUi = null;
let swaggerSpec = null;
try {
  swaggerUi = require('swagger-ui-express');
} catch (error) {
  console.warn('[index] swagger-ui-express is not installed; /api-docs will be disabled.');
}
try {
  swaggerSpec = require('./swagger');
} catch (error) {
  console.warn('[index] swagger spec dependencies are not installed; /api-docs will be disabled.');
}

const app = express();
const PORT = process.env.PORT || 5002;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(correlationIdMiddleware());

app.use((req, res, next) => {
  logInfo('Incoming HTTP request', {
    service_name: 'app_bootstrap',
    correlationId: req.correlationId || null,
    externalRequestId: req.externalRequestId || null,
    method: req.method,
    path: req.path
  });
  next();
});
patchConsoleForRedaction();
app.use(requestLogMiddleware);

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/senior-app';
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    logInfo('MongoDB connected successfully', {
      service_name: 'app_bootstrap'
    });
  } catch (error) {
    logError('MongoDB connection error', {
      service_name: 'app_bootstrap',
      error: error.message
    });
    process.exit(1);
  }
};

if (process.env.NODE_ENV !== 'test') {
  connectDB();
  startJiraSyncScheduler();
}

// Swagger UI
if (swaggerUi && swaggerSpec) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/onboarding', onboardingRoutes);
app.use('/api/v1/groups', groupRoutes);
app.use('/api/v1/advisor-requests', advisorRequestRoutes); // From main
app.use('/api/v1/committees', committeeRoutes);           // From main
app.use('/api/v1/schedule-window', scheduleWindowRoutes);
app.use('/api/v1/audit-logs', auditLogRoutes);
app.use('/api/v1/deliverables', deliverableRoutes);
app.use('/api/v1/reviews', reviewRoutes);
app.use('/api/v1/comments', commentsRoutes);
app.use('/api/v1', finalGradeSelfRoutes);
// ISSUE #253: Register final grades approval routes (Process 8.4)
// Endpoint: POST /api/v1/groups/:groupId/final-grades/approval
app.use('/api/v1/groups', finalGradesRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    code: 'NOT_FOUND',
    message: 'Endpoint not found',
  });
});

// Error Middleware
app.use(errorHandler);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logInfo('Server started', {
      service_name: 'app_bootstrap',
      port: PORT,
      environment: process.env.NODE_ENV || 'development'
    });
  });
}

module.exports = app;
