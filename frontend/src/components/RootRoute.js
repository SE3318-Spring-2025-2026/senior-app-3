import React, { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';

/**
 * Root Route Component
 * Intelligently routes authenticated users to dashboard and unauthenticated users to auth selection
 * Handles the hydration of persisted auth state from localStorage
 */
const RootRoute = () => {
  const { isAuthenticated, isLoading } = useAuthStore();

  // If auth state is still loading from storage, wait
  if (isLoading) {
    return <div className="loading-container">Loading...</div>;
  }

  // If user is authenticated, go to dashboard
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  // If user is not authenticated, go to auth method selection
  return <Navigate to="/auth/method-selection" replace />;
};

export default RootRoute;
