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
const { errorHandler } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

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
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

if (process.env.NODE_ENV !== 'test') {
  connectDB();
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
    console.log(`Server is running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

module.exports = app;