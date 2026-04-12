import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import CommitteeCreationForm from '../components/CommitteeCreationForm';
import * as committeeService from '../api/committeeService';
import useAuthStore from '../store/authStore';

jest.mock('../store/authStore');
jest.mock('../api/committeeService');
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: jest.fn(),
}));

const mockNavigate = jest.fn();

describe('CommitteeCreationForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.mockImplementation((selector) =>
      selector({
        user: { userId: 'usr_coordinator', role: 'coordinator' },
        isAuthenticated: true,
      })
    );
    require('react-router-dom').useNavigate.mockReturnValue(mockNavigate);
  });

  it('blocks empty committee name and shows validation error', async () => {
    render(<CommitteeCreationForm />);

    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));

    expect(await screen.findByText(/Committee name is required/i)).toBeInTheDocument();
    expect(committeeService.createCommittee).not.toHaveBeenCalled();
  });

  it('renders duplicate name error when API returns 409', async () => {
    committeeService.createCommittee.mockRejectedValue({
      response: {
        status: 409,
        data: {
          code: 'DUPLICATE_COMMITTEE_NAME',
          message: 'A committee with this name already exists.',
        },
      },
    });

    render(<CommitteeCreationForm />);

    await userEvent.type(screen.getByLabelText(/Committee name/i), 'Test Committee');
    await userEvent.type(screen.getByLabelText(/Description/i), 'A new committee draft');
    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));

    expect(await screen.findByText(/A committee with this name already exists/i)).toBeInTheDocument();
    expect(committeeService.createCommittee).toHaveBeenCalledWith({
      committeeName: 'Test Committee',
      coordinatorId: 'usr_coordinator',
      description: 'A new committee draft',
    });
  });

  it('navigates to coordinator page after successful committee creation', async () => {
    committeeService.createCommittee.mockResolvedValue({
      committeeId: 'c1',
      committeeName: 'Working Committee',
    });

    render(<CommitteeCreationForm />);

    await userEvent.type(screen.getByLabelText(/Committee name/i), 'Working Committee');
    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/coordinator');
    });
  });
});
