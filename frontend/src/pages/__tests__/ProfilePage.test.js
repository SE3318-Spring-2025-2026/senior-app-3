import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ProfilePage from '../ProfilePage';
import useAuthStore from '../../store/authStore';

// Mock the useAuthStore hook
jest.mock('../../store/authStore', () => ({
  __esModule: true,
  default: jest.fn(),
}));

// Mock useNavigate from react-router-dom
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

describe('ProfilePage Component', () => {
  const mockUser = {
    userId: 'usr_123456',
    email: 'student@example.com',
    role: 'student',
    githubUsername: 'student-github',
    emailVerified: true,
    accountStatus: 'active',
    studentId: 'STU-2025-001',
    groupId: 'grp_123',
    createdAt: '2025-01-15T10:30:00Z',
    lastLogin: '2026-05-02T14:20:00Z',
    updatedAt: '2026-05-02T14:20:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockNavigate.mockClear();
  });

  it('renders profile page with user information', () => {
    useAuthStore.mockImplementation((selector) => {
      const store = {
        user: mockUser,
        clearAuth: jest.fn(),
      };
      return selector(store);
    });

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>
    );

    // Check if header is rendered
    expect(screen.getByText('My Profile')).toBeInTheDocument();

    // Check if user email is displayed
    expect(screen.getByText(mockUser.email)).toBeInTheDocument();

    // Check if user ID is displayed
    expect(screen.getByText(mockUser.userId)).toBeInTheDocument();

    // Check if role is displayed
    expect(screen.getByText('Student')).toBeInTheDocument();

    // Check if account status is displayed
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('displays account information section', () => {
    useAuthStore.mockImplementation((selector) => {
      const store = {
        user: mockUser,
        clearAuth: jest.fn(),
      };
      return selector(store);
    });

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>
    );

    expect(screen.getByText('Account Information')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('User ID')).toBeInTheDocument();
  });

  it('displays verification status section', () => {
    useAuthStore.mockImplementation((selector) => {
      const store = {
        user: mockUser,
        clearAuth: jest.fn(),
      };
      return selector(store);
    });

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>
    );

    expect(screen.getByText('Verification Status')).toBeInTheDocument();
    expect(screen.getByText(/Email Verified/)).toBeInTheDocument();
  });

  it('displays account activity section', () => {
    useAuthStore.mockImplementation((selector) => {
      const store = {
        user: mockUser,
        clearAuth: jest.fn(),
      };
      return selector(store);
    });

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>
    );

    expect(screen.getByText('Account Activity')).toBeInTheDocument();
    expect(screen.getByText('Account Created')).toBeInTheDocument();
    expect(screen.getByText('Last Login')).toBeInTheDocument();
  });

  it('displays group information when user has groupId', () => {
    useAuthStore.mockImplementation((selector) => {
      const store = {
        user: mockUser,
        clearAuth: jest.fn(),
      };
      return selector(store);
    });

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>
    );

    expect(screen.getByText('Group Information')).toBeInTheDocument();
    expect(screen.getByText(mockUser.groupId)).toBeInTheDocument();
  });

  it('displays GitHub username with link when available', () => {
    useAuthStore.mockImplementation((selector) => {
      const store = {
        user: mockUser,
        clearAuth: jest.fn(),
      };
      return selector(store);
    });

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>
    );

    const gitHubLink = screen.getByText(`@${mockUser.githubUsername}`);
    expect(gitHubLink).toBeInTheDocument();
    expect(gitHubLink).toHaveAttribute(
      'href',
      `https://github.com/${mockUser.githubUsername}`
    );
  });

  it('calls clearAuth and navigates on logout', () => {
    const mockClearAuth = jest.fn();
    useAuthStore.mockImplementation((selector) => {
      const store = {
        user: mockUser,
        clearAuth: mockClearAuth,
      };
      return selector(store);
    });

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>
    );

    const logoutButton = screen.getByRole('button', { name: /logout/i });
    fireEvent.click(logoutButton);

    expect(mockClearAuth).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/auth/method-selection');
  });

  it('toggles edit mode when Edit Profile button is clicked', () => {
    useAuthStore.mockImplementation((selector) => {
      const store = {
        user: mockUser,
        clearAuth: jest.fn(),
      };
      return selector(store);
    });

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>
    );

    const editButton = screen.getByRole('button', { name: /edit profile/i });
    fireEvent.click(editButton);

    // Should show Cancel button instead of Edit Profile
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('shows error message when user is not available', () => {
    useAuthStore.mockImplementation((selector) => {
      const store = {
        user: null,
        clearAuth: jest.fn(),
      };
      return selector(store);
    });

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>
    );

    expect(
      screen.getByText(/User information not available/i)
    ).toBeInTheDocument();
  });

  it('displays correct role badge for different roles', () => {
    const testCases = [
      { role: 'student', display: 'Student' },
      { role: 'professor', display: 'Professor' },
      { role: 'coordinator', display: 'Coordinator' },
      { role: 'admin', display: 'Administrator' },
    ];

    testCases.forEach(({ role, display }) => {
      useAuthStore.mockImplementation((selector) => {
        const store = {
          user: { ...mockUser, role },
          clearAuth: jest.fn(),
        };
        return selector(store);
      });

      const { unmount } = render(
        <BrowserRouter>
          <ProfilePage />
        </BrowserRouter>
      );

      expect(screen.getByText(display)).toBeInTheDocument();
      unmount();
    });
  });

  it('displays correct status badge for different statuses', () => {
    const testCases = [
      { status: 'active', display: 'Active' },
      { status: 'pending', display: 'Pending Verification' },
      { status: 'suspended', display: 'Suspended' },
    ];

    testCases.forEach(({ status, display }) => {
      useAuthStore.mockImplementation((selector) => {
        const store = {
          user: { ...mockUser, accountStatus: status },
          clearAuth: jest.fn(),
        };
        return selector(store);
      });

      const { unmount } = render(
        <BrowserRouter>
          <ProfilePage />
        </BrowserRouter>
      );

      expect(screen.getByText(display)).toBeInTheDocument();
      unmount();
    });
  });

  it('handles users without GitHub username', () => {
    const userWithoutGithub = { ...mockUser, githubUsername: null };
    useAuthStore.mockImplementation((selector) => {
      const store = {
        user: userWithoutGithub,
        clearAuth: jest.fn(),
      };
      return selector(store);
    });

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>
    );

    // GitHub section should not be visible
    expect(screen.queryByText(/GitHub Username/)).not.toBeInTheDocument();
  });

  it('handles users without studentId', () => {
    const userWithoutStudentId = { ...mockUser, studentId: null };
    useAuthStore.mockImplementation((selector) => {
      const store = {
        user: userWithoutStudentId,
        clearAuth: jest.fn(),
      };
      return selector(store);
    });

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>
    );

    // Student ID section should not be visible
    expect(screen.queryByText(/Student ID/)).not.toBeInTheDocument();
  });
});
