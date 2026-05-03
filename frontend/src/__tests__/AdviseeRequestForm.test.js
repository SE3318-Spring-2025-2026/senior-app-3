import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import AdviseeRequestForm from '../components/AdviseeRequestForm';

jest.mock('../store/authStore');
jest.mock('../api/advisorService');
jest.mock('../api/groupService');
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: jest.fn(),
  useNavigate: jest.fn(),
}));

const useAuthStore = require('../store/authStore').default;
const { getProfessors, submitAdvisorRequest, checkAdvisorWindow } = require('../api/advisorService');
const { getGroup } = require('../api/groupService');
const { useParams, useNavigate } = require('react-router-dom');

// Helper: open the custom dropdown and click the named option.
const selectProfessor = async (professorName) => {
  await userEvent.click(screen.getByRole('button', { name: /Select Professor/i }));
  await userEvent.click(screen.getByRole('option', { name: new RegExp(professorName, 'i') }));
};

describe('AdviseeRequestForm', () => {
  const navigateMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    useParams.mockReturnValue({ group_id: 'grp_test' });
    useNavigate.mockReturnValue(navigateMock);
    useAuthStore.mockImplementation((selector) =>
      selector({ user: { userId: 'usr_leader', role: 'student' } })
    );
    getGroup.mockResolvedValue({ groupId: 'grp_test', leaderId: 'usr_leader' });
    getProfessors.mockResolvedValue([
      { userId: 'usr_prof_1', name: 'Dr. Ada Lovelace' },
      { userId: 'usr_prof_2', name: 'Dr. Grace Hopper' },
    ]);
  });

  it('disables submit when no professor is selected', async () => {
    checkAdvisorWindow.mockResolvedValue({ open: true });

    render(<AdviseeRequestForm />);

    await waitFor(() => expect(getGroup).toHaveBeenCalledWith('grp_test'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Select Professor/i })).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: /Submit Request/i })).toBeDisabled();
  });

  it('does not call the API when the form is submitted without a selected professor', async () => {
    checkAdvisorWindow.mockResolvedValue({ open: true });

    render(<AdviseeRequestForm />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Select Professor/i })).toBeInTheDocument()
    );

    const form = document.querySelector('form.advisor-form');
    await act(async () => {
      fireEvent.submit(form);
    });

    expect(submitAdvisorRequest).not.toHaveBeenCalled();
  });

  it('submits advisor request with selected professor and message', async () => {
    checkAdvisorWindow.mockResolvedValue({ open: true });
    submitAdvisorRequest.mockResolvedValue({ requestId: 'req_123', notificationTriggered: true });

    render(<AdviseeRequestForm />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Select Professor/i })).toBeInTheDocument()
    );

    await selectProfessor('Dr. Ada Lovelace');
    await userEvent.type(screen.getByLabelText(/Message \(Optional\)/i), 'We would love your guidance.');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Submit Request/i }));
    });

    await waitFor(() => {
      expect(submitAdvisorRequest).toHaveBeenCalledWith({
        groupId: 'grp_test',
        professorId: 'usr_prof_1',
        message: 'We would love your guidance.',
      });
      expect(screen.getByText(/Request Submitted!/i)).toBeInTheDocument();
    });
  });

  it('shows schedule closed warning and disables fields when window is closed', async () => {
    checkAdvisorWindow.mockResolvedValue({ open: false });

    render(<AdviseeRequestForm />);

    await waitFor(() =>
      expect(screen.getByText(/association window is closed/i)).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: /Select Professor/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Submit Request/i })).toBeDisabled();
  });

  it('displays a 422 error message when the advisor request submission is rejected by schedule boundary and disables the form', async () => {
    checkAdvisorWindow.mockResolvedValue({ open: true });
    submitAdvisorRequest.mockRejectedValue({ response: { status: 422 } });

    render(<AdviseeRequestForm />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Select Professor/i })).toBeInTheDocument()
    );
    await selectProfessor('Dr. Ada Lovelace');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Submit Request/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/The advisor request window is currently closed./i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Submit Request/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Select Professor/i })).toBeDisabled();
  });

  describe('DEV_BYPASS removed', () => {
    beforeEach(() => {
      localStorage.setItem('DEV_BYPASS', 'true');
    });

    afterEach(() => {
      localStorage.clear();
    });

    it('never renders a DEV_BYPASS banner regardless of the localStorage flag', async () => {
      checkAdvisorWindow.mockResolvedValue({ open: true });

      render(<AdviseeRequestForm />);

      await waitFor(() => expect(getGroup).toHaveBeenCalled());

      expect(screen.queryByText(/DEV_BYPASS/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/bypass/i)).not.toBeInTheDocument();
    });

    it('keeps the closed window locked when DEV_BYPASS is in localStorage', async () => {
      checkAdvisorWindow.mockResolvedValue({ open: false });

      render(<AdviseeRequestForm />);

      await waitFor(() =>
        expect(screen.getByText(/association window is closed/i)).toBeInTheDocument()
      );

      expect(screen.getByRole('button', { name: /Submit Request/i })).toBeDisabled();
    });

    it('422 response shows the standard closed-window message, not a bypass-mode message', async () => {
      checkAdvisorWindow.mockResolvedValue({ open: true });
      submitAdvisorRequest.mockRejectedValue({ response: { status: 422 } });

      render(<AdviseeRequestForm />);

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Select Professor/i })).toBeInTheDocument()
      );
      await selectProfessor('Dr. Ada Lovelace');
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Submit Request/i }));
      });

      await waitFor(() => {
        expect(screen.getByText(/The advisor request window is currently closed\./i)).toBeInTheDocument();
        expect(screen.queryByText(/bypass mode/i)).not.toBeInTheDocument();
      });
    });
  });
});
