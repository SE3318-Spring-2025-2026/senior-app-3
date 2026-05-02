import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import useAuthStore from './store/authStore';
import ProtectedRoute from './components/ProtectedRoute';
import AuthMethodSelection from './components/AuthMethodSelection';
import LoginForm from './components/LoginForm';
import OnboardingStepper from './components/onboarding/OnboardingStepper';
import ForgotPasswordPage from './components/ForgotPasswordPage';
import ResetPasswordPage from './components/ResetPasswordPage';
import ProfessorOnboardModal from './components/ProfessorOnboardModal';
import AdminPasswordReset from './components/AdminPasswordReset';
import AdminProfessorCreation from './components/AdminProfessorCreation';
import GitHubCallbackHandler from './components/GitHubCallbackHandler';
import GroupDashboard from './components/GroupDashboard';
import JuryCommittees from './components/JuryCommittees';
import GroupCreationPage from './components/GroupCreationPage';
import AdviseeRequestForm from './components/AdviseeRequestForm';
import CoordinatorPanel from './components/CoordinatorPanel';
import ProfessorInbox from './components/ProfessorInbox';
import CommitteeCreationForm from './components/CommitteeCreationForm';
import JuryAssignmentForm from './components/JuryAssignmentForm';
import Dashboard from './components/Dashboard';
import Sidebar from './components/layout/Sidebar.jsx';
import './App.css';
import './components/layout/Sidebar.css';
import AdvisorAssociationPanel from './components/AdvisorAssociationPanel';
import DeliverableSubmissionForm from './components/DeliverableSubmissionForm.jsx';
import SubmitDeliverablePage from './pages/SubmitDeliverablePage.jsx';
import ReviewPage from './pages/ReviewPage.jsx';
import ReviewManagement from './pages/ReviewManagement.jsx';
import StudentSprintProgressPage from './pages/StudentSprintProgressPage.jsx';
import CoordinatorSprintDashboard from './pages/CoordinatorSprintDashboard.jsx';
import SprintContributionDashboard from './pages/SprintContributionDashboard.jsx';
import CommitteeFinalResults from './pages/CommitteeFinalResults.jsx';
import StudentFinalGradesPage from './pages/StudentFinalGradesPage.jsx';
import FinalGradeReviewPanel from './pages/FinalGradeReviewPanel.jsx';
import CoordinatorFinalGradeApprovalPanel from './pages/CoordinatorFinalGradeApprovalPanel.jsx';
import CoordinatorFinalGradePublishPanel from './pages/CoordinatorFinalGradePublishPanel.jsx';
import ProfessorGradeReviewEntry from './pages/ProfessorGradeReviewEntry.jsx';
import CoordinatorAdvisorInbox from './pages/CoordinatorAdvisorInbox.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
const Unauthorized = () => (
  <div className="page error" data-testid="unauthorized-page">
    403 Forbidden - Coordinator access required
  </div>
);
const NotFound = () => <div className="page error">Page Not Found</div>;

function App() {
  const { isAuthenticated } = useAuthStore();

  return (
    <Router
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <div className="app-layout">
        <div className="app-layout-sidebar">
          <Sidebar />
        </div>
        <div className="app-layout-content" style={{ marginLeft: isAuthenticated ? '250px' : '0' }}>
          <Routes>
            <Route path="/" element={<Navigate to="/auth/method-selection" replace />} />
            <Route path="/auth/method-selection" element={<AuthMethodSelection />} />
            <Route path="/auth/login" element={<LoginForm />} />
            {/* Student sign-up uses the full onboarding wizard; keep /auth/register as a stable alias */}
            <Route path="/auth/register" element={<Navigate to="/onboarding" replace />} />
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
              path="/professor/grade-review"
              element={<ProtectedRoute component={ProfessorGradeReviewEntry} requiredRoles={['professor', 'advisor']} />}
            />
            <Route
              path="/coordinator/advisor-requests"
              element={<ProtectedRoute component={CoordinatorAdvisorInbox} requiredRoles={['coordinator', 'admin']} />}
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
              path="/coordinator/sprint-dashboard"
              element={<ProtectedRoute component={CoordinatorSprintDashboard} requiredRoles={['coordinator']} />}
            />

            {/* Committee Routes from main */}
            <Route
              path="/coordinator/committees/new"
              element={<ProtectedRoute component={CommitteeCreationForm} requiredRoles={['coordinator']} />}
            />
            <Route
              path="/coordinator/committees/:committeeId/jury"
              element={<ProtectedRoute component={JuryAssignmentForm} requiredRoles={['coordinator']} />}
            />

            <Route
              path="/dashboard"
              element={<ProtectedRoute component={Dashboard} />}
            />
            <Route
              path="/me/final-grades"
              element={<ProtectedRoute component={StudentFinalGradesPage} requiredRoles={['student']} />}
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
              path="/groups/:group_id/sprints/:sprint_id/progress"
              element={<ProtectedRoute component={StudentSprintProgressPage} requiredRoles={['student']} />}
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
              path="/groups/:group_id/deliverables/submit"
              element={<ProtectedRoute component={DeliverableSubmissionForm} requiredRoles={['student']} />}
            />
            <Route
              path="/groups/:groupId/sprints/:sprintId/contributions"
              element={<ProtectedRoute component={SprintContributionDashboard} />}
            />
            <Route
              path="/groups/:groupId/final-grades/review"
              element={<ProtectedRoute component={FinalGradeReviewPanel} requiredRoles={['professor', 'advisor']} />}
            />
            <Route
              path="/groups/:groupId/final-grades/approval"
              element={<ProtectedRoute component={CoordinatorFinalGradeApprovalPanel} requiredRoles={['coordinator', 'admin']} />}
            />
            <Route
              path="/groups/:groupId/final-grades/publish"
              element={<ProtectedRoute component={CoordinatorFinalGradePublishPanel} requiredRoles={['coordinator', 'admin']} />}
            />
            <Route
              path="/dashboard/submit-deliverable"
              element={<ProtectedRoute component={SubmitDeliverablePage} requiredRoles={['student']} />}
            />
            <Route
              path="/dashboard/reviews/:deliverableId"
              element={<ProtectedRoute component={ReviewPage} requiredRoles={['student', 'professor', 'coordinator', 'committee_member', 'admin']} />}
            />
            <Route
              path="/dashboard/reviews"
              element={<ProtectedRoute component={ReviewManagement} requiredRoles={['coordinator', 'admin']} />}
            />
            <Route
              path="/jury/committees"
              element={<ProtectedRoute component={JuryCommittees} requiredRoles={['professor', 'committee_member', 'admin']} />}
            />
            <Route
              path="/committees/:committeeId/final-results"
              element={<ProtectedRoute component={CommitteeFinalResults} requiredRoles={['committee_member', 'admin']} />}
            />
            <Route
              path="/profile"
              element={<ProtectedRoute component={ProfilePage} />}
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
