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
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Submit Request/i })).toBeDisabled();
  });

  it('does not call the API when the form is submitted without a selected professor', async () => {
    checkAdvisorWindow.mockResolvedValue({ open: true });

    render(<AdviseeRequestForm />);

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());

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

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByRole('combobox'), 'usr_prof_1');
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

    await waitFor(() => expect(screen.getByText(/association window is closed/i)).toBeInTheDocument());
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Submit Request/i })).toBeDisabled();
  });

  it('displays a 422 error message when the advisor request submission is rejected by schedule boundary and disables the form', async () => {
    checkAdvisorWindow.mockResolvedValue({ open: true });
    submitAdvisorRequest.mockRejectedValue({ response: { status: 422 } });

    render(<AdviseeRequestForm />);

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByRole('combobox'), 'usr_prof_1');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Submit Request/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/The advisor request window is currently closed./i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Submit Request/i })).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
