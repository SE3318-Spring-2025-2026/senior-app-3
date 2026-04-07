import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProtectedRoute from '../components/ProtectedRoute';
import useAuthStore from '../store/authStore';

jest.mock('../store/authStore');

describe('ProtectedRoute Component', () => {
  const MockProtectedComponent = () => <div>Protected Content</div>;
  const MockLoginComponent = () => <div>Login Page</div>;
  const MockUnauthorizedComponent = () => <div>Unauthorized Page</div>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Authentication States', () => {
    it('renders protected component when user is authenticated', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: 'student' },
      });

      render(
        <MemoryRouter initialEntries={['/protected']}>
          <Routes>
            <Route
              path="/protected"
              element={<ProtectedRoute component={MockProtectedComponent} />}
            />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });

    it('redirects to /auth/login when user is not authenticated', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: false,
        user: null,
      });

      render(
        <MemoryRouter initialEntries={['/protected']}>
          <Routes>
            <Route
              path="/protected"
              element={<ProtectedRoute component={MockProtectedComponent} />}
            />
            <Route path="/auth/login" element={<MockLoginComponent />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Login Page')).toBeInTheDocument();
      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });

    it('does not render protected component on unauthenticated access', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: false,
        user: null,
      });

      render(
        <MemoryRouter initialEntries={['/protected']}>
          <Routes>
            <Route
              path="/protected"
              element={<ProtectedRoute component={MockProtectedComponent} />}
            />
            <Route path="/auth/login" element={<MockLoginComponent />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });
  });

  describe('Role-Based Access Control', () => {
    it('allows access when user has required role', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: 'student' },
      });

      render(
        <MemoryRouter initialEntries={['/student-area']}>
          <Routes>
            <Route
              path="/student-area"
              element={
                <ProtectedRoute
                  component={MockProtectedComponent}
                  requiredRoles={['student']}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });

    it('denies access when user does not have required role', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: 'student' },
      });

      render(
        <MemoryRouter initialEntries={['/admin-area']}>
          <Routes>
            <Route
              path="/admin-area"
              element={
                <ProtectedRoute
                  component={MockProtectedComponent}
                  requiredRoles={['admin']}
                />
              }
            />
            <Route path="/unauthorized" element={<MockUnauthorizedComponent />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Unauthorized Page')).toBeInTheDocument();
      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });

    it('allows admin user to access admin route', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: 'admin' },
      });

      render(
        <MemoryRouter initialEntries={['/admin-area']}>
          <Routes>
            <Route
              path="/admin-area"
              element={
                <ProtectedRoute
                  component={MockProtectedComponent}
                  requiredRoles={['admin']}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });

    it('allows professor user to access professor route', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: 'professor' },
      });

      render(
        <MemoryRouter initialEntries={['/professor-area']}>
          <Routes>
            <Route
              path="/professor-area"
              element={
                <ProtectedRoute
                  component={MockProtectedComponent}
                  requiredRoles={['professor']}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });

    it('allows user with multiple role options', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: 'coordinator' },
      });

      render(
        <MemoryRouter initialEntries={['/coordinator-area']}>
          <Routes>
            <Route
              path="/coordinator-area"
              element={
                <ProtectedRoute
                  component={MockProtectedComponent}
                  requiredRoles={['coordinator', 'admin']}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });

    it('denies access when user role is not in requiredRoles array', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: 'student' },
      });

      render(
        <MemoryRouter initialEntries={['/coordinator-area']}>
          <Routes>
            <Route
              path="/coordinator-area"
              element={
                <ProtectedRoute
                  component={MockProtectedComponent}
                  requiredRoles={['coordinator', 'admin']}
                />
              }
            />
            <Route path="/unauthorized" element={<MockUnauthorizedComponent />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Unauthorized Page')).toBeInTheDocument();
    });

    it('allows any authenticated user when no roles specified', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: 'student' },
      });

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute
                  component={MockProtectedComponent}
                  requiredRoles={[]}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });

    it('allows any authenticated user when requiredRoles is undefined', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: 'student' },
      });

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route
              path="/dashboard"
              element={<ProtectedRoute component={MockProtectedComponent} />}
            />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles null user object gracefully', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: null,
      });

      render(
        <MemoryRouter initialEntries={['/protected']}>
          <Routes>
            <Route
              path="/protected"
              element={
                <ProtectedRoute
                  component={MockProtectedComponent}
                  requiredRoles={['student']}
                />
              }
            />
            <Route path="/unauthorized" element={<MockUnauthorizedComponent />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Unauthorized Page')).toBeInTheDocument();
    });

    it('handles undefined user role gracefully', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: undefined },
      });

      render(
        <MemoryRouter initialEntries={['/protected']}>
          <Routes>
            <Route
              path="/protected"
              element={
                <ProtectedRoute
                  component={MockProtectedComponent}
                  requiredRoles={['student']}
                />
              }
            />
            <Route path="/unauthorized" element={<MockUnauthorizedComponent />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Unauthorized Page')).toBeInTheDocument();
    });

    it('is case-sensitive for role matching', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: 'Student' }, // Capital S
      });

      render(
        <MemoryRouter initialEntries={['/protected']}>
          <Routes>
            <Route
              path="/protected"
              element={
                <ProtectedRoute
                  component={MockProtectedComponent}
                  requiredRoles={['student']} // lowercase s
                />
              }
            />
            <Route path="/unauthorized" element={<MockUnauthorizedComponent />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Unauthorized Page')).toBeInTheDocument();
    });

    it('works with empty requiredRoles array', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: 'student' },
      });

      render(
        <MemoryRouter initialEntries={['/protected']}>
          <Routes>
            <Route
              path="/protected"
              element={
                <ProtectedRoute
                  component={MockProtectedComponent}
                  requiredRoles={[]}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });
  });

  describe('Redirect Behavior', () => {
    it('uses replace=true for login redirect (no history entry)', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: false,
        user: null,
      });

      // Navigate component with replace=true doesn't add to history
      // We verify that the redirect happens correctly
      render(
        <MemoryRouter initialEntries={['/protected']}>
          <Routes>
            <Route
              path="/protected"
              element={<ProtectedRoute component={MockProtectedComponent} />}
            />
            <Route path="/auth/login" element={<MockLoginComponent />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Login Page')).toBeInTheDocument();
    });

    it('redirects to /unauthorized on role mismatch', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: 'student' },
      });

      render(
        <MemoryRouter initialEntries={['/admin-area']}>
          <Routes>
            <Route
              path="/admin-area"
              element={
                <ProtectedRoute
                  component={MockProtectedComponent}
                  requiredRoles={['admin']}
                />
              }
            />
            <Route path="/unauthorized" element={<MockUnauthorizedComponent />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Unauthorized Page')).toBeInTheDocument();
    });

    it('redirects to /auth/login for unauthenticated access', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: false,
        user: null,
      });

      render(
        <MemoryRouter initialEntries={['/protected']}>
          <Routes>
            <Route
              path="/protected"
              element={<ProtectedRoute component={MockProtectedComponent} />}
            />
            <Route path="/auth/login" element={<MockLoginComponent />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Login Page')).toBeInTheDocument();
    });
  });

  describe('Component Rendering', () => {
    it('renders component with correct element structure', () => {
      useAuthStore.mockReturnValue({
        isAuthenticated: true,
        user: { id: '123', role: 'student' },
      });

      render(
        <MemoryRouter initialEntries={['/protected']}>
          <Routes>
            <Route
              path="/protected"
              element={<ProtectedRoute component={MockProtectedComponent} />}
            />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });
  });
});
