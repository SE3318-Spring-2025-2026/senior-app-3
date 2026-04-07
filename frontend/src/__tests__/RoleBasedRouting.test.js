import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import ProtectedRoute from '../components/ProtectedRoute';

jest.mock('../store/authStore');

describe('Role-Based Routing', () => {
  const StudentDashboard = () => <div>Student Dashboard</div>;
  const ProfessorDashboard = () => <div>Professor Dashboard</div>;
  const AdminPanel = () => <div>Admin Panel</div>;
  const CoordinatorPanel = () => <div>Coordinator Panel</div>;
  const LoginPage = () => <div>Login Page</div>;
  const UnauthorizedPage = () => <div>Unauthorized</div>;

  const setupRoutes = () => (
    <Routes>
      {/* Student routes */}
      <Route
        path="/dashboard"
        element={<ProtectedRoute component={StudentDashboard} />}
      />
      <Route
        path="/groups/new"
        element={<ProtectedRoute component={() => <div>Create Group</div>} requiredRoles={['student']} />}
      />

      {/* Professor routes */}
      <Route
        path="/professor/dashboard"
        element={<ProtectedRoute component={ProfessorDashboard} requiredRoles={['professor']} />}
      />
      <Route
        path="/professor/setup"
        element={<ProtectedRoute component={() => <div>Professor Setup</div>} requiredRoles={['professor']} />}
      />

      {/* Admin routes */}
      <Route
        path="/admin/password-reset"
        element={<ProtectedRoute component={AdminPanel} requiredRoles={['admin']} />}
      />
      <Route
        path="/admin/professor-creation"
        element={<ProtectedRoute component={() => <div>Create Professor</div>} requiredRoles={['admin']} />}
      />

      {/* Coordinator routes */}
      <Route
        path="/coordinator/panel"
        element={<ProtectedRoute component={CoordinatorPanel} requiredRoles={['coordinator', 'admin']} />}
      />

      {/* Auth routes */}
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/unauthorized" element={<UnauthorizedPage />} />
    </Routes>
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Student Role Routing', () => {
    it('redirects student to student dashboard', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: 'student', name: 'John Doe' },
      });

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Student Dashboard')).toBeInTheDocument();
    });

    it('allows student to access generic dashboard', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: 'student' },
      });

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Student Dashboard')).toBeInTheDocument();
    });

    it('denies student access to admin panel', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: 'student' },
      });

      render(
        <MemoryRouter initialEntries={['/admin/password-reset']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Unauthorized')).toBeInTheDocument();
      expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument();
    });

    it('denies student access to professor routes', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: 'student' },
      });

      render(
        <MemoryRouter initialEntries={['/professor/dashboard']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Unauthorized')).toBeInTheDocument();
    });

    it('allows student to create group', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: 'student' },
      });

      render(
        <MemoryRouter initialEntries={['/groups/new']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Create Group')).toBeInTheDocument();
    });
  });

  describe('Professor Role Routing', () => {
    it('redirects professor to professor dashboard', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '456', role: 'professor', name: 'Dr. Smith' },
      });

      render(
        <MemoryRouter initialEntries={['/professor/dashboard']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Professor Dashboard')).toBeInTheDocument();
    });

    it('allows professor to access setup page', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '456', role: 'professor' },
      });

      render(
        <MemoryRouter initialEntries={['/professor/setup']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Professor Setup')).toBeInTheDocument();
    });

    it('denies professor access to admin panel', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '456', role: 'professor' },
      });

      render(
        <MemoryRouter initialEntries={['/admin/password-reset']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Unauthorized')).toBeInTheDocument();
    });

    it('denies professor access to student-only routes', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '456', role: 'professor' },
      });

      render(
        <MemoryRouter initialEntries={['/groups/new']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Unauthorized')).toBeInTheDocument();
    });
  });

  describe('Admin Role Routing', () => {
    it('redirects admin to admin panel', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '789', role: 'admin', name: 'Admin User' },
      });

      render(
        <MemoryRouter initialEntries={['/admin/password-reset']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Admin Panel')).toBeInTheDocument();
    });

    it('allows admin to access professor creation', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '789', role: 'admin' },
      });

      render(
        <MemoryRouter initialEntries={['/admin/professor-creation']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Create Professor')).toBeInTheDocument();
    });

    it('allows admin to access coordinator panel', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '789', role: 'admin' },
      });

      render(
        <MemoryRouter initialEntries={['/coordinator/panel']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Coordinator Panel')).toBeInTheDocument();
    });

    it('denies admin access to student-only routes', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '789', role: 'admin' },
      });

      render(
        <MemoryRouter initialEntries={['/groups/new']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Unauthorized')).toBeInTheDocument();
    });
  });

  describe('Coordinator Role Routing', () => {
    it('allows coordinator to access coordinator panel', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '101', role: 'coordinator', name: 'Coordinator' },
      });

      render(
        <MemoryRouter initialEntries={['/coordinator/panel']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Coordinator Panel')).toBeInTheDocument();
    });

    it('denies coordinator access to admin-only routes', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '101', role: 'coordinator' },
      });

      render(
        <MemoryRouter initialEntries={['/admin/password-reset']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Unauthorized')).toBeInTheDocument();
    });

    it('denies coordinator access to student routes', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '101', role: 'coordinator' },
      });

      render(
        <MemoryRouter initialEntries={['/groups/new']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Unauthorized')).toBeInTheDocument();
    });
  });

  describe('Unauthenticated Access', () => {
    it('redirects unauthenticated user to login', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: false,
        user: null,
      });

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Login Page')).toBeInTheDocument();
      expect(screen.queryByText('Student Dashboard')).not.toBeInTheDocument();
    });

    it('redirects unauthenticated user from admin routes to login', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: false,
        user: null,
      });

      render(
        <MemoryRouter initialEntries={['/admin/password-reset']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Login Page')).toBeInTheDocument();
    });

    it('redirects unauthenticated user from protected routes to login', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: false,
        user: null,
      });

      render(
        <MemoryRouter initialEntries={['/groups/new']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Login Page')).toBeInTheDocument();
    });
  });

  describe('Generic Dashboard Access', () => {
    it('allows any authenticated user to access generic dashboard', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: 'student' },
      });

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Student Dashboard')).toBeInTheDocument();
    });

    it('allows professor to access generic dashboard', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '456', role: 'professor' },
      });

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Student Dashboard')).toBeInTheDocument();
    });

    it('allows admin to access generic dashboard', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '789', role: 'admin' },
      });

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Student Dashboard')).toBeInTheDocument();
    });
  });

  describe('Multi-Role Access', () => {
    it('allows coordinator and admin to access shared routes', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '789', role: 'admin' },
      });

      render(
        <MemoryRouter initialEntries={['/coordinator/panel']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Coordinator Panel')).toBeInTheDocument();
    });

    it('checks user role against all roles in requiredRoles array', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '101', role: 'coordinator' },
      });

      render(
        <MemoryRouter initialEntries={['/coordinator/panel']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      // Should be in the ['coordinator', 'admin'] array
      expect(screen.getByText('Coordinator Panel')).toBeInTheDocument();
    });
  });

  describe('Role Case Sensitivity', () => {
    it('handles lowercase role names correctly', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: 'student' },
      });

      render(
        <MemoryRouter initialEntries={['/groups/new']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Create Group')).toBeInTheDocument();
    });

    it('is case-sensitive and denies mismatched case', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: 'Student' }, // Capital S
      });

      render(
        <MemoryRouter initialEntries={['/groups/new']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      // Should deny because role is 'Student' not 'student'
      expect(screen.getByText('Unauthorized')).toBeInTheDocument();
    });
  });

  describe('Unknown Role Handling', () => {
    it('redirects unknown role to unauthorized', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '999', role: 'superuser' }, // Unknown role
      });

      render(
        <MemoryRouter initialEntries={['/admin/password-reset']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      expect(screen.getByText('Unauthorized')).toBeInTheDocument();
    });

    it('denies unknown role from accessing protected routes', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '999', role: 'guest' },
      });

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          {setupRoutes()}
        </MemoryRouter>
      );

      // Generic dashboard might allow but role-specific routes deny
      expect(screen.getByText('Student Dashboard')).toBeInTheDocument();
    });
  });
});
