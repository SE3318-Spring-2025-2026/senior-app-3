/**
 * Advisor Association Panel Tests
 * 
 * Tests for Issue #66 frontend component (Coordinator Panel - Advisor Association View)
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdvisorAssociationPanel from '../AdvisorAssociationPanel';
import * as advisorAssociationService from '../../api/advisorAssociationService';

// Mock the API service
jest.mock('../../api/advisorAssociationService');

describe('AdvisorAssociationPanel Component', () => {
  const mockUser = {
    userId: 'usr_coordinator',
    email: 'coordinator@test.edu',
    role: 'coordinator',
  };

  const mockNonCoordinator = {
    userId: 'usr_professor',
    email: 'professor@test.edu',
    role: 'professor',
  };

  const mockGroups = [
    {
      groupId: 'grp_001',
      groupName: 'Group 1',
      leaderId: 'usr_student1',
      advisorStatus: 'pending',
      professorId: null,
    },
    {
      groupId: 'grp_002',
      groupName: 'Group 2',
      leaderId: 'usr_student2',
      advisorStatus: 'assigned',
      professorId: 'usr_prof1',
    },
    {
      groupId: 'grp_003',
      groupName: 'Group 3',
      leaderId: 'usr_student3',
      advisorStatus: 'disbanded',
      professorId: null,
    },
  ];

  const mockProfessors = [
    {
      userId: 'usr_prof1',
      email: 'prof1@test.edu',
      role: 'professor',
    },
    {
      userId: 'usr_prof2',
      email: 'prof2@test.edu',
      role: 'professor',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    advisorAssociationService.getGroups.mockResolvedValue(mockGroups);
    advisorAssociationService.getAvailableProfessors.mockResolvedValue(mockProfessors);
  });

  // ✅ Test Group 1: Render & Authorization
  describe('Render & Authorization', () => {
    test('should render panel for coordinator user', async () => {
      render(<AdvisorAssociationPanel user={mockUser} />);

      await waitFor(() => {
        expect(screen.getByText('Advisor Association Management')).toBeInTheDocument();
      });
    });

    test('should deny access to non-coordinator user', () => {
      render(<AdvisorAssociationPanel user={mockNonCoordinator} />);

      expect(
        screen.getByText(/Access Denied.*Only coordinators/i)
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Advisor Association Management')
      ).not.toBeInTheDocument();
    });

    test('should display header and tabs on load', async () => {
      render(<AdvisorAssociationPanel user={mockUser} />);

      await waitFor(() => {
        expect(
          screen.getByText('Advisor Assignment Status')
        ).toBeInTheDocument();
        expect(
          screen.getByText(/Manage advisor assignments/i)
        ).toBeInTheDocument();
      });
    });
  });

  // ✅ Test Group 2: Data Loading
  describe('Data Loading', () => {
    test('should fetch and display groups on mount', async () => {
      render(<AdvisorAssociationPanel user={mockUser} />);

      await waitFor(() => {
        expect(advisorAssociationService.getGroups).toHaveBeenCalled();
        expect(advisorAssociationService.getAvailableProfessors).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(screen.getByText('Group 1')).toBeInTheDocument();
        expect(screen.getByText('Group 2')).toBeInTheDocument();
        expect(screen.getByText('Group 3')).toBeInTheDocument();
      });
    });

    test('should display loading state initially', () => {
      advisorAssociationService.getGroups.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<AdvisorAssociationPanel user={mockUser} />);

      expect(screen.getByText(/Loading advisor associations/i)).toBeInTheDocument();
    });

    test('should display error message on load failure', async () => {
      advisorAssociationService.getGroups.mockRejectedValue(
        new Error('Failed to load groups')
      );

      render(<AdvisorAssociationPanel user={mockUser} />);

      await waitFor(() => {
        expect(
          screen.getByText('Failed to load advisor association data')
        ).toBeInTheDocument();
      });
    });
  });

  // ✅ Test Group 3: Groups Table
  describe('Groups Table Display', () => {
    test('should display all groups in table', async () => {
      render(<AdvisorAssociationPanel user={mockUser} />);

      await waitFor(() => {
        const rows = screen.getAllByRole('row');
        expect(rows.length).toBeGreaterThanOrEqual(4); // header + 3 groups
      });
    });

    test('should display correct group information', async () => {
      render(<AdvisorAssociationPanel user={mockUser} />);

      await waitFor(() => {
        expect(screen.getByText('Group 1')).toBeInTheDocument();
        expect(screen.getByText('grp_001')).toBeInTheDocument();
        expect(screen.getByText('pending')).toBeInTheDocument();
      });
    });

    test('should display professor email for assigned groups', async () => {
      render(<AdvisorAssociationPanel user={mockUser} />);

      await waitFor(() => {
        const groupRow = screen.getByText('Group 2').closest('tr');
        expect(within(groupRow).getByText('prof1@test.edu')).toBeInTheDocument();
      });
    });

    test('should show "Unassigned" for groups without advisor', async () => {
      render(<AdvisorAssociationPanel user={mockUser} />);

      await waitFor(() => {
        const groupRow = screen.getByText('Group 1').closest('tr');
        expect(within(groupRow).getByText('Unassigned')).toBeInTheDocument();
      });
    });

    test('should display status badges with correct styling', async () => {
      render(<AdvisorAssociationPanel user={mockUser} />);

      await waitFor(() => {
        expect(screen.getByText('pending')).toHaveClass('badge-default');
        expect(screen.getByText('assigned')).toHaveClass('badge-success');
        expect(screen.getByText('disbanded')).toHaveClass('badge-danger');
      });
    });
  });

  // ✅ Test Group 4: Transfer Form
  describe('Transfer Form', () => {
    test('should open transfer form when Transfer button clicked', async () => {
      render(<AdvisorAssociationPanel user={mockUser} />);

      await waitFor(() => {
        const transferButtons = screen.getAllByText('Transfer');
        fireEvent.click(transferButtons[0]);
      });

      await waitFor(() => {
        expect(screen.getByText(/Transfer Advisor/)).toBeInTheDocument();
        expect(screen.getByLabelText(/New Advisor/i)).toBeInTheDocument();
      });
    });

    test('should disable transfer button for disbanded groups', async () => {
      render(<AdvisorAssociationPanel user={mockUser} />);

      await waitFor(() => {
        const transferButtons = screen.getAllByText('Transfer');
        // 3rd button for Group 3 (disbanded) should be disabled
        expect(transferButtons[2]).toBeDisabled();
      });
    });

    test('should populate group selector with selected group', async () => {
      render(<AdvisorAssociationPanel user={mockUser} />);

      await waitFor(() => {
        const transferButtons = screen.getAllByText('Transfer');
        fireEvent.click(transferButtons[0]);
      });

      await waitFor(() => {
        const groupSelect = screen.getByDisplayValue('Group 1');
        expect(groupSelect).toBeInTheDocument();
      });
    });

    test('should show professor dropdown options', async () => {
      render(<AdvisorAssociationPanel user={mockUser} />);

      await waitFor(() => {
        const transferButtons = screen.getAllByText('Transfer');
        fireEvent.click(transferButtons[0]);
      });

      await waitFor(() => {
        const profSelect = screen.getByLabelText(/New Advisor/i);
        expect(profSelect).toBeInTheDocument();
        fireEvent.click(profSelect);
      });

      await waitFor(() => {
        expect(screen.getByText('prof1@test.edu')).toBeInTheDocument();
        expect(screen.getByText('prof2@test.edu')).toBeInTheDocument();
      });
    });

    test('should submit transfer form successfully', async () => {
      advisorAssociationService.transferAdvisor.mockResolvedValue({
        success: true,
        group: {
          groupId: 'grp_001',
          professorId: 'usr_prof2',
          advisorStatus: 'transferred',
        },
      });

      render(<AdvisorAssociationPanel user={mockUser} />);

      await waitFor(() => {
        const transferButtons = screen.getAllByText('Transfer');
        fireEvent.click(transferButtons[0]);
      });

      await waitFor(() => {
        const profSelect = screen.getByLabelText(/New Advisor/i);
        fireEvent.change(profSelect, { target: { value: 'usr_prof2' } });
      });

      const confirmButton = await screen.findByText(/Confirm Transfer/);
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(advisorAssociationService.transferAdvisor).toHaveBeenCalledWith(
          'grp_001',
          'usr_prof2',
          ''
        );
        expect(
          screen.getByText(/Group transferred to new advisor/i)
        ).toBeInTheDocument();
      });
    });

    test('should display error on transfer failure', async () => {
      advisorAssociationService.transferAdvisor.mockRejectedValue(
        new Error('Schedule window is closed')
      );

      render(<AdvisorAssociationPanel user={mockUser} />);

      await waitFor(() => {
        const transferButtons = screen.getAllByText('Transfer');
        fireEvent.click(transferButtons[0]);
      });

      await waitFor(() => {
        const profSelect = screen.getByLabelText(/New Advisor/i);
        fireEvent.change(profSelect, { target: { value: 'usr_prof2' } });
      });

      const confirmButton = await screen.findByText(/Confirm Transfer/);
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(
          screen.getByText('Schedule window is closed')
        ).toBeInTheDocument();
      });
    });

    test('should close transfer form on cancel', async () => {
      render(<AdvisorAssociationPanel user={mockUser} />);

      await waitFor(() => {
        const transferButtons = screen.getAllByText('Transfer');
        fireEvent.click(transferButtons[0]);
      });

      await waitFor(() => {
        expect(screen.getByText(/Transfer Advisor/)).toBeInTheDocument();
      });

      const cancelButton = screen.getByText(/^Cancel$/);
      fireEvent.click(cancelButton);

      await waitFor(() => {
        expect(
          screen.queryByText(/Transfer Advisor/)
        ).not.toBeInTheDocument();
      });
    });
  });

  // ✅ Test Group 5: Sanitization Trigger
  describe('Sanitization Trigger', () => {
    test('should display sanitization section', async () => {
      render(<AdvisorAssociationPanel user={mockUser} />);

      await waitFor(() => {
        expect(
          screen.getByText(/Post-Deadline Sanitization/i)
        ).toBeInTheDocument();
      });
    });

    test('should show unassigned count', async () => {
      render(<AdvisorAssociationPanel user={mockUser} />);

      await waitFor(() => {
        // 1 pending (Group 1) + 1 disbanded (Group 3) = 2 unassigned
        expect(screen.getByText(/2 group\(s\)/i)).toBeInTheDocument();
      });
    });

    test('should show confirmation on first sanitize click', async () => {
      render(<AdvisorAssociationPanel user={mockUser} />);

      const sanitizeButton = await screen.findByText(/Trigger Sanitization/);
      fireEvent.click(sanitizeButton);

      await waitFor(() => {
        expect(
          screen.getByText(/Are you sure.*Disband/i)
        ).toBeInTheDocument();
      });
    });

    test('should execute sanitization on confirmation', async () => {
      advisorAssociationService.disbandUnassignedGroups.mockResolvedValue({
        success: true,
        count: 2,
        disbandedGroups: ['grp_001', 'grp_003'],
      });

      render(<AdvisorAssociationPanel user={mockUser} />);

      const sanitizeButton = await screen.findByText(/Trigger Sanitization/);
      fireEvent.click(sanitizeButton);

      await waitFor(() => {
        expect(
          screen.getByText(/Are you sure.*Disband/i)
        ).toBeInTheDocument();
      });

      const confirmButton = screen.getByText(/Yes, Disband Groups/);
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(advisorAssociationService.disbandUnassignedGroups).toHaveBeenCalled();
        expect(
          screen.getByText(/Sanitization complete.*2 group/i)
        ).toBeInTheDocument();
      });
    });

    test('should disable sanitize button when no unassigned groups', async () => {
      advisorAssociationService.getGroups.mockResolvedValue([
        {
          groupId: 'grp_001',
          groupName: 'Group 1',
          leaderId: 'usr_student1',
          advisorStatus: 'assigned',
          professorId: 'usr_prof1',
        },
      ]);

      render(<AdvisorAssociationPanel user={mockUser} />);

      await waitFor(() => {
        const sanitizeButton = screen.getByText(/Trigger Sanitization/);
        expect(sanitizeButton).toBeDisabled();
      });
    });

    test('should display error on sanitization failure', async () => {
      advisorAssociationService.disbandUnassignedGroups.mockRejectedValue(
        new Error('Cannot sanitize before deadline')
      );

      render(<AdvisorAssociationPanel user={mockUser} />);

      const sanitizeButton = await screen.findByText(/Trigger Sanitization/);
      fireEvent.click(sanitizeButton);

      await waitFor(() => {
        fireEvent.click(screen.getByText(/Yes, Disband Groups/));
      });

      await waitFor(() => {
        expect(
          screen.getByText('Cannot sanitize before deadline')
        ).toBeInTheDocument();
      });
    });
  });

  // ✅ Test Group 6: Messages & Alerts
  describe('Messages & Alerts', () => {
    test('should auto-dismiss success message after timeout', async () => {
      advisorAssociationService.transferAdvisor.mockResolvedValue({
        success: true,
        group: {
          groupId: 'grp_001',
          professorId: 'usr_prof2',
          advisorStatus: 'transferred',
        },
      });

      render(<AdvisorAssociationPanel user={mockUser} />);

      await waitFor(() => {
        const transferButtons = screen.getAllByText('Transfer');
        fireEvent.click(transferButtons[0]);
      });

      await waitFor(() => {
        const profSelect = screen.getByLabelText(/New Advisor/i);
        fireEvent.change(profSelect, { target: { value: 'usr_prof2' } });
      });

      const confirmButton = await screen.findByText(/Confirm Transfer/);
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(
          screen.getByText(/Group transferred/i)
        ).toBeInTheDocument();
      });

      // Wait for auto-dismiss
      await waitFor(
        () => {
          expect(
            screen.queryByText(/Group transferred/i)
          ).not.toBeInTheDocument();
        },
        { timeout: 4000 }
      );
    });
  });
});
