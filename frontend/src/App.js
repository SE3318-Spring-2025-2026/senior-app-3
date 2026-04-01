import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import useAuthStore from './store/authStore';
import ProtectedRoute from './components/ProtectedRoute';
import AuthMethodSelection from './components/AuthMethodSelection';
import LoginForm from './components/LoginForm';
import RegisterForm from './components/RegisterForm';
import './App.css';

/**
 * Placeholder components for routes not yet implemented
 */
const Dashboard = () => <div className="page">Dashboard - Coming Soon</div>;
const Profile = () => <div className="page">Profile - Coming Soon</div>;
const Unauthorized = () => <div className="page error">Unauthorized Access</div>;
const NotFound = () => <div className="page error">Page Not Found</div>;

/**
 * Main App component with routing
 */
function App() {
  const { isSessionValid } = useAuthStore();

  // Initialize auth on app load (restore from localStorage)
  useEffect(() => {
    // Session validation and token refresh logic can be added here
    console.log('App initialized. Session valid:', isSessionValid());
  }, [isSessionValid]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Router>
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<Navigate to="/auth/method-selection" replace />} />
        <Route path="/auth/method-selection" element={<AuthMethodSelection />} />
        <Route path="/auth/login" element={<LoginForm />} />
        <Route path="/auth/register" element={<RegisterForm />} />

        {/* Protected Routes */}
        <Route
          path="/dashboard"
          element={<ProtectedRoute component={Dashboard} />}
        />
        <Route
          path="/profile"
          element={<ProtectedRoute component={Profile} />}
        />

        {/* Error Routes */}
        <Route path="/unauthorized" element={<Unauthorized />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
}

export default App;
