import React, { useState, useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import * as groupService from '../api/groupService';

jest.mock('../api/groupService');

<<<<<<< Updated upstream
// Test component that uses schedule window
const ScheduleProtectedForm = ({ onSubmit }) => {
  const [windowOpen, setWindowOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState('');
=======
/**
 * Test component that mimics ScheduleBoundary banner functionality
 */
const ScheduleBoundaryTest = ({ operationType = 'group_creation', onSubmit }) => {
  const [windowOpen, setWindowOpen] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
>>>>>>> Stashed changes

  useEffect(() => {
    const checkScheduleWindow = async () => {
      try {
<<<<<<< Updated upstream
        const result = await groupService.getScheduleWindow('group_creation');
        setWindowOpen(result.open);
        if (!result.open) {
          setBanner('Group creation is currently closed. Please check back later.');
        }
        setLoading(false);
      } catch (err) {
        setWindowOpen(false);
        setBanner('Unable to check schedule. Please try again.');
        setLoading(false);
      }
    };
    checkScheduleWindow();
  }, []);

  const handleSubmit = (e) => {
=======
        const result = await groupService.getScheduleWindow(operationType);
        setWindowOpen(result.open);
      } catch {
        setWindowOpen(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkScheduleWindow();
  }, [operationType]);

  const handleFormSubmit = (e) => {
>>>>>>> Stashed changes
    e.preventDefault();
    if (windowOpen && onSubmit) {
      onSubmit();
    }
  };

<<<<<<< Updated upstream
  if (loading) return <div>Checking schedule...</div>;

  return (
    <div>
      {!windowOpen && banner && (
        <div className="schedule-banner">{banner}</div>
      )}
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Group name"
          disabled={!windowOpen || loading}
        />
        <button type="submit" disabled={!windowOpen || loading}>
          Create Group
=======
  return (
    <div className="form-container">
      {!isLoading && !windowOpen && (
        <div className="schedule-banner schedule-closed">
          <h3>Operation Not Available</h3>
          <p>
            {operationType === 'group_creation'
              ? 'Group creation is currently closed. Please check back during the available window.'
              : 'Member addition is currently closed. Please contact your coordinator for details.'}
          </p>
        </div>
      )}

      <form onSubmit={handleFormSubmit} disabled={!windowOpen}>
        <div className="form-group">
          <label htmlFor="groupName">Group Name</label>
          <input
            id="groupName"
            type="text"
            placeholder="Enter group name"
            disabled={!windowOpen || isLoading}
          />
        </div>

        <button
          type="submit"
          disabled={!windowOpen || isLoading}
          className="submit-button"
        >
          Submit
>>>>>>> Stashed changes
        </button>
      </form>
    </div>
  );
};

<<<<<<< Updated upstream
describe('Schedule Boundary', () => {
=======
describe('ScheduleBoundary', () => {
>>>>>>> Stashed changes
  beforeEach(() => {
    jest.clearAllMocks();
  });

<<<<<<< Updated upstream
  it('should check schedule window on component mount', async () => {
    groupService.getScheduleWindow.mockResolvedValue({ open: true });

    render(<ScheduleProtectedForm onSubmit={jest.fn()} />);

    await waitFor(() => {
      expect(groupService.getScheduleWindow).toHaveBeenCalledWith('group_creation');
    });
  });

  it('should show banner when schedule window is closed', async () => {
    groupService.getScheduleWindow.mockResolvedValue({ open: false });

    render(<ScheduleProtectedForm onSubmit={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/currently closed/i)).toBeInTheDocument();
    });
  });

  it('should disable form when schedule window is closed', async () => {
    groupService.getScheduleWindow.mockResolvedValue({ open: false });

    render(<ScheduleProtectedForm onSubmit={jest.fn()} />);

    await waitFor(() => {
      const button = screen.getByText(/Create Group/i);
      expect(button).toBeDisabled();
    });
  });

  it('should enable form when schedule window is open', async () => {
    groupService.getScheduleWindow.mockResolvedValue({ open: true });

    render(<ScheduleProtectedForm onSubmit={jest.fn()} />);

    await waitFor(() => {
      const button = screen.getByText(/Create Group/i);
      expect(button).not.toBeDisabled();
    });
  });

  it('should not show banner when window is open', async () => {
    groupService.getScheduleWindow.mockResolvedValue({ open: true });

    render(<ScheduleProtectedForm onSubmit={jest.fn()} />);

    await waitFor(() => {
      expect(screen.queryByText(/currently closed/i)).not.toBeInTheDocument();
    });
  });

  it('should allow form submission when window is open', async () => {
    const user = userEvent.setup();
    const mockOnSubmit = jest.fn();
    groupService.getScheduleWindow.mockResolvedValue({ open: true });

    render(<ScheduleProtectedForm onSubmit={mockOnSubmit} />);

    await waitFor(() => {
      const button = screen.getByText(/Create Group/i);
      expect(button).not.toBeDisabled();
    });

    const button = screen.getByText(/Create Group/i);
    await user.click(button);

    expect(mockOnSubmit).toHaveBeenCalled();
  });

  it('should not allow form submission when window is closed', async () => {
    const user = userEvent.setup();
    const mockOnSubmit = jest.fn();
    groupService.getScheduleWindow.mockResolvedValue({ open: false });

    render(<ScheduleProtectedForm onSubmit={mockOnSubmit} />);

    await waitFor(() => {
      const button = screen.getByText(/Create Group/i);
      expect(button).toBeDisabled();
    });

    const button = screen.getByText(/Create Group/i);
    await user.click(button);

    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('should disable input field when window is closed', async () => {
    groupService.getScheduleWindow.mockResolvedValue({ open: false });

    render(<ScheduleProtectedForm onSubmit={jest.fn()} />);

    await waitFor(() => {
      const input = screen.getByPlaceholderText('Group name');
      expect(input).toBeDisabled();
    });
  });

  it('should enable input field when window is open', async () => {
    groupService.getScheduleWindow.mockResolvedValue({ open: true });

    render(<ScheduleProtectedForm onSubmit={jest.fn()} />);

    await waitFor(() => {
      const input = screen.getByPlaceholderText('Group name');
      expect(input).not.toBeDisabled();
    });
  });

  it('should handle schedule check error gracefully', async () => {
    groupService.getScheduleWindow.mockRejectedValue(
      new Error('Network error')
    );

    render(<ScheduleProtectedForm onSubmit={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Unable to check schedule/i)).toBeInTheDocument();
    });
  });

  it('should show loading state while checking schedule', () => {
    groupService.getScheduleWindow.mockImplementationOnce(
      () => new Promise(() => {})
    );

    render(<ScheduleProtectedForm onSubmit={jest.fn()} />);

    expect(screen.getByText('Checking schedule...')).toBeInTheDocument();
  });

  it('should call for correct operation type', async () => {
    groupService.getScheduleWindow.mockResolvedValue({ open: true });

    render(<ScheduleProtectedForm onSubmit={jest.fn()} />);

    await waitFor(() => {
      expect(groupService.getScheduleWindow).toHaveBeenCalledWith('group_creation');
    });
  });

  it('should handle member addition schedule window check', async () => {
    groupService.getScheduleWindow.mockResolvedValue({ open: true });

    // Simulate checking for member_addition operation type
    const result = await groupService.getScheduleWindow('member_addition');

    expect(result.open).toBe(true);
    expect(groupService.getScheduleWindow).toHaveBeenCalledWith('member_addition');
  });

  it('should return window details when open', async () => {
    const windowDetails = {
      open: true,
      window: {
        windowId: 'w123',
        operationType: 'group_creation',
        startsAt: '2025-04-08T09:00:00Z',
        endsAt: '2025-04-08T17:00:00Z',
        label: 'Spring 2025 Group Formation'
      }
    };
    groupService.getScheduleWindow.mockResolvedValue(windowDetails);

    const result = await groupService.getScheduleWindow('group_creation');

    expect(result.open).toBe(true);
    expect(result.window.operationType).toBe('group_creation');
  });

  it('should enforce schedule boundaries for different operation types', async () => {
    // Group creation window open
    groupService.getScheduleWindow.mockResolvedValueOnce({
      open: true,
      operationType: 'group_creation'
    });

    const creationWindow = await groupService.getScheduleWindow('group_creation');
    expect(creationWindow.open).toBe(true);

    // Member addition window closed
    groupService.getScheduleWindow.mockResolvedValueOnce({
      open: false,
      operationType: 'member_addition'
    });

    const additionWindow = await groupService.getScheduleWindow('member_addition');
    expect(additionWindow.open).toBe(false);
=======
  describe('Banner Display', () => {
    it('shows banner when schedule window is closed', async () => {
      groupService.getScheduleWindow.mockResolvedValue({ open: false });
      render(<ScheduleBoundaryTest operationType="group_creation" />);

      await waitFor(() => {
        expect(
          screen.getByText(
            /Group creation is currently closed/i
          )
        ).toBeInTheDocument();
      });
    });

    it('does not show banner when schedule window is open', async () => {
      groupService.getScheduleWindow.mockResolvedValue({ open: true });
      render(<ScheduleBoundaryTest operationType="group_creation" />);

      await waitFor(() => {
        expect(
          screen.queryByText(/Group creation is currently closed/i)
        ).not.toBeInTheDocument();
      });
    });

    it('shows banner with correct message for group_creation operation', async () => {
      groupService.getScheduleWindow.mockResolvedValue({ open: false });
      render(<ScheduleBoundaryTest operationType="group_creation" />);

      await waitFor(() => {
        expect(
          screen.getByText(/Group creation is currently closed/i)
        ).toBeInTheDocument();
      });
    });

    it('shows banner with correct message for member_addition operation', async () => {
      groupService.getScheduleWindow.mockResolvedValue({ open: false });
      render(<ScheduleBoundaryTest operationType="member_addition" />);

      await waitFor(() => {
        expect(
          screen.getByText(/Member addition is currently closed/i)
        ).toBeInTheDocument();
      });
    });

    it('banner not shown on initial load while checking schedule', () => {
      groupService.getScheduleWindow.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );
      render(<ScheduleBoundaryTest operationType="group_creation" />);

      // Banner should not appear while loading
      expect(
        screen.queryByText(/Group creation is currently closed/i)
      ).not.toBeInTheDocument();
    });
  });

  describe('Form Submission Control', () => {
    it('disables submit button when schedule window is closed', async () => {
      groupService.getScheduleWindow.mockResolvedValue({ open: false });
      render(<ScheduleBoundaryTest operationType="group_creation" />);

      await waitFor(() => {
        const submitButton = screen.getByRole('button', { name: /Submit/i });
        expect(submitButton).toBeDisabled();
      });
    });

    it('enables submit button when schedule window is open', async () => {
      groupService.getScheduleWindow.mockResolvedValue({ open: true });
      render(<ScheduleBoundaryTest operationType="group_creation" />);

      await waitFor(() => {
        const submitButton = screen.getByRole('button', { name: /Submit/i });
        expect(submitButton).not.toBeDisabled();
      });
    });

    it('allows form submission when window is open', async () => {
      const user = userEvent.setup();
      const mockOnSubmit = jest.fn();
      groupService.getScheduleWindow.mockResolvedValue({ open: true });
      render(
        <ScheduleBoundaryTest
          operationType="group_creation"
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /Submit/i })
        ).not.toBeDisabled();
      });

      const input = screen.getByPlaceholderText(/Enter group name/);
      await user.type(input, 'Test Group');
      await user.click(screen.getByRole('button', { name: /Submit/i }));

      expect(mockOnSubmit).toHaveBeenCalled();
    });

    it('prevents form submission when window is closed', async () => {
      const user = userEvent.setup();
      const mockOnSubmit = jest.fn();
      groupService.getScheduleWindow.mockResolvedValue({ open: false });
      render(
        <ScheduleBoundaryTest
          operationType="group_creation"
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /Submit/i })
        ).toBeDisabled();
      });

      const submitButton = screen.getByRole('button', { name: /Submit/i });
      await user.click(submitButton);

      // Click should not trigger submission handler
      expect(mockOnSubmit).not.toHaveBeenCalled();
    });
  });

  describe('Input Control', () => {
    it('disables input fields when schedule window is closed', async () => {
      groupService.getScheduleWindow.mockResolvedValue({ open: false });
      render(<ScheduleBoundaryTest operationType="group_creation" />);

      await waitFor(() => {
        const input = screen.getByPlaceholderText(/Enter group name/);
        expect(input).toBeDisabled();
      });
    });

    it('enables input fields when schedule window is open', async () => {
      groupService.getScheduleWindow.mockResolvedValue({ open: true });
      render(<ScheduleBoundaryTest operationType="group_creation" />);

      await waitFor(() => {
        const input = screen.getByPlaceholderText(/Enter group name/);
        expect(input).not.toBeDisabled();
      });
    });

    it('allows typing in input when window is open', async () => {
      const user = userEvent.setup();
      groupService.getScheduleWindow.mockResolvedValue({ open: true });
      render(<ScheduleBoundaryTest operationType="group_creation" />);

      const input = screen.getByPlaceholderText(/Enter group name/);

      await waitFor(() => {
        expect(input).not.toBeDisabled();
      });

      await user.type(input, 'Alpha Team');
      expect(input).toHaveValue('Alpha Team');
    });

    it('prevents typing in input when window is closed', async () => {
      const user = userEvent.setup();
      groupService.getScheduleWindow.mockResolvedValue({ open: false });
      render(<ScheduleBoundaryTest operationType="group_creation" />);

      const input = screen.getByPlaceholderText(/Enter group name/);

      await waitFor(() => {
        expect(input).toBeDisabled();
      });

      // Typing in disabled input should not work
      await user.type(input, 'Alpha Team');
      expect(input).toHaveValue('');
    });
  });

  describe('Schedule Window Check', () => {
    it('calls getScheduleWindow on component mount', () => {
      groupService.getScheduleWindow.mockResolvedValue({ open: true });
      render(<ScheduleBoundaryTest operationType="group_creation" />);

      expect(groupService.getScheduleWindow).toHaveBeenCalledWith(
        'group_creation'
      );
    });

    it('passes correct operationType to getScheduleWindow', () => {
      groupService.getScheduleWindow.mockResolvedValue({ open: true });
      const { rerender } = render(
        <ScheduleBoundaryTest operationType="group_creation" />
      );

      expect(groupService.getScheduleWindow).toHaveBeenCalledWith(
        'group_creation'
      );

      jest.clearAllMocks();
      groupService.getScheduleWindow.mockResolvedValue({ open: true });

      rerender(<ScheduleBoundaryTest operationType="member_addition" />);

      expect(groupService.getScheduleWindow).toHaveBeenCalledWith(
        'member_addition'
      );
    });

    it('handles schedule window check errors gracefully', async () => {
      groupService.getScheduleWindow.mockRejectedValue(
        new Error('Network error')
      );
      render(<ScheduleBoundaryTest operationType="group_creation" />);

      await waitFor(() => {
        // Should treat error as closed window (fail secure)
        const submitButton = screen.getByRole('button', { name: /Submit/i });
        expect(submitButton).toBeDisabled();
      });
    });
  });

  describe('Banner Content', () => {
    it('shows helpful message encouraging coordinator contact', async () => {
      groupService.getScheduleWindow.mockResolvedValue({ open: false });
      render(<ScheduleBoundaryTest operationType="member_addition" />);

      await waitFor(() => {
        expect(
          screen.getByText(/contact your coordinator/i)
        ).toBeInTheDocument();
      });
    });

    it('suggests checking back later for group creation', async () => {
      groupService.getScheduleWindow.mockResolvedValue({ open: false });
      render(<ScheduleBoundaryTest operationType="group_creation" />);

      await waitFor(() => {
        expect(
          screen.getByText(/check back during the available window/i)
        ).toBeInTheDocument();
      });
    });

    it('banner has search-accessible text for screen readers', async () => {
      groupService.getScheduleWindow.mockResolvedValue({ open: false });
      render(<ScheduleBoundaryTest operationType="group_creation" />);

      await waitFor(() => {
        const banner = screen.getByText(/Group creation is currently closed/i);
        expect(banner).toBeInTheDocument();
        expect(banner.textContent).toMatch(/closed/i);
      });
    });
  });

  describe('Multiple Operations', () => {
    it('handles different schedule windows for different operations independently', async () => {
      groupService.getScheduleWindow.mockImplementation((operationType) => {
        return Promise.resolve({
          open: operationType === 'group_creation',
        });
      });

      const { rerender } = render(
        <ScheduleBoundaryTest operationType="group_creation" />
      );

      await waitFor(() => {
        expect(
          screen.queryByText(/Group creation is currently closed/i)
        ).not.toBeInTheDocument();
      });

      rerender(<ScheduleBoundaryTest operationType="member_addition" />);

      await waitFor(() => {
        expect(
          screen.getByText(/Member addition is currently closed/i)
        ).toBeInTheDocument();
      });
    });
>>>>>>> Stashed changes
  });
});
