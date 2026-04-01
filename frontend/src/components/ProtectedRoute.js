import React from 'react';
import { Navigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';

/**
 * Protected Route Component
 * Redirects to login if user is not authenticated
 * Can also enforce specific roles
 */
const ProtectedRoute = ({ component: Component, requiredRoles = [] }) => {
  const { isAuthenticated, user } = useAuthStore();

  // Check if user is authenticated
  if (!isAuthenticated) {
    return <Navigate to="/auth/login" replace />;
  }

  // Check if user has required role
  if (requiredRoles.length > 0 && !requiredRoles.includes(user?.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  // Render protected component
  return <Component />;
};

export default ProtectedRoute;
