require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const authRoutes = require('./routes/auth');
const onboardingRoutes = require('./routes/onboarding');
const groupRoutes = require('./routes/groups');
const scheduleWindowRoutes = require('./routes/scheduleWindow');
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

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/onboarding', onboardingRoutes);
app.use('/api/v1/groups', groupRoutes);
app.use('/api/v1/schedule-window', scheduleWindowRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    code: 'NOT_FOUND',
    message: 'Endpoint not found',
  });
});

// Global error handler
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
