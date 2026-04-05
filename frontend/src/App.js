import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import useAuthStore from './store/authStore';
import ProtectedRoute from './components/ProtectedRoute';
import AuthMethodSelection from './components/AuthMethodSelection';
import LoginForm from './components/LoginForm';
import RegisterForm from './components/RegisterForm';
import OnboardingStepper from './components/onboarding/OnboardingStepper';
import ForgotPasswordPage from './components/ForgotPasswordPage';
import ResetPasswordPage from './components/ResetPasswordPage';
import ProfessorOnboardModal from './components/ProfessorOnboardModal';
import AdminPasswordReset from './components/AdminPasswordReset';
import AdminProfessorCreation from './components/AdminProfessorCreation';
import GitHubCallbackHandler from './components/GitHubCallbackHandler';
import GroupDashboard from './components/GroupDashboard';
import GroupCreationPage from './components/GroupCreationPage';
import CoordinatorPanel from './components/CoordinatorPanel';
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
        <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
        <Route path="/auth/github/callback" element={<GitHubCallbackHandler />} />
        <Route path="/onboarding" element={<OnboardingStepper />} />

        {/* Professor first-login: dedicated route, protected */}
        <Route
          path="/professor/setup"
          element={<ProtectedRoute component={ProfessorOnboardModal} />}
        />

        {/* Admin Routes */}
        <Route
          path="/admin/password-reset"
          element={<ProtectedRoute component={AdminPasswordReset} requiredRoles={['admin']} />}
        />
        <Route
          path="/admin/professor-creation"
          element={<ProtectedRoute component={AdminProfessorCreation} requiredRoles={['admin']} />}
        />

        {/* Protected Routes */}
        <Route
          path="/dashboard"
          element={<ProtectedRoute component={Dashboard} />}
        />
        <Route
          path="/groups/new"
          element={<ProtectedRoute component={GroupCreationPage} />}
        />
        <Route
          path="/groups/:group_id"
          element={<ProtectedRoute component={GroupDashboard} />}
        />
        <Route
          path="/groups/:group_id/coordinator"
          element={<ProtectedRoute component={CoordinatorPanel} requiredRoles={['coordinator', 'admin']} />}
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

