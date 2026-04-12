import React from 'react';
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
import AdviseeRequestForm from './components/AdviseeRequestForm';
import CoordinatorPanel from './components/CoordinatorPanel';
import ProfessorInbox from './components/ProfessorInbox';
import Dashboard from './components/Dashboard';
import Sidebar from './components/layout/Sidebar';
import './App.css';
import './components/layout/Sidebar.css';
import AdvisorAssociationPanel from './components/AdvisorAssociationPanel';

const Profile = () => <div className="page">Profile - Coming Soon</div>;
const Unauthorized = () => <div className="page error">Unauthorized Access</div>;
const NotFound = () => <div className="page error">Page Not Found</div>;

function App() {
  const { isAuthenticated } = useAuthStore();

  return (
    <Router>
      <div className="app-layout">
        <div className="app-layout-sidebar">
          <Sidebar />
        </div>
        <div className="app-layout-content" style={{ marginLeft: isAuthenticated ? '250px' : '0' }}>
          <Routes>
            <Route path="/" element={<Navigate to="/auth/method-selection" replace />} />
            <Route path="/auth/method-selection" element={<AuthMethodSelection />} />
            <Route path="/auth/login" element={<LoginForm />} />
            <Route path="/auth/register" element={<RegisterForm />} />
            <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
            <Route path="/auth/github/callback" element={<GitHubCallbackHandler />} />
            <Route path="/onboarding" element={<OnboardingStepper />} />

            <Route
              path="/professor/setup"
              element={<ProtectedRoute component={ProfessorOnboardModal} />}
            />
            <Route
              path="/professor/inbox"
              element={<ProtectedRoute component={ProfessorInbox} requiredRoles={['professor']} />}
            />

            <Route
              path="/admin/password-reset"
              element={<ProtectedRoute component={AdminPasswordReset} requiredRoles={['admin']} />}
            />
            <Route
              path="/admin/professor-creation"
              element={<ProtectedRoute component={AdminProfessorCreation} requiredRoles={['admin']} />}
            />

            <Route
              path="/coordinator"
              element={<ProtectedRoute component={CoordinatorPanel} requiredRoles={['coordinator', 'admin']} />}
            />

            <Route
              path="/dashboard"
              element={<ProtectedRoute component={Dashboard} />}
            />
            <Route
              path="/groups/new"
              element={<ProtectedRoute component={GroupCreationPage} requiredRoles={['student']} />}
            />
            <Route
              path="/groups/:group_id/advisor-request"
              element={<ProtectedRoute component={AdviseeRequestForm} requiredRoles={['student']} />}
            />
            <Route
              path="/groups/:group_id"
              element={<ProtectedRoute component={GroupDashboard} />}
            />
            <Route
              path="/groups/:group_id/advisor"
              element={<ProtectedRoute component={AdvisorAssociationPanel} requiredRoles={['student']} />}
            />
            <Route
              path="/groups/:group_id/coordinator"
              element={<ProtectedRoute component={CoordinatorPanel} requiredRoles={['coordinator', 'admin']} />}
            />
            <Route
              path="/profile"
              element={<ProtectedRoute component={Profile} />}
            />

            <Route path="/unauthorized" element={<Unauthorized />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
