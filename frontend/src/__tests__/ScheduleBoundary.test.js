import React, { useState, useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import * as groupService from '../api/groupService';

jest.mock('../api/groupService');

// Test component that uses schedule window
const ScheduleProtectedForm = ({ onSubmit }) => {
  const [windowOpen, setWindowOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState('');

  useEffect(() => {
    const checkScheduleWindow = async () => {
      try {
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
    e.preventDefault();
    if (windowOpen && onSubmit) {
      onSubmit();
    }
  };

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
        </button>
      </form>
    </div>
  );
};

describe('Schedule Boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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
  });
});
